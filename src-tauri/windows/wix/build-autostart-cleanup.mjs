import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("The MSI autostart cleanup action currently requires an x64 Windows build host.");
}

const directory = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(directory, "autostart_cleanup.rs");
const output = path.join(directory, "autostart-cleanup.dll");
if (!existsSync(source)) throw new Error(`Missing MSI cleanup source: ${source}`);
const temporaryDirectory = mkdtempSync(path.join(directory, `.autostart-cleanup-${process.pid}-`));
const temporary = path.join(temporaryDirectory, "autostart-cleanup.dll");

try {
  execFileSync(
    "rustc",
    [
      "--crate-name=links_workplace_autostart_cleanup",
      "--edition=2021",
      "--crate-type=cdylib",
      "-C",
      "panic=abort",
      source,
      "-o",
      temporary,
    ],
    { stdio: "inherit" },
  );
  if (!existsSync(temporary)) throw new Error("rustc did not produce the MSI custom action DLL.");
  rmSync(output, { force: true });
  renameSync(temporary, output);
  console.log("MSI autostart cleanup action: built x64 DLL");
} finally {
  const resolvedDirectory = path.resolve(temporaryDirectory);
  const resolvedParent = `${path.resolve(directory)}${path.sep}`;
  if (!resolvedDirectory.startsWith(resolvedParent)) {
    throw new Error(
      "Refusing to remove a custom-action build directory outside its source folder.",
    );
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
