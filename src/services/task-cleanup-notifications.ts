import { listen } from "@tauri-apps/api/event";

/** Keep native event subscriptions behind the services boundary. */
export async function subscribeCompletedTaskCleanup(onCleanup: () => void): Promise<() => void> {
  if (!("__TAURI_INTERNALS__" in window)) return () => {};
  try {
    return await listen("completed-tasks-pruned", onCleanup);
  } catch {
    // An unavailable event bridge must not disable task management.
    return () => {};
  }
}
