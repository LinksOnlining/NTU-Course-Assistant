export const AI_PROVIDER_SETTINGS_KEY = "links-workplace.ai.provider-settings";

interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): SettingsStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadAiProviderSettingsRecord(storage = browserStorage()): unknown {
  try {
    const raw = storage?.getItem(AI_PROVIDER_SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

export function saveAiProviderSettingsRecord(value: unknown, storage = browserStorage()): boolean {
  if (!storage) return false;
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    const settings = {
      providerId: "deepseek",
      selectedModel: candidate.selectedModel,
      reasoningEffort: candidate.reasoningEffort,
      requestTimeoutSeconds: candidate.requestTimeoutSeconds,
    };
    storage.setItem(AI_PROVIDER_SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
