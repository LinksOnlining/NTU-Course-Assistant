export const DAILY_BRIEF_PREFERENCES_KEY = "links-workplace.ai.daily-brief";
export const DAILY_BRIEF_PREFERENCES_EVENT = "links-workplace:daily-brief-preferences-changed";

export interface DailyBriefPreferences {
  readonly enabled: boolean;
  readonly lastAutoShownDate: string | null;
}

export const DEFAULT_DAILY_BRIEF_PREFERENCES: DailyBriefPreferences = Object.freeze({
  enabled: false,
  lastAutoShownDate: null,
});

export function normalizeDailyBriefPreferences(value: unknown): DailyBriefPreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_DAILY_BRIEF_PREFERENCES;
  }
  const candidate = value as Record<string, unknown>;
  const date = candidate.lastAutoShownDate;
  return Object.freeze({
    enabled: candidate.enabled === true,
    lastAutoShownDate: typeof date === "string" && isDate(date) ? date : null,
  });
}

export function shouldAutoShowDailyBrief(
  preferences: DailyBriefPreferences,
  localDate: string,
): boolean {
  return preferences.enabled && isDate(localDate) && preferences.lastAutoShownDate !== localDate;
}

interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function browserStorage(): SettingsStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadDailyBriefPreferences(storage = browserStorage()): DailyBriefPreferences {
  try {
    const raw = storage?.getItem(DAILY_BRIEF_PREFERENCES_KEY);
    return normalizeDailyBriefPreferences(raw ? JSON.parse(raw) : DEFAULT_DAILY_BRIEF_PREFERENCES);
  } catch {
    return DEFAULT_DAILY_BRIEF_PREFERENCES;
  }
}

export function saveDailyBriefPreferences(value: unknown, storage = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      DAILY_BRIEF_PREFERENCES_KEY,
      JSON.stringify(normalizeDailyBriefPreferences(value)),
    );
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(DAILY_BRIEF_PREFERENCES_EVENT));
    }
    return true;
  } catch {
    return false;
  }
}
