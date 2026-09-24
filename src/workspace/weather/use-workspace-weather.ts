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
import type {
  TemperatureUnit,
  WeatherLocation,
  WeatherSearchState,
  WeatherSettings,
  WeatherSnapshot,
  WeatherViewState,
  WeatherLocationRequestState,
  WorkspaceWeatherProvider,
} from "../../types/weather.ts";

export interface WorkspaceWeatherController {
  readonly settings: WeatherSettings;
  readonly viewState: WeatherViewState;
  readonly searchState: WeatherSearchState;
  readonly locationRequestState: WeatherLocationRequestState;
  readonly isRefreshing: boolean;
  readonly storageWarning: string;
  readonly searchLocation: (query: string) => Promise<void>;
  readonly selectLocation: (location: WeatherLocation) => void;
  readonly useCurrentLocation: () => Promise<void>;
  readonly setEnabled: (enabled: boolean) => void;
  readonly setTemperatureUnit: (unit: TemperatureUnit) => void;
  readonly refresh: () => Promise<void>;
}

const DEFAULT_PROVIDER = createWorkspaceWeatherProvider();
const SERVICE_ERROR = "天气服务暂时无法访问。请检查网络后重试。";
const LOCATION_ERROR = "无法获取当前位置。请检查定位权限，或手动搜索地点。";

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

function geolocationErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : null;
  if (code === 1) return "定位权限未获准。你仍可手动搜索地点。";
  if (code === 3) return "定位超时。请重试，或手动搜索地点。";
  return LOCATION_ERROR;
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
      try {
        const snapshot = await provider.fetchForecast(target, controller.signal);
        if (controller.signal.aborted || generation !== refreshGeneration.current) return;
        saveWeatherCache(snapshot);
        setViewState({ kind: "ready", snapshot });
      } catch {
        if (controller.signal.aborted || generation !== refreshGeneration.current) return;
        setViewState(
          usableCache
            ? { kind: "stale", snapshot: usableCache, refreshing: false, error: SERVICE_ERROR }
            : { kind: "unavailable", error: SERVICE_ERROR },
        );
      } finally {
        if (generation === refreshGeneration.current) {
          refreshController.current = null;
          setIsRefreshing(false);
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
    async (query: string) => {
      if (!settings.enabled || !query.trim()) return;
      searchController.current?.abort();
      const controller = new AbortController();
      searchController.current = controller;
      setSearchState({ kind: "searching" });
      try {
        const locations = await provider.searchLocation(query.trim(), controller.signal);
        if (!controller.signal.aborted) setSearchState({ kind: "results", locations });
      } catch {
        if (!controller.signal.aborted) {
          setSearchState({ kind: "error", message: SERVICE_ERROR });
        }
      } finally {
        if (searchController.current === controller) searchController.current = null;
      }
    },
    [provider, settings.enabled],
  );

  const selectLocation = useCallback(
    (nextLocation: WeatherLocation) => {
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
          message: "无法确认当前位置坐标。你仍可手动搜索地点。",
        });
        return;
      }
      if (!Number.isFinite(accuracy) || accuracy > 10_000) {
        setLocationRequestState({
          kind: "error",
          message: "当前位置精度较低，暂未用于天气。请重试定位，或手动搜索区县。",
        });
        return;
      }
      const latitude = roundedWeatherCoordinate(rawLatitude);
      const longitude = roundedWeatherCoordinate(rawLongitude);
      setLocationRequestState({ kind: "resolving" });
      let resolved: WeatherLocation | null = null;
      try {
        resolved = await provider.reverseGeocode(latitude, longitude);
      } catch {
        // Forecast may still use the selected coordinates without inventing a place name.
      }
      if (generation !== locationGeneration.current) return;
      const selected: WeatherLocation = {
        ...(resolved ?? {
          displayName: "地点暂不可解析",
          timezone: null,
          precision: "coordinatesOnly" as const,
        }),
        latitude,
        longitude,
        source: "device",
      };
      selectLocation(selected);
      setLocationRequestState({
        kind: "notice",
        message:
          selected.precision === "coordinatesOnly"
            ? "天气已切换到当前位置坐标，但地点名称暂不可解析；你也可以手动搜索区县。"
            : accuracy > 2_000
              ? `已使用当前位置获取天气（系统估算误差约 ${Math.round(accuracy / 1000)} 公里）。`
              : "已使用当前位置获取天气；仅保存当前天气地点，不记录位置历史。",
      });
    } catch (error) {
      if (generation === locationGeneration.current) {
        setLocationRequestState({ kind: "error", message: geolocationErrorMessage(error) });
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
    useCurrentLocation,
    setEnabled,
    setTemperatureUnit,
    refresh,
  };
}
