import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";

const WIDGET_REFRESH_EVENT = "widget-data-changed";

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

export async function openMainWindow(): Promise<void> {
  if (usesBrowserPreview()) return;
  try {
    await invoke("open_main");
  } catch {
    throw new Error("无法打开课程表，请稍后重试。");
  }
}

export function notifyWidgetDataChanged(): void {
  if (usesBrowserPreview()) {
    window.dispatchEvent(new Event(WIDGET_REFRESH_EVENT));
    return;
  }
  void emit(WIDGET_REFRESH_EVENT).catch(() => undefined);
}

export function subscribeWidgetDataChanged(onChanged: () => void): () => void {
  window.addEventListener(WIDGET_REFRESH_EVENT, onChanged);
  let active = true;
  let unlisten: (() => void) | undefined;
  void listen(WIDGET_REFRESH_EVENT, onChanged)
    .then((stop) => {
      if (active) unlisten = stop;
      else void stop();
    })
    .catch(() => undefined);
  return () => {
    active = false;
    window.removeEventListener(WIDGET_REFRESH_EVENT, onChanged);
    unlisten?.();
  };
}
