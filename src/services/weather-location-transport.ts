import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  LocationSearchProvider,
  ReverseGeocodingProvider,
  WeatherLocation,
  WeatherRequestSignal,
} from "../types/weather.ts";
import { normalizeWeatherLocation } from "./weather-storage.ts";

type NativeCommand = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

const PROVIDER_ERRORS = new Set([
  "invalidProviderRequest",
  "locationProvidersNotConfigured",
  "locationProviderRateLimited",
  "weatherCredentialUnavailable",
  "credentialStoreUnavailable",
  "locationProvidersUnavailable",
  "cancelled",
  "reverseGeocodingUnavailable",
  "mapUnavailable",
]);

function nativeError(error: unknown, reverse = false): Error {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  if (PROVIDER_ERRORS.has(message)) return new Error(message);
  return new Error(reverse ? "reverseGeocodingUnavailable" : "locationProvidersUnavailable");
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

export function createNativeWeatherLocationProvider(
  invoke: NativeCommand = tauriInvoke,
): LocationSearchProvider & ReverseGeocodingProvider {
  return {
    async searchLocation(query, signal, adminHint) {
      if (signal?.aborted) throw abortError();
      const requestId =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `weather-search-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const abortSignal = signal instanceof AbortSignal ? signal : null;
      const cancel = () => {
        void invoke("cancel_weather_location_search", { requestId }).catch(() => undefined);
      };
      abortSignal?.addEventListener("abort", cancel, { once: true });
      try {
        const result = await invoke<unknown>("search_weather_location", {
          query,
          adminHint: adminHint?.trim() || null,
          requestId,
        });
        if (signal?.aborted) throw abortError();
        if (!Array.isArray(result)) throw new Error("locationProvidersUnavailable");
        return result
          .map(normalizeWeatherLocation)
          .filter((location): location is WeatherLocation => location !== null);
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          throw abortError();
        }
        throw nativeError(error);
      } finally {
        abortSignal?.removeEventListener("abort", cancel);
      }
    },
    async reverseGeocode(latitude, longitude, signal) {
      if (signal?.aborted) throw abortError();
      try {
        const result = await invoke<unknown>("reverse_geocode_weather_location", {
          latitude,
          longitude,
        });
        if (signal?.aborted || result === null) return null;
        return normalizeWeatherLocation(result);
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          throw abortError();
        }
        throw nativeError(error, true);
      }
    },
  };
}

export interface WeatherProviderCredentialStatus {
  readonly amapConfigured: boolean;
  readonly baiduConfigured: boolean;
}

export function getWeatherProviderCredentialStatus(
  invoke: NativeCommand = tauriInvoke,
): Promise<WeatherProviderCredentialStatus> {
  return invoke<WeatherProviderCredentialStatus>("get_weather_credential_status");
}

export function saveWeatherProviderKey(
  provider: "amap" | "baidu",
  key: string,
  invoke: NativeCommand = tauriInvoke,
): Promise<boolean> {
  return invoke<boolean>("set_weather_provider_key", { provider, key });
}

export function removeWeatherProviderKey(
  provider: "amap" | "baidu",
  invoke: NativeCommand = tauriInvoke,
): Promise<boolean> {
  return invoke<boolean>("delete_weather_provider_key", { provider });
}

export async function getWeatherMapImage(
  latitude: number,
  longitude: number,
  zoom: number,
  invoke: NativeCommand = tauriInvoke,
): Promise<Blob> {
  const image = await invoke<{ mimeType: string; bytes: number[] }>("get_weather_map_image", {
    latitude,
    longitude,
    zoom,
  });
  if (
    !image ||
    !Array.isArray(image.bytes) ||
    (image.mimeType !== "image/png" && image.mimeType !== "image/jpeg")
  ) {
    throw new Error("mapUnavailable");
  }
  return new Blob([new Uint8Array(image.bytes)], { type: image.mimeType });
}

export function isWeatherRequestSignal(
  signal: WeatherRequestSignal | undefined,
): signal is AbortSignal {
  return typeof AbortSignal !== "undefined" && signal instanceof AbortSignal;
}
