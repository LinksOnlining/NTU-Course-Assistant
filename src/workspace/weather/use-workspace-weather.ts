import { useCallback, useEffect, useRef, useState } from "react";
import {
  classifyWeatherCache,
  createWorkspaceWeatherProvider,
  weatherLocationKey,
} from "../../application/weather/weather.ts";
import {
  DEFAULT_WEATHER_SETTINGS,
  loadWeatherCache,
  loadWeatherSettings,
  removeWeatherCache,
  saveWeatherCache,
  saveWeatherSettings,
} from "../../application/weather/weather-storage.ts";
import { normalizeWeatherCoordinate } from "../../core/weather-coordinate.ts";
import type {
  TemperatureUnit,
  WeatherLocation,
  WeatherSearchState,
  WeatherSettings,
  WeatherSnapshot,
  WeatherViewState,
  WeatherLocationRequestState,
  WeatherErrorCategory,
  WeatherCoordinateSystem,
  WorkspaceWeatherProvider,
} from "../../types/weather.ts";
import { weatherErrorCategory, weatherErrorMessage } from "./weather-errors.ts";

export interface WorkspaceWeatherController {
  readonly settings: WeatherSettings;
  readonly viewState: WeatherViewState;
  readonly searchState: WeatherSearchState;
  readonly locationRequestState: WeatherLocationRequestState;
  readonly isRefreshing: boolean;
  readonly storageWarning: string;
  readonly searchLocation: (query: string, adminHint?: string) => Promise<void>;
  readonly selectLocation: (location: WeatherLocation) => void;
  readonly selectCoordinates: (
    latitude: number,
    longitude: number,
    coordinateSystem: WeatherCoordinateSystem,
    source: "manual" | "map",
  ) => Promise<void>;
  readonly useCurrentLocation: () => Promise<void>;
  readonly setEnabled: (enabled: boolean) => void;
  readonly setTemperatureUnit: (unit: TemperatureUnit) => void;
  readonly refresh: () => Promise<void>;
}

const DEFAULT_PROVIDER = createWorkspaceWeatherProvider();

function readCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("location-unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 12_000,
    });
  });
}

function roundedWeatherCoordinate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function geolocationErrorCategory(error: unknown): WeatherErrorCategory {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : null;
  if (code === 1) return "permissionDenied";
  if (code === 3) return "locationTimeout";
  return "locationUnavailable";
}

function viewForCache(
  cache: WeatherSnapshot | null,
  location: WeatherLocation,
  now = Date.now(),
): WeatherViewState {
  const freshness = classifyWeatherCache(cache, location, now);
  if (cache && freshness === "fresh") return { kind: "ready", snapshot: cache };
  if (cache && freshness === "stale") {
    return { kind: "stale", snapshot: cache, refreshing: false };
  }
  return { kind: "loading" };
}

function initialViewState(settings: WeatherSettings): WeatherViewState {
  if (!settings.enabled) return { kind: "disabled" };
  if (!settings.location) return { kind: "needsLocation" };
  return viewForCache(loadWeatherCache(), settings.location);
}

