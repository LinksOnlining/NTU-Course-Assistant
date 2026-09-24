import type { WeatherErrorCategory } from "../../types/weather.ts";

const ERROR_CATEGORIES = new Set<WeatherErrorCategory>([
  "geocodingUnavailable",
  "reverseGeocodingUnavailable",
  "forecastUnavailable",
  "permissionDenied",
  "locationTimeout",
  "locationUnavailable",
  "lowAccuracy",
  "invalidProviderRequest",
  "offline",
]);

const MESSAGES: Record<WeatherErrorCategory, string> = {
  geocodingUnavailable: "地点搜索服务暂时不可用，请稍后重试。",
  reverseGeocodingUnavailable: "当前位置的地点名称暂时无法解析。",
  forecastUnavailable: "天气数据暂时不可用，请稍后重试。",
  permissionDenied: "定位权限未获准。你仍可手动搜索地点。",
  locationTimeout: "定位超时。请重试，或手动搜索地点。",
  locationUnavailable: "无法获取当前位置。请检查定位设置，或手动搜索地点。",
  lowAccuracy: "当前位置精度较低，暂未用于天气。请重试定位，或手动搜索区县。",
  invalidProviderRequest: "地点服务请求异常，请调整搜索内容后重试。",
  offline: "当前处于离线状态，请联网后重试。",
};

export function weatherErrorCategory(
  error: unknown,
  fallback: WeatherErrorCategory,
): WeatherErrorCategory {
  const value = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  if (ERROR_CATEGORIES.has(value as WeatherErrorCategory)) return value as WeatherErrorCategory;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "offline";
  return fallback;
}

export function weatherErrorMessage(category: WeatherErrorCategory): string {
  return MESSAGES[category];
}
