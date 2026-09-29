import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
const hookPath = path.join(root, "src-tauri/windows/nsis-hooks.nsh");
const hook = readFileSync(hookPath, "utf8");
const wixCleanupPath = path.join(root, "src-tauri/windows/wix/legacy-shortcut-cleanup.wxs");
const wixCleanup = readFileSync(wixCleanupPath, "utf8");

test("MSI upgrade code stays compatible with the NTU Course Assistant 1.3.x lineage", () => {
  assert.equal(config.productName, "Links Workplace");
  assert.equal(config.version, "2.0.0");
  assert.equal(config.identifier, "com.links.workplace.desktop");
  assert.equal(
    config.bundle.windows.wix.upgradeCode.toLowerCase(),
    "2f689303-b82c-571d-bcd4-3ddf71e745af",
  );
});

test("MSI upgrade retires only the two exact legacy NTU shortcuts", () => {
  assert.deepEqual(config.bundle.windows.wix.fragmentPaths, [
    "windows/wix/legacy-shortcut-cleanup.wxs",
  ]);
  assert.deepEqual(config.bundle.windows.wix.componentRefs, [
    "RetireLegacyNtuStartMenuShortcut",
    "RetireLegacyNtuDesktopShortcut",
  ]);
  assert.match(
    wixCleanup,
    /DirectoryRef Id="ProgramMenuFolder"[\s\S]*?Name="NTU Course Assistant"/,
  );
  assert.match(wixCleanup, /DirectoryRef Id="DesktopFolder"/);
  assert.equal((wixCleanup.match(/<RemoveFile\b/g) ?? []).length, 2);
  assert.equal(
    (wixCleanup.match(/Name="NTU Course Assistant\.lnk" On="install"/g) ?? []).length,
    2,
  );
  assert.equal((wixCleanup.match(/<RemoveFolder\b/g) ?? []).length, 1);
  assert.match(wixCleanup, /RemoveFolder Id="RemoveEmptyLegacyNtuProgramsFolder" On="uninstall"/);
  assert.doesNotMatch(
    wixCleanup,
    /\*\.lnk|courses\.sqlite3|com\.ntu-course-assistant\.desktop|links-workplace\.exe|<CustomAction/i,
  );
});

test("Tauri NSIS installerHooks config loads the preinstall retirement hook", () => {
  assert.equal(config.bundle.windows.nsis.installerHooks, "windows/nsis-hooks.nsh");
  assert.equal(existsSync(hookPath), true);
  assert.match(hook, /!macro NSIS_HOOK_PREINSTALL/);
  assert.match(hook, /Call LinksValidateLegacyNtuInstall/);
  assert.match(hook, /Call LinksUninstallLegacyNtuInstall/);
  assert.doesNotMatch(JSON.stringify(config.bundle.windows.nsis), /template/i);
});

test("fresh install and Links reinstall take the exact no-legacy no-op branch", () => {
  assert.match(hook, /Call LinksLegacyArpKeyExists[\s\S]*?StrCmp \$0 0 links_legacy_no_install/);
  const start = hook.indexOf("links_legacy_no_install:");
  const end = hook.indexOf("links_legacy_untrusted:", start);
  const noLegacyBlock = hook.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(noLegacyBlock, /No NTU Course Assistant uninstall entry found/);
  assert.match(noLegacyBlock, /Return/);
  assert.doesNotMatch(noLegacyBlock, /FindProcessCurrentUser|ExecWait/);
  assert.doesNotMatch(JSON.stringify(config.bundle.windows.nsis), /template/i);
});

