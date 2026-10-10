import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
const libSource = readFileSync(path.join(root, "src-tauri/src/lib.rs"), "utf8");
const dbSource = readFileSync(path.join(root, "src-tauri/src/db.rs"), "utf8");
const wixPath = path.join(root, "src-tauri/windows/wix/autostart-cleanup.wxs");
const wix = readFileSync(wixPath, "utf8");
const autostartCleanup = readFileSync(
  path.join(root, "src-tauri/windows/wix/autostart_cleanup.rs"),
  "utf8",
);

test("Links Workplace uses its clean-start product and MSI upgrade identity", () => {
  assert.equal(config.productName, "Links Workplace");
  assert.equal(config.version, "2.0.4");
  assert.equal(config.identifier, "com.links.workplace.desktop");
  assert.equal(config.bundle.windows.wix.upgradeCode, "2f689303-b82c-571d-bcd4-3ddf71e745af");
});

test("runtime opens only the Links app-local database and has no NTU migration path", () => {
  assert.match(libSource, /app_local_data_dir\(\)/);
  assert.doesNotMatch(
    libSource,
    /\.local_data_dir\(\)|release_data_migration|com\.ntu-course-assistant\.desktop/i,
  );
  assert.equal(existsSync(path.join(root, "src-tauri/src/release_data_migration.rs")), false);
  assert.match(dbSource, /fn read_existing_schema_version\([\s\S]*?SQLITE_OPEN_READ_ONLY/);
  assert.match(dbSource, /version != CURRENT_SCHEMA_VERSION[\s\S]*?UnsupportedSchema\(version\)/);
  assert.doesNotMatch(libSource, /来自较新版本|自动升级|迁移来源/i);
});

test("MSI fragment keeps Links autostart cleanup and removes legacy shortcut cleanup", () => {
  assert.deepEqual(config.bundle.windows.wix.fragmentPaths, ["windows/wix/autostart-cleanup.wxs"]);
  assert.deepEqual(config.bundle.windows.wix.componentRefs, [
    "LinksWorkplaceAutostartCleanupAnchor",
  ]);
  assert.equal(
    existsSync(path.join(root, "src-tauri/windows/wix/legacy-shortcut-cleanup.wxs")),
    false,
  );
  assert.match(wix, /SourceFile="\$\(sys\.SOURCEFILEDIR\)autostart-cleanup\.dll"/);
  assert.match(wix, /Component Id="LinksWorkplaceAutostartCleanupAnchor"/);
  assert.match(wix, /<CreateFolder\s*\/>/);
  assert.match(wix, /Property="RemoveLinksWorkplaceAutostart"/);
  assert.match(wix, /Value="\[INSTALLDIR\]links-workplace\.exe"/);
  assert.match(wix, /DllEntry="RemoveLinksWorkplaceAutostart"/);
  assert.match(wix, /Execute="deferred"\s+Impersonate="no"\s+Return="check"/);
  assert.match(wix, /deferred action resolves MSI UserSID and opens HKEY_USERS explicitly/i);
  assert.match(wix, /REMOVE="ALL" AND NOT UPGRADINGPRODUCTCODE/);
  assert.match(wix, /Before="RemoveFiles"/);
  assert.doesNotMatch(
    wix,
    /NTU|ntu-course-assistant|courses\.sqlite3|<RemoveFile\b|<RemoveFolder\b/i,
  );
  assert.match(autostartCleanup, /Software\\Microsoft\\Windows\\CurrentVersion\\Run/);
  assert.match(
    autostartCleanup,
    /const RUN_VALUE_NAMES: \[&str; 2\] = \["Links Workplace", "links-workplace"\]/,
  );
  assert.match(autostartCleanup, /should_remove_owned_value/);
  assert.match(autostartCleanup, /HKEY_USERS/);
  assert.match(autostartCleanup, /msi_property\(install, "UserSID", "UserSID"\)/);
  assert.match(autostartCleanup, /CommandLineToArgvW/);
  assert.match(autostartCleanup, /GetFullPathNameW/);
  assert.match(autostartCleanup, /CompareStringOrdinal/);
  assert.doesNotMatch(autostartCleanup, /HKEY_CURRENT_USER/);
  assert.match(autostartCleanup, /KEY_WOW64_64KEY/);
  assert.match(autostartCleanup, /let mut probe = \[0u16; 1\]/);
  assert.match(autostartCleanup, /CustomActionData/);
  assert.match(
    autostartCleanup,
    /#\[no_mangle\][\s\S]*?pub extern "system" fn RemoveLinksWorkplaceAutostart/,
  );
});

test("NSIS does not run an NTU preinstall retirement hook", () => {
  assert.equal(config.bundle.windows.nsis?.installerHooks, undefined);
  assert.equal(existsSync(path.join(root, "src-tauri/windows/nsis-hooks.nsh")), false);
  assert.doesNotMatch(JSON.stringify(config.bundle.windows.nsis ?? {}), /NTU|legacy|template/i);
});
