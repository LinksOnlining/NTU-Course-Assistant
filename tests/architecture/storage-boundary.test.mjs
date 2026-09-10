import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("React orchestration uses the course storage service rather than Tauri or SQL directly", () => {
  const app = source("src/App.tsx");
  assert.match(app, /services\/course-storage\.ts/);
  assert.doesNotMatch(app, /@tauri-apps|\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i);
});

test("only service adapters import frontend Tauri APIs", () => {
  assert.match(source("src/services/course-storage.ts"), /@tauri-apps\/api\/core/);
  assert.match(source("src/services/pdf-import.ts"), /@tauri-apps\/plugin-(?:dialog|fs)/);
  for (const path of [
    "src/App.tsx",
    "src/core/course-input.ts",
    "src/core/pdf-text.ts",
    "src/core/time.ts",
    "src/core/timetable-layout.ts",
  ]) {
    assert.doesNotMatch(source(path), /@tauri-apps|sqlite/i);
  }
});

test("NTU parsing stays pure and cannot create or persist courses", () => {
  const parser = source("src/importers/ntu-pdf/parse.ts");
  assert.match(parser, /PdfExtraction/);
  assert.match(parser, /ImportCandidate/);
  assert.doesNotMatch(
    parser,
    /(?:react|@tauri-apps|course-storage|\binsertStoredCourse\b|\bsaveStoredPeriodTimes\b|\binvoke\s*\()/i,
  );
});

test("PDF preview and proposal preparation cannot call storage adapters", () => {
  for (const path of ["src/components/PdfImportPreview.tsx", "src/core/import-proposal.ts"]) {
    const contents = source(path);
    assert.doesNotMatch(
      contents,
      /(?:@tauri-apps|course-storage|insertStoredCourse|updateStoredCourse|deleteStoredCourse|importStoredCourses|\binvoke\s*\()/i,
    );
  }
  assert.match(source("src/core/import-proposal.ts"), /validateCourseInput/);
});

test("batch PDF persistence crosses one frontend service and one Rust transaction command", () => {
  const service = source("src/services/course-storage.ts");
  const app = source("src/App.tsx");
  assert.match(service, /invoke<readonly Course\[]>\("import_courses", \{ courses \}\)/);
  assert.match(app, /importStoredCourses\(pendingImportCourses\)/);
  assert.doesNotMatch(app, /for[\s\S]{0,120}insertStoredCourse/);
});
