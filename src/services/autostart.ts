import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

let developmentAutostartEnabled = false;

function usesDevelopmentMemory(): boolean {
  return import.meta.env.DEV && !("__TAURI_INTERNALS__" in window);
}

function asError(error: unknown, fallback: string): Error {
  return new Error(typeof error === "string" && error.trim() !== "" ? error : fallback);
}

export async function loadAutostartEnabled(): Promise<boolean> {
  if (usesDevelopmentMemory()) return developmentAutostartEnabled;
  try {
    return await isEnabled();
  } catch (error) {
    throw asError(error, "无法读取 Windows 登录启动状态，请稍后重试。");
  }
}

export async function saveAutostartEnabled(enabled: boolean): Promise<boolean> {
  if (usesDevelopmentMemory()) {
    developmentAutostartEnabled = enabled;
    return developmentAutostartEnabled;
  }
  try {
    if (enabled) await enable();
    else await disable();
  } catch (error) {
    throw asError(
      error,
      enabled ? "无法开启登录后自动启动，请稍后重试。" : "无法关闭登录后自动启动，请稍后重试。",
    );
  }
  return loadAutostartEnabled();
}
