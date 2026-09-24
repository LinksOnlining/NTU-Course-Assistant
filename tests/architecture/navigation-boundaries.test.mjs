import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseSync } from "oxc-parser";

const sourceRoot = fileURLToPath(new URL("../../src/", import.meta.url));
const contractPath = path.join(sourceRoot, "navigation", "types.ts");
const helpersPath = path.join(sourceRoot, "navigation", "navigation.ts");

test("navigation types are plain declarations without runtime or platform imports", () => {
  const source = readFileSync(contractPath, "utf8");
  const { program, errors } = parseSync(contractPath, source);
  assert.deepEqual(errors, []);
  assert.equal(
    program.body.some((node) => node.type === "ImportDeclaration"),
    false,
  );
  assert.doesNotMatch(source, /React|@tauri-apps|storage|components|sqlite/i);
});

test("navigation helpers use typed contracts and the immutable route registry only", () => {
  const source = readFileSync(helpersPath, "utf8");
  const { program, errors } = parseSync(helpersPath, source);
  assert.deepEqual(errors, []);

  const imports = program.body.filter((node) => node.type === "ImportDeclaration");
  assert.deepEqual(
    imports.map((item) => [item.source.value, item.importKind]),
    [
      ["./types.ts", "type"],
      ["../modules/contracts.ts", "type"],
      ["../modules/registry.ts", "value"],
    ],
  );
  assert.doesNotMatch(
    source,
    /React|@tauri-apps|course-storage|academic-storage|components|sqlite/i,
  );
});
