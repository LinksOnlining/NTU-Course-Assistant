import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("React orchestration uses the course storage service rather than Tauri or SQL directly", () => {
  const app = source("src/App.tsx");
  assert.match(app, /services\/course-storage\.ts/);
  assert.doesNotMatch(app, /@tauri-apps|\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i);
});

test("only the service adapter imports the frontend Tauri API", () => {
  const service = source("src/services/course-storage.ts");
  assert.match(service, /@tauri-apps\/api\/core/);
  for (const path of [
    "src/core/course-input.ts",
    "src/core/time.ts",
    "src/core/timetable-layout.ts",
  ]) {
    assert.doesNotMatch(source(path), /@tauri-apps|sqlite/i);
  }
});
