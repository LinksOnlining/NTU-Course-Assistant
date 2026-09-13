import { invoke } from "@tauri-apps/api/core";

function usesBrowserPreview(): boolean {
  return import.meta.env.DEV && !("__TAURI_INTERNALS__" in window);
}

export async function openWidgetPrototype(): Promise<void> {
  if (usesBrowserPreview()) return;
  try {
    await invoke("open_widget");
  } catch {
    throw new Error("无法打开桌面课程小组件原型，请稍后重试。");
  }
}
