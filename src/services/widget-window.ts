import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { WidgetSettings } from "../types/widget-settings.ts";

const WIDGET_REFRESH_EVENT = "widget-data-changed";
const WIDGET_SETTINGS_EVENT = "widget-settings-changed";

function usesBrowserPreview(): boolean {
  return import.meta.env.DEV && !("__TAURI_INTERNALS__" in window);
}

export async function showWidget(): Promise<void> {
  if (usesBrowserPreview()) return;
  try {
    await invoke("open_widget");
  } catch {
    throw new Error("无法打开桌面课程小组件原型，请稍后重试。");
  }
}

export async function hideWidget(): Promise<void> {
  if (usesBrowserPreview()) return;
  try {
    await invoke("hide_widget");
  } catch {
    throw new Error("无法关闭桌面课程小组件，请稍后重试。");
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

export async function startWidgetDragging(): Promise<void> {
  if (usesBrowserPreview()) return;
  try {
    await getCurrentWindow().startDragging();
  } catch {
    throw new Error("无法移动小组件，请稍后重试。");
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

export function notifyWidgetSettingsChanged(): void {
  if (usesBrowserPreview()) {
    window.dispatchEvent(new Event(WIDGET_SETTINGS_EVENT));
    return;
  }
  void emit(WIDGET_SETTINGS_EVENT).catch(() => undefined);
}

export function subscribeWidgetSettingsChanged(onChanged: () => void): () => void {
  window.addEventListener(WIDGET_SETTINGS_EVENT, onChanged);
  let active = true;
  let unlisten: (() => void) | undefined;
  void listen(WIDGET_SETTINGS_EVENT, onChanged)
    .then((stop) => {
      if (active) unlisten = stop;
      else void stop();
    })
    .catch(() => undefined);
  return () => {
    active = false;
    window.removeEventListener(WIDGET_SETTINGS_EVENT, onChanged);
    unlisten?.();
  };
}

export function subscribeWidgetBounds(
  onBounds: (bounds: Pick<WidgetSettings, "x" | "y" | "width" | "height">) => void,
): () => void {
  if (usesBrowserPreview()) return () => undefined;
  const current = getCurrentWindow();
  let active = true;
  const stops: (() => void)[] = [];
  void current
    .onMoved(({ payload }) => {
      void current
        .innerSize()
        .then((size) => onBounds({ x: payload.x, y: payload.y, ...size }))
        .catch(() => undefined);
    })
    .then((stop) => {
      if (active) stops.push(stop);
      else void stop();
    })
    .catch(() => undefined);
  void current
    .onResized(({ payload }) => {
      void current
        .outerPosition()
        .then((position) => onBounds({ ...position, width: payload.width, height: payload.height }))
        .catch(() => undefined);
    })
    .then((stop) => {
      if (active) stops.push(stop);
      else void stop();
    })
    .catch(() => undefined);
  return () => {
    active = false;
    stops.forEach((stop) => stop());
  };
}
