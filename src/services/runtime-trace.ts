import { invoke } from "@tauri-apps/api/core";

function enabled(): boolean {
  return import.meta.env.DEV && "__TAURI_INTERNALS__" in window;
}

export function beginRuntimeTrace(stage: string, generation: number): (checkpoint: string) => void {
  const startedAt = performance.now();
  const emit = (checkpoint: string) => {
    if (!enabled()) return;
    void invoke("trace_runtime_event", {
      stage: `${stage}.${checkpoint}`,
      generation,
      elapsedMs: Math.round(performance.now() - startedAt),
    }).catch(() => undefined);
  };
  emit("start");
  return emit;
}
