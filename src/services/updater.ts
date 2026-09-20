import { check, type Update } from "@tauri-apps/plugin-updater";
export type { Update } from "@tauri-apps/plugin-updater";

const CHECK_TIMEOUT_MS = 10_000;

export async function checkForApplicationUpdate(): Promise<Update | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  return Promise.race([
    check(),
    new Promise<never>((_, reject) =>
      window.setTimeout(() => reject(new Error("检查更新超时。")), CHECK_TIMEOUT_MS),
    ),
  ]);
}

export async function installApplicationUpdate(
  update: Update,
  onProgress: (downloaded: number, contentLength: number | null) => void,
): Promise<void> {
  let contentLength: number | null = null;
  let downloaded = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") contentLength = event.data.contentLength ?? null;
    if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      onProgress(downloaded, contentLength);
    }
  });
}
