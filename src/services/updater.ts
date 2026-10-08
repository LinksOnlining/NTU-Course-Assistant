import { check, type Update } from "@tauri-apps/plugin-updater";
import { isTransientUpdaterError } from "./updater-diagnostics.ts";
export type { Update } from "@tauri-apps/plugin-updater";

// The native updater owns its network timeout: no detached Promise.race request or timer.
const CHECK_TIMEOUT_MS = 25_000;
const RETRY_DELAY_MS = 750;

export async function checkForApplicationUpdate(): Promise<Update | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  try {
    return await check({ timeout: CHECK_TIMEOUT_MS });
  } catch (error) {
    if (!isTransientUpdaterError(error)) throw error;
    await new Promise<void>((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS));
    return check({ timeout: CHECK_TIMEOUT_MS });
  }
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