export function useWorkspaceWeather(
  provider: WorkspaceWeatherProvider = DEFAULT_PROVIDER,
): WorkspaceWeatherController {
  const [settings, setSettings] = useState(loadWeatherSettings);
  const [viewState, setViewState] = useState<WeatherViewState>(() =>
    initialViewState(loadWeatherSettings()),
  );
  const [searchState, setSearchState] = useState<WeatherSearchState>({ kind: "idle" });
  const [locationRequestState, setLocationRequestState] = useState<WeatherLocationRequestState>({
    kind: "idle",
  });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const refreshController = useRef<AbortController | null>(null);
  const searchController = useRef<AbortController | null>(null);
  const refreshGeneration = useRef(0);
  const locationGeneration = useRef(0);
  const pendingCurrentLocationKey = useRef<string | null>(null);
  const pendingCurrentLocationNotice = useRef("");
  const location = settings.location;
  const locationKey = location
    ? `${weatherLocationKey(location)}|${location.displayName}|${location.timezone ?? ""}`
    : "";

  const persistSettings = useCallback((next: WeatherSettings) => {
    setSettings(next);
    setStorageWarning(saveWeatherSettings(next) ? "" : "天气偏好无法保存到此设备的本地存储。");
  }, []);

  const refreshLocation = useCallback(
    async (target: WeatherLocation, force = false): Promise<void> => {
      const cache = loadWeatherCache();
      const freshness = classifyWeatherCache(cache, target);
      if (freshness === "fresh" && !force) {
        setViewState({ kind: "ready", snapshot: cache! });
        if (pendingCurrentLocationKey.current === weatherLocationKey(target)) {
          pendingCurrentLocationKey.current = null;
          setLocationRequestState({
            kind: "notice",
            message: `${pendingCurrentLocationNotice.current} 天气已就绪。`,
          });
        }
        return;
      }
      const usableCache = freshness === "fresh" || freshness === "stale" ? cache : null;
      setViewState(
        usableCache
          ? { kind: "stale", snapshot: usableCache, refreshing: true }
          : { kind: "loading" },
      );
      setIsRefreshing(true);
      refreshController.current?.abort();
      const controller = new AbortController();
      refreshController.current = controller;
      const generation = ++refreshGeneration.current;
      let forecastSucceeded = false;
      try {
        const snapshot = await provider.fetchForecast(target, controller.signal);
        if (controller.signal.aborted || generation !== refreshGeneration.current) return;
        saveWeatherCache(snapshot);
        setViewState({ kind: "ready", snapshot });
        forecastSucceeded = true;
      } catch (error) {
        if (controller.signal.aborted || generation !== refreshGeneration.current) return;
        const category = weatherErrorCategory(error, "forecastUnavailable");
        const message = weatherErrorMessage(category);
        setViewState(
          usableCache
            ? { kind: "stale", snapshot: usableCache, refreshing: false, error: message }
            : { kind: "unavailable", error: message },
        );
      } finally {
        if (generation === refreshGeneration.current) {
          refreshController.current = null;
          setIsRefreshing(false);
          if (pendingCurrentLocationKey.current === weatherLocationKey(target)) {
            pendingCurrentLocationKey.current = null;
            setLocationRequestState({
              kind: "notice",
              message: forecastSucceeded
                ? `${pendingCurrentLocationNotice.current} 天气已更新。`
                : `${pendingCurrentLocationNotice.current} 天气数据暂时不可用，但当前位置仍可继续使用。`,
            });
          }
        }
      }
    },
    [provider],
  );

  useEffect(() => {
    if (!settings.enabled) {
      refreshController.current?.abort();
      setIsRefreshing(false);
      setViewState({ kind: "disabled" });
      return;
    }
    if (!location) {
      refreshController.current?.abort();
      setIsRefreshing(false);
      setViewState({ kind: "needsLocation" });
      return;
    }
    const cache = loadWeatherCache();
    if (cache && classifyWeatherCache(cache, location) === "missing") removeWeatherCache();
    setViewState(viewForCache(cache, location));
    if (classifyWeatherCache(cache, location) !== "fresh") void refreshLocation(location);
    return () => {
      refreshController.current?.abort();
    };
  }, [settings.enabled, locationKey, refreshLocation]);

  const searchLocation = useCallback(
    async (query: string, adminHint?: string) => {
      if (!settings.enabled || !query.trim()) return;
      searchController.current?.abort();
      const controller = new AbortController();
      searchController.current = controller;
      setSearchState({ kind: "searching" });
      try {
        const locations = await provider.searchLocation(
          query.trim(),
          controller.signal,
          adminHint?.trim() || undefined,
        );
        if (!controller.signal.aborted) setSearchState({ kind: "results", locations });
      } catch (error) {
        if (!controller.signal.aborted) {
          const category = weatherErrorCategory(error, "geocodingUnavailable");
          setSearchState({ kind: "error", category, message: weatherErrorMessage(category) });
        }
      } finally {
        if (searchController.current === controller) searchController.current = null;
      }
    },
    [provider, settings.enabled],
  );

  const selectLocation = useCallback(
    (nextLocation: WeatherLocation) => {
      pendingCurrentLocationKey.current = null;
      pendingCurrentLocationNotice.current = "";
      locationGeneration.current += 1;
      refreshController.current?.abort();
      refreshGeneration.current += 1;
      removeWeatherCache();
      persistSettings({
        ...settings,
        location: { ...nextLocation, source: nextLocation.source ?? "manual" },
      });
      setSearchState({ kind: "idle" });
      setLocationRequestState({ kind: "idle" });
      setIsRefreshing(false);
      setViewState({ kind: "loading" });
    },
    [persistSettings, settings],
  );

  const selectCoordinates = useCallback(
    async (
      latitude: number,
      longitude: number,
      coordinateSystem: WeatherCoordinateSystem,
      source: "manual" | "map",
    ) => {
      if (
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90 ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
      ) {
        setLocationRequestState({
          kind: "error",
          category: "invalidProviderRequest",
          message: "经纬度超出有效范围。",
        });
        return;
      }
      const coordinates = normalizeWeatherCoordinate(latitude, longitude, coordinateSystem);
      const fallbackName = source === "map" ? "地图选定位置" : "手动坐标";
      const selected: WeatherLocation = {
        displayName: fallbackName,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        coordinateSystem: coordinates.coordinateSystem,
        timezone: null,
        precision: "coordinatesOnly",
        source,
        provider: source,
      };
      selectLocation(selected);
      setLocationRequestState({
        kind: "notice",
        message: `${fallbackName}已保存；正在按坐标更新天气。`,
      });
    },
    [provider, selectLocation],
  );

  const useCurrentLocation = useCallback(async () => {
    if (!settings.enabled) return;
    const generation = ++locationGeneration.current;
    setLocationRequestState({ kind: "locating" });
    try {
      const position = await readCurrentPosition();
      if (generation !== locationGeneration.current) return;
      const { latitude: rawLatitude, longitude: rawLongitude, accuracy } = position.coords;
      if (
        !Number.isFinite(rawLatitude) ||
        rawLatitude < -90 ||
        rawLatitude > 90 ||
        !Number.isFinite(rawLongitude) ||
        rawLongitude < -180 ||
        rawLongitude > 180
      ) {
        setLocationRequestState({
          kind: "error",
          category: "locationUnavailable",
          message: "无法确认当前位置坐标。你仍可手动搜索地点。",
        });
        return;
      }
      if (!Number.isFinite(accuracy) || accuracy > 10_000) {
        setLocationRequestState({
          kind: "error",
          category: "lowAccuracy",
          message: "当前位置精度较低，暂未用于天气。请重试定位，或手动搜索区县。",
        });
        return;
      }
      const privacyLatitude = roundedWeatherCoordinate(rawLatitude);
      const privacyLongitude = roundedWeatherCoordinate(rawLongitude);
      const coordinates = normalizeWeatherCoordinate(privacyLatitude, privacyLongitude, "wgs84");
      setLocationRequestState({ kind: "resolving" });
      let resolved: WeatherLocation | null = null;
      try {
        resolved = await provider.reverseGeocode(coordinates.latitude, coordinates.longitude);
      } catch {
        // Forecast may still use the selected coordinates without inventing a place name.
      }
      if (generation !== locationGeneration.current) return;
      const selected: WeatherLocation = {
        ...(resolved ?? {
          displayName: "当前位置",
          timezone: null,
          precision: "coordinatesOnly" as const,
        }),
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        coordinateSystem: coordinates.coordinateSystem,
        source: "device",
      };
      selectLocation(selected);
      pendingCurrentLocationKey.current = weatherLocationKey(selected);
      pendingCurrentLocationNotice.current =
        selected.precision === "coordinatesOnly"
          ? "已切换到当前位置；地点名称暂时无法解析。"
          : accuracy > 2_000
            ? `已使用当前位置（系统估算误差约 ${Math.round(accuracy / 1000)} 公里）。`
            : "已使用当前位置；仅保存当前天气地点，不记录位置历史。";
      setLocationRequestState({ kind: "fetching" });
    } catch (error) {
      if (generation === locationGeneration.current) {
        const category = geolocationErrorCategory(error);
        setLocationRequestState({
          kind: "error",
          category,
          message: weatherErrorMessage(category),
        });
      }
    }
  }, [provider, selectLocation, settings.enabled]);

  const setEnabled = useCallback(
    (enabled: boolean) => {
      if (!enabled) {
        locationGeneration.current += 1;
        refreshController.current?.abort();
        refreshGeneration.current += 1;
        searchController.current?.abort();
        setIsRefreshing(false);
        setSearchState({ kind: "idle" });
        setLocationRequestState({ kind: "idle" });
        setViewState({ kind: "disabled" });
      }
      persistSettings({ ...settings, enabled });
    },
    [persistSettings, settings],
  );

  const setTemperatureUnit = useCallback(
    (temperatureUnit: TemperatureUnit) => {
      persistSettings({ ...settings, temperatureUnit });
    },
    [persistSettings, settings],
  );

  const refresh = useCallback(async () => {
    if (settings.enabled && settings.location) await refreshLocation(settings.location, true);
  }, [refreshLocation, settings]);

  return {
    settings: settings ?? DEFAULT_WEATHER_SETTINGS,
    viewState,
    searchState,
    locationRequestState,
    isRefreshing,
    storageWarning,
    searchLocation,
    selectLocation,
    selectCoordinates,
    useCurrentLocation,
    setEnabled,
    setTemperatureUnit,
    refresh,
  };
}
