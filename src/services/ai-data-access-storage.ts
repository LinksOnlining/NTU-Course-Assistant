export const AI_DATA_ACCESS_SETTINGS_KEY = "links-workplace.ai.data-access";

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

export function loadAiDataAccessSettingsRecord(storage = browserStorage()): unknown {
  try {
    const raw = storage?.getItem(AI_DATA_ACCESS_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveAiDataAccessSettingsRecord(
  value: unknown,
  storage = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(AI_DATA_ACCESS_SETTINGS_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
