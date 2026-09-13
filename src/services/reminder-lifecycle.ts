import { listen, TauriEvent } from "@tauri-apps/api/event";

export function subscribeReminderResume(onResume: () => void): () => void {
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") onResume();
  };
  window.addEventListener("focus", onResume);
  document.addEventListener("visibilitychange", onVisibilityChange);
  let active = true;
  let unlisten: (() => void) | undefined;
  void listen(TauriEvent.WINDOW_RESUMED, onResume)
    .then((stop) => {
      if (active) unlisten = stop;
      else void stop();
    })
    .catch(() => undefined);
  return () => {
    active = false;
    window.removeEventListener("focus", onResume);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    unlisten?.();
  };
}
