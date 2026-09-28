import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));

test("MSI upgrade code stays compatible with the NTU Course Assistant 1.3.x lineage", () => {
  assert.equal(config.productName, "Links Workplace");
  assert.equal(config.version, "2.0.0");
  assert.equal(config.identifier, "com.links.workplace.desktop");
  assert.equal(
    config.bundle.windows.wix.upgradeCode.toLowerCase(),
    "2f689303-b82c-571d-bcd4-3ddf71e745af",
  );
});