test("only exact v1.3.0 and v1.3.1 legacy identity paths are supported", () => {
  assert.match(
    hook,
    /!define LINKS_LEGACY_UNINSTALL_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NTU Course Assistant"/,
  );
  assert.match(hook, /!define LINKS_LEGACY_DISPLAY_NAME "NTU Course Assistant"/);
  assert.match(hook, /!define LINKS_LEGACY_PUBLISHER "ntu-course-assistant"/);
  assert.match(hook, /!define LINKS_LEGACY_EXE "ntu-course-assistant\.exe"/);
  assert.match(hook, /StrCmp \$4 "1\.3\.0" links_legacy_supported/);
  assert.match(hook, /StrCmp \$4 "1\.3\.1" links_legacy_supported/);
  assert.match(hook, /StrCmp \$4 \$3 0 links_legacy_untrusted/);
  assert.match(hook, /MainBinaryName/);
  assert.match(hook, /!define LINKS_LEGACY_MANUFACTURER_KEY/);
});

test("unknown or mismatched legacy entries are retained and stop Links setup", () => {
  assert.match(hook, /Goto links_legacy_untrusted/);
  assert.match(hook, /links_legacy_untrusted:[\s\S]*?Call LinksLegacyNotSafelyIdentifiable/);
  assert.match(hook, /Legacy not safely identifiable/);
  assert.match(hook, /Function LinksLegacyNotSafelyIdentifiable[\s\S]*?Abort/);
});

test("retirement checks current-user process state before synchronous silent uninstall", () => {
  const preinstallStart = hook.indexOf("!macro NSIS_HOOK_PREINSTALL");
  const preinstallEnd = hook.indexOf("!macroend", preinstallStart);
  const preinstall = hook.slice(preinstallStart, preinstallEnd);
  const validationCall = preinstall.indexOf("Call LinksValidateLegacyNtuInstall");
  const processCheck = preinstall.indexOf("FindProcessCurrentUser");
  const uninstallCall = preinstall.indexOf("Call LinksUninstallLegacyNtuInstall");
  const validationStart = hook.indexOf("Function LinksValidateLegacyNtuInstall");
  const validationFunction = hook.slice(
    validationStart,
    hook.indexOf("FunctionEnd", validationStart),
  );
  const uninstallStart = hook.indexOf("Function LinksUninstallLegacyNtuInstall");
  const uninstallFunction = hook.slice(uninstallStart, hook.indexOf("FunctionEnd", uninstallStart));

  assert.ok(validationCall >= 0 && validationCall < processCheck);
  assert.ok(processCheck < uninstallCall);
  assert.match(preinstall, /StrCmp \$4 0 links_legacy_process_running/);
  assert.doesNotMatch(validationFunction, /FindProcessCurrentUser/);
  assert.doesNotMatch(uninstallFunction, /FindProcessCurrentUser/);
  assert.match(uninstallFunction, /ExecWait '.*\/S \/P _\?=\$2' \$5/);
  assert.doesNotMatch(hook, /KillProcess/);
  assert.match(hook, /Function LinksLegacyProcessRunning[\s\S]*?Please close NTU Course Assistant/);
});

test("post-uninstall gates require old ARP, executable, uninstall stub, and shortcuts gone", () => {
  assert.match(hook, /Call LinksLegacyArpKeyStillExists/);
  assert.match(hook, /links_legacy_arp_removed:/);
  assert.match(hook, /IfFileExists "\$2\\\$\{LINKS_LEGACY_EXE\}" links_legacy_uninstall_failed/);
  assert.match(hook, /Delete "\$2\\uninstall\.exe"/);
  assert.match(
    hook,
    /IfFileExists "\$SMPROGRAMS\\NTU Course Assistant\.lnk" links_legacy_uninstall_failed/,
  );
  assert.match(
    hook,
    /IfFileExists "\$DESKTOP\\NTU Course Assistant\.lnk" links_legacy_uninstall_failed/,
  );
  assert.doesNotMatch(hook, /RMDir/i);
});

test("hook does not delete legacy AppData, database files, or dev-v2", () => {
  assert.doesNotMatch(hook, /Delete\s+.*courses\.sqlite3/i);
  assert.doesNotMatch(hook, /dev-v2/i);
  assert.doesNotMatch(hook, /com\.ntu-course-assistant\.desktop/i);
  assert.doesNotMatch(hook, /HKLM|HKEY_USERS/);
  assert.doesNotMatch(hook, /Rename\s|CopyFiles\s/i);
});
