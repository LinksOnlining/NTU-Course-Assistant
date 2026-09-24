import type {
  TemperatureUnit,
  WeatherLocation,
  WeatherSettings,
  WeatherSnapshot,
} from "../types/weather.ts";

export const WEATHER_SETTINGS_KEY = "links-workplace.weather.settings";
export const WEATHER_CACHE_KEY = "links-workplace.weather.cache";

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const DEFAULT_WEATHER_SETTINGS: WeatherSettings = {
  enabled: false,
  location: null,
  temperatureUnit: "celsius",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isWeatherLocation(value: unknown): value is WeatherLocation {
  return (
    isRecord(value) &&
    typeof value.displayName === "string" &&
    value.displayName.trim().length > 0 &&
    typeof value.latitude === "number" &&
    Number.isFinite(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.longitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180 &&
    (value.timezone === null || typeof value.timezone === "string")
  );
}

export function loadWeatherSettings(storage = browserStorage()): WeatherSettings {
  try {
    const raw = storage?.getItem(WEATHER_SETTINGS_KEY);
    if (!raw) return DEFAULT_WEATHER_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_WEATHER_SETTINGS;
    const temperatureUnit: TemperatureUnit =
      parsed.temperatureUnit === "fahrenheit" ? "fahrenheit" : "celsius";
    return {
      enabled: parsed.enabled === true,
      location: isWeatherLocation(parsed.location) ? parsed.location : null,
      temperatureUnit,
    };
  } catch {
    return DEFAULT_WEATHER_SETTINGS;
  }
}

export function saveWeatherSettings(
  settings: WeatherSettings,
  storage = browserStorage(),
): boolean {
  try {
    storage?.setItem(WEATHER_SETTINGS_KEY, JSON.stringify(settings));
    return storage !== null;
  } catch {
    return false;
  }
}

function isWeatherSnapshot(value: unknown): value is WeatherSnapshot {
  if (!isRecord(value) || !isWeatherLocation(value.location)) return false;
  if (
    typeof value.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(value.fetchedAt)) ||
    typeof value.timezone !== "string" ||
    !isRecord(value.current) ||
    !Array.isArray(value.hourly) ||
    !Array.isArray(value.daily) ||
    value.daily.length !== 7
  ) {
    return false;
  }
  const current = value.current;
  return (
    typeof current.time === "string" &&
    typeof current.temperatureCelsius === "number" &&
    (current.apparentTemperatureCelsius === null ||
      typeof current.apparentTemperatureCelsius === "number") &&
    typeof current.weatherCode === "number" &&
    typeof current.isDay === "boolean" &&
    (current.humidityPercent === null || typeof current.humidityPercent === "number") &&
    value.hourly.every(
      (item) =>
        isRecord(item) &&
        typeof item.time === "string" &&
        typeof item.temperatureCelsius === "number" &&
        (item.precipitationProbability === null ||
          typeof item.precipitationProbability === "number") &&
        typeof item.weatherCode === "number",
    ) &&
    value.daily.every(
      (item) =>
        isRecord(item) &&
        typeof item.date === "string" &&
        typeof item.highCelsius === "number" &&
        typeof item.lowCelsius === "number" &&
        (item.precipitationProbability === null ||
          typeof item.precipitationProbability === "number") &&
        typeof item.weatherCode === "number",
    )
  );
}

export function loadWeatherCache(storage = browserStorage()): WeatherSnapshot | null {
  try {
    const raw = storage?.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isWeatherSnapshot(parsed)) {
      storage?.removeItem(WEATHER_CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    try {
      storage?.removeItem(WEATHER_CACHE_KEY);
    } catch {
      // A broken cache must not break the application.
    }
    return null;
  }
}

export function saveWeatherCache(snapshot: WeatherSnapshot, storage = browserStorage()): boolean {
  try {
    storage?.setItem(WEATHER_CACHE_KEY, JSON.stringify(snapshot));
    return storage !== null;
  } catch {
    return false;
  }
}

export function removeWeatherCache(storage = browserStorage()): void {
  try {
    storage?.removeItem(WEATHER_CACHE_KEY);
  } catch {
    // Cache is optional; storage failures stay isolated.
  }
}
