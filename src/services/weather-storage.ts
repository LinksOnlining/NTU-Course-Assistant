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
  return normalizeWeatherLocation(value) !== null;
}

export function normalizeWeatherLocation(value: unknown): WeatherLocation | null {
  if (!isRecord(value)) return null;
  const precision = value.precision;
  const source = value.source;
  const stringFields = [
    "displayAddress",
    "country",
    "admin1",
    "admin2",
    "admin3",
    "admin4",
    "county",
    "street",
    "providerId",
    "provider",
    "type",
  ];
  if (
    stringFields.some(
      (key) => value[key] !== undefined && value[key] !== null && typeof value[key] !== "string",
    ) ||
    (precision !== undefined &&
      ![
        "house",
        "street",
        "locality",
        "district",
        "city",
        "county",
        "state",
        "country",
        "other",
        "region",
        "coordinatesOnly",
        "unknown",
      ].includes(String(precision))) ||
    (source !== undefined && source !== "manual" && source !== "device" && source !== "map") ||
    (value.coordinateSystem !== undefined &&
      value.coordinateSystem !== "gcj02" &&
      value.coordinateSystem !== "wgs84") ||
    typeof value.displayName !== "string" ||
    value.displayName.trim().length === 0 ||
    typeof value.latitude !== "number" ||
    !Number.isFinite(value.latitude) ||
    value.latitude < -90 ||
    value.latitude > 90 ||
    typeof value.longitude !== "number" ||
    !Number.isFinite(value.longitude) ||
    value.longitude < -180 ||
    value.longitude > 180 ||
    (value.timezone !== undefined && value.timezone !== null && typeof value.timezone !== "string")
  ) {
    return null;
  }
  const normalized: Record<string, unknown> = {
    displayName: value.displayName.trim(),
    latitude: value.latitude,
    longitude: value.longitude,
    coordinateSystem: value.coordinateSystem ?? "wgs84",
    timezone: typeof value.timezone === "string" ? value.timezone : null,
    source: source ?? "manual",
  };
  for (const key of stringFields) {
    if (typeof value[key] === "string" && value[key].trim()) normalized[key] = value[key].trim();
  }
  if (typeof precision === "string") normalized.precision = precision;
  return normalized as unknown as WeatherLocation;
}

export function loadWeatherSettings(storage = browserStorage()): WeatherSettings {
  try {
    const raw = storage?.getItem(WEATHER_SETTINGS_KEY);
    if (!raw) return DEFAULT_WEATHER_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_WEATHER_SETTINGS;
    const temperatureUnit: TemperatureUnit =
      parsed.temperatureUnit === "fahrenheit" ? "fahrenheit" : "celsius";
    const location = normalizeWeatherLocation(parsed.location);
    const settings: WeatherSettings = {
      enabled: parsed.enabled === true,
      location,
      temperatureUnit,
    };
    if (location && JSON.stringify(parsed.location) !== JSON.stringify(location)) {
      try {
        storage?.setItem(WEATHER_SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        // A legacy value is still usable when storage is temporarily read-only.
      }
    }
    return settings;
  } catch {
    return DEFAULT_WEATHER_SETTINGS;
  }
}

export function saveWeatherSettings(
  settings: WeatherSettings,
  storage = browserStorage(),
): boolean {
  try {
    const location = settings.location ? normalizeWeatherLocation(settings.location) : null;
    if (settings.location && !location) return false;
    storage?.setItem(WEATHER_SETTINGS_KEY, JSON.stringify({ ...settings, location }));
    return storage !== null;
  } catch {
    return false;
  }
}

function normalizeWeatherSnapshot(value: unknown): WeatherSnapshot | null {
  if (!isRecord(value)) return null;
  const location = normalizeWeatherLocation(value.location);
  if (!location) return null;
  if (
    typeof value.fetchedAt !== "string" ||
    !Number.isFinite(Date.parse(value.fetchedAt)) ||
    typeof value.timezone !== "string" ||
    !isRecord(value.current) ||
    !Array.isArray(value.hourly) ||
    !Array.isArray(value.daily) ||
    value.daily.length !== 7
  ) {
    return null;
  }
  const current = value.current;
  const valid =
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
    );
  return valid ? ({ ...value, location } as unknown as WeatherSnapshot) : null;
}

export function loadWeatherCache(storage = browserStorage()): WeatherSnapshot | null {
  try {
    const raw = storage?.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const snapshot = normalizeWeatherSnapshot(parsed);
    if (!snapshot) {
      storage?.removeItem(WEATHER_CACHE_KEY);
      return null;
    }
    if (isRecord(parsed) && JSON.stringify(parsed.location) !== JSON.stringify(snapshot.location)) {
      try {
        storage?.setItem(WEATHER_CACHE_KEY, JSON.stringify(snapshot));
      } catch {
        // Keep the valid in-memory cache even when migration cannot be persisted.
      }
    }
    return snapshot;
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
    const location = normalizeWeatherLocation(snapshot.location);
    if (!location) return false;
    storage?.setItem(WEATHER_CACHE_KEY, JSON.stringify({ ...snapshot, location }));
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
