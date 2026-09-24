import type {
  TemperatureUnit,
  WeatherLocation,
  WeatherLocationPrecision,
  WeatherSnapshot,
  WorkspaceWeatherProvider,
} from "../../types/weather.ts";
import { createOpenMeteoProvider } from "../../services/weather-provider.ts";
import { createPhotonReverseGeocodingProvider } from "../../services/reverse-geocoding-provider.ts";
import { createPhotonLocationSearchProvider } from "../../services/photon-location-provider.ts";
import type { GeocodingFetch } from "../../services/native-geocoding-transport.ts";
import { nativeGeocodingFetch } from "../../services/native-geocoding-transport.ts";

/** Weather Application boundary owns the production provider selection. */
export function createWorkspaceWeatherProvider(
  fetcher: typeof fetch = fetch,
  geocodingFetcher: GeocodingFetch = fetcher === fetch ? nativeGeocodingFetch : fetcher,
): WorkspaceWeatherProvider {
  return {
    ...createOpenMeteoProvider(fetcher),
    ...createPhotonLocationSearchProvider(geocodingFetcher),
    ...createPhotonReverseGeocodingProvider(geocodingFetcher),
  };
}

export function weatherLocationHierarchy(location: WeatherLocation): string[] {
  return [
    location.displayName,
    location.street,
    location.admin4,
    location.admin3,
    location.county,
    location.admin2,
    location.admin1,
    location.country,
  ].filter((part, index, parts): part is string => Boolean(part) && parts.indexOf(part) === index);
}

export function weatherLocationPrecisionLabel(
  precision: WeatherLocationPrecision | undefined,
): string {
  switch (precision ?? "unknown") {
    case "locality":
      return "街镇/片区级";
    case "district":
      return "区县级";
    case "city":
      return "城市级";
    case "region":
      return "省/州级";
    case "state":
      return "省/州级";
    case "county":
      return "县级";
    case "country":
      return "国家级";
    case "street":
      return "道路级";
    case "house":
      return "门牌/建筑级";
    case "other":
      return "地点级";
    case "coordinatesOnly":
      return "地点名称暂不可解析";
    case "unknown":
      return "精度信息未提供";
  }
}

export function weatherLocationSourceLabel(source: WeatherLocation["source"]): string {
  return source === "device" ? "当前位置" : "手动选择";
}

export const WEATHER_FRESH_FOR_MS = 30 * 60 * 1000;
export const WEATHER_STALE_FOR_MS = 24 * 60 * 60 * 1000;

export function weatherLocationKey(location: WeatherLocation): string {
  return `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
}

export function weatherLocationIdentity(location: WeatherLocation): string {
  return location.providerId
    ? `osm:${location.providerId}`
    : `${location.latitude.toFixed(6)},${location.longitude.toFixed(6)}:${location.displayName}`;
}

export function classifyWeatherCache(
  snapshot: WeatherSnapshot | null,
  location: WeatherLocation,
  now = Date.now(),
): "missing" | "fresh" | "stale" | "expired" {
  if (!snapshot || weatherLocationKey(snapshot.location) !== weatherLocationKey(location)) {
    return "missing";
  }
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(fetchedAt) || fetchedAt > now) return "expired";
  const age = now - fetchedAt;
  if (age <= WEATHER_FRESH_FOR_MS) return "fresh";
  if (age <= WEATHER_STALE_FOR_MS) return "stale";
  return "expired";
}

export function formatTemperature(valueCelsius: number, unit: TemperatureUnit): string {
  const value = unit === "fahrenheit" ? (valueCelsius * 9) / 5 + 32 : valueCelsius;
  return `${Math.round(value)}°${unit === "fahrenheit" ? "F" : "C"}`;
}

export function weatherCodeLabel(code: number): string {
  if (code === 0) return "晴";
  if (code === 1) return "大致晴朗";
  if (code === 2) return "局部多云";
  if (code === 3) return "阴";
  if ([45, 48].includes(code)) return "有雾";
  if ([51, 53, 55, 56, 57].includes(code)) return "毛毛雨";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "有雨";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "有雪";
  if ([95, 96, 99].includes(code)) return "雷雨";
  return "天气情况未知";
}

export function formatWeatherTime(value: string): string {
  const localTime = /(?:T| )(\d{2}:\d{2})/u.exec(value)?.[1];
  return localTime ?? value;
}

export function formatWeatherDate(value: string): string {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return date ? `${Number(date[2])}月${Number(date[3])}日` : value;
}
