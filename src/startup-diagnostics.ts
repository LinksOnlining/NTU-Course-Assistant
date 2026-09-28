export interface StartupDiagnosticEntry {
  readonly stage: string;
  readonly at: number;
  readonly details?: unknown;
}

interface StartupDiagnostics {
  readonly entries: StartupDiagnosticEntry[];
  readonly record: (stage: string, details?: unknown) => void;
}

declare global {
  interface Window {
    __LW_STARTUP_DIAGNOSTICS__?: StartupDiagnostics;
  }
}

export function recordStartupStage(stage: string, details?: unknown): void {
  window.__LW_STARTUP_DIAGNOSTICS__?.record(stage, details);
}
