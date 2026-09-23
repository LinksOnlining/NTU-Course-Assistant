import type { ResolvedTheme, ThemePreference } from "./types.ts";

export const THEME_PREFERENCE_STORAGE_KEY = "links-workplace.theme-preference";

interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface SystemThemeQuery {
  readonly matches: boolean;
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
}

function browserStorage(): ThemeStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function parseThemePreference(value: string | null): ThemePreference {
  return value === "dark" || value === "system" ? value : "light";
}

export function getThemePreference(storage = browserStorage()): ThemePreference {
  try {
    return parseThemePreference(storage?.getItem(THEME_PREFERENCE_STORAGE_KEY) ?? null);
  } catch {
    return "light";
  }
}

export function saveThemePreference(preference: ThemePreference, storage = browserStorage()): void {
  try {
    storage?.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // Theme storage is optional; the application must remain usable without it.
  }
}

export function resolveTheme(
  preference: ThemePreference,
  systemTheme: ResolvedTheme,
): ResolvedTheme {
  return preference === "system" ? systemTheme : preference;
}

export function applyTheme(theme: ResolvedTheme, root: HTMLElement): void {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function subscribeToSystemTheme(
  preference: ThemePreference,
  query: SystemThemeQuery,
  onChange: (theme: ResolvedTheme) => void,
): () => void {
  if (preference !== "system") return () => undefined;

  const listener = () => onChange(query.matches ? "dark" : "light");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
