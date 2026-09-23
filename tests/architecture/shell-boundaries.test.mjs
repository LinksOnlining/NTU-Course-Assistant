import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseSync } from "oxc-parser";

const shellRoot = fileURLToPath(new URL("../../src/shell/", import.meta.url));
const sourceFiles = readdirSync(shellRoot).filter((file) => /\.tsx?$/.test(file));

test("Shell presentation imports do not depend on Academic persistence, Tauri, or the database", () => {
  assert.ok(sourceFiles.length > 0);
  for (const file of sourceFiles) {
    const filePath = path.join(shellRoot, file);
    const source = readFileSync(filePath, "utf8");
    const { program, errors } = parseSync(filePath, source);
    assert.deepEqual(errors, [], file);
    const imports = program.body
      .filter((node) => node.type === "ImportDeclaration")
      .map((node) => node.source.value);
    assert.doesNotMatch(
      imports.join("\n"),
      /course-storage|academic-storage|@tauri-apps\/api\/core|sqlite|db\.rs/u,
      file,
    );
  }
});

test("Daily Quote remains local and contains no network, AI, or generated attribution path", () => {
  const filePath = path.join(shellRoot, "daily-quote.ts");
  const source = readFileSync(filePath, "utf8");
  assert.doesNotMatch(source, /fetch\s*\(|https?:\/\/|AI|OpenAI|Math\.random/u);
});

test("App routes unsupported pages to an explicit unavailable state instead of Today", () => {
  const appPath = fileURLToPath(new URL("../../src/App.tsx", import.meta.url));
  const source = readFileSync(appPath, "utf8");
  assert.match(source, /getShellRouteView\(currentRoute\)/u);
  assert.match(source, /isUnsupportedRoute\s*\?\s*\(/u);
  assert.match(source, /该模块尚未开放/u);
  assert.match(source, /返回工作台/u);
  assert.doesNotMatch(source, /getAcademicHubTab\(currentRoute\)\s*===\s*null\s*\?/u);
});
