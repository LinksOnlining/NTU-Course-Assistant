import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { boundaryViolations } from "./boundary-check.mjs";

const root = fileURLToPath(new URL("../../src/", import.meta.url));
const coreFile = path.join(root, "core", "probe.ts");
const check = (source) => boundaryViolations(coreFile, source, root);

for (const layer of ["core", "types", "config"]) {
  const directory = path.join(root, layer);
  for (const name of readdirSync(directory, { recursive: true }).filter((n) => /\.tsx?$/.test(n))) {
    const filename = path.join(directory, name);
    test(`actual boundary ${layer}/${name}`, () => {
      assert.deepEqual(boundaryViolations(filename, readFileSync(filename, "utf8"), root), []);
    });
  }
}

for (const source of [
  'import React from "react";',
  'import { invoke } from "@tauri-apps/api/core";',
  'import fs from "node:fs";',
  'import type { X } from "react";',
  'import { TEST_TIMETABLE } from "../config/timetable.ts";',
  'import "./../config/timetable.ts";',
  'export * from "../App.tsx";',
  'import { X } from "../types/time.ts";',
  'const x = import("node:fs");',
  'type X = import("../App.tsx");',
  'document.querySelector("div");',
  'globalThis["fetch"]("https://example.com");',
  "process.env.TEST;",
  "const x = Date.now();",
  "setTimeout(() => {}, 1);",
  "const x: any = 1;",
]) {
  test(`guard rejects ${source}`, () => assert(check(source).length > 0));
}

test("guard accepts pure functions, local composition and type-only contracts", () => {
  assert.deepEqual(
    check(
      'import type { TimeRange } from "../types/time.ts"; import { durationMinutes } from "./time.ts"; export const f = (x: TimeRange) => Math.max(0, durationMinutes(x));',
    ),
    [],
  );
  const nested = path.join(root, "core", "nested", "probe.ts");
  assert.deepEqual(
    boundaryViolations(nested, 'import { durationMinutes } from "../time.ts";', root),
    [],
  );
});

test("types cannot smuggle runtime code back into core", () => {
  assert(
    boundaryViolations(path.join(root, "types", "probe.ts"), "export const x = 1;", root).length >
      0,
  );
});
