import type { WeatherErrorCategory } from "../../types/weather.ts";

const ERROR_CATEGORIES = new Set<WeatherErrorCategory>([
  "geocodingUnavailable",
  "locationProvidersNotConfigured",
  "locationProviderRateLimited",
  "weatherCredentialUnavailable",
  "credentialStoreUnavailable",
  "locationProvidersUnavailable",
  "mapUnavailable",
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
  locationProvidersNotConfigured:
    "地点搜索服务尚未配置。可在高级设置中配置服务密钥，或直接使用经纬度。",
  locationProviderRateLimited: "地点服务请求过于频繁，请稍后重试，或使用地图/经纬度选点。",
  weatherCredentialUnavailable: "地点服务密钥不可用，请检查高级设置中的配置。",
  credentialStoreUnavailable: "Windows 凭据存储暂时不可用，无法读取或保存地点服务密钥。",
  locationProvidersUnavailable: "地点搜索服务暂时不可用，请重试，或使用地图/经纬度选点。",
  mapUnavailable: "地图暂时不可用；仍可使用经纬度输入选择地点。",
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
