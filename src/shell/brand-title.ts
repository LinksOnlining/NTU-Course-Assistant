export const DEFAULT_WORKPLACE_TITLE = "Links Workplace";
export const MAX_WORKPLACE_TITLE_LENGTH = 48;
export const WORKPLACE_TITLE_STORAGE_KEY = "links-workplace.header-title";

interface TitleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): TitleStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeWorkplaceTitle(input: string | null): string {
  const normalized = (input ?? "").replace(/\s+/gu, " ").trim();
  return normalized.slice(0, MAX_WORKPLACE_TITLE_LENGTH) || DEFAULT_WORKPLACE_TITLE;
}

export function getWorkplaceTitle(storage = browserStorage()): string {
  try {
    return normalizeWorkplaceTitle(storage?.getItem(WORKPLACE_TITLE_STORAGE_KEY) ?? null);
  } catch {
    return DEFAULT_WORKPLACE_TITLE;
  }
}

export function saveWorkplaceTitle(value: string, storage = browserStorage()): string {
  const normalized = normalizeWorkplaceTitle(value);
  try {
    storage?.setItem(WORKPLACE_TITLE_STORAGE_KEY, normalized);
  } catch {
    // Local preference storage is optional.
  }
  return normalized;
}
