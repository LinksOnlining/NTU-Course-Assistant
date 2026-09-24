import { useCallback, useEffect, useRef, useState } from "react";
import { classifyWeatherCache, weatherLocationKey } from "../../application/weather/weather.ts";
import { createOpenMeteoProvider } from "../../services/weather-provider.ts";
import {
  DEFAULT_WEATHER_SETTINGS,
  loadWeatherCache,
  loadWeatherSettings,
  removeWeatherCache,
  saveWeatherCache,
  saveWeatherSettings,
} from "../../services/weather-storage.ts";
import type {
  TemperatureUnit,
  WeatherLocation,
  WeatherSearchState,
  WeatherSettings,
  WeatherSnapshot,
  WeatherViewState,
  WeatherProvider,
} from "../../types/weather.ts";

export interface WorkspaceWeatherController {
  readonly settings: WeatherSettings;
  readonly viewState: WeatherViewState;
  readonly searchState: WeatherSearchState;
  readonly isRefreshing: boolean;
  readonly storageWarning: string;
  readonly searchLocation: (query: string) => Promise<void>;
  readonly selectLocation: (location: WeatherLocation) => void;
  readonly setEnabled: (enabled: boolean) => void;
  readonly setTemperatureUnit: (unit: TemperatureUnit) => void;
  readonly refresh: () => Promise<void>;
}

const DEFAULT_PROVIDER = createOpenMeteoProvider();
const SERVICE_ERROR = "天气服务暂时无法访问。请检查网络后重试。";

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
  provider: WeatherProvider = DEFAULT_PROVIDER,
): WorkspaceWeatherController {
  const [settings, setSettings] = useState(loadWeatherSettings);
  const [viewState, setViewState] = useState<WeatherViewState>(() =>
    initialViewState(loadWeatherSettings()),
  );
  const [searchState, setSearchState] = useState<WeatherSearchState>({ kind: "idle" });
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [storageWarning, setStorageWarning] = useState("");
  const refreshController = useRef<AbortController | null>(null);
  const searchController = useRef<AbortController | null>(null);
  const refreshGeneration = useRef(0);
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
      refreshController.current?.abort();
      refreshGeneration.current += 1;
      removeWeatherCache();
      persistSettings({ ...settings, location: nextLocation });
      setSearchState({ kind: "idle" });
      setIsRefreshing(false);
      setViewState({ kind: "loading" });
    },
    [persistSettings, settings],
  );

  const setEnabled = useCallback(
    (enabled: boolean) => {
      if (!enabled) {
        refreshController.current?.abort();
        refreshGeneration.current += 1;
        searchController.current?.abort();
        setIsRefreshing(false);
        setSearchState({ kind: "idle" });
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
    isRefreshing,
    storageWarning,
    searchLocation,
    selectLocation,
    setEnabled,
    setTemperatureUnit,
    refresh,
  };
}
