import { invoke as tauriInvoke } from "@tauri-apps/api/core";

type NativeCommand = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
export type GeocodingFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const PHOTON_ORIGIN = "https://photon.komoot.io";
const ERROR_CODES = new Set([
  "invalidProviderRequest",
  "geocodingUnavailable",
  "reverseGeocodingUnavailable",
]);

function requestError(error: unknown, reverse: boolean): Error {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  if (ERROR_CODES.has(message)) return new Error(message);
  return new Error(reverse ? "reverseGeocodingUnavailable" : "geocodingUnavailable");
}

export function createNativeGeocodingFetch(invoke: NativeCommand = tauriInvoke): GeocodingFetch {
  return async (input, init) => {
    const source =
      typeof Request !== "undefined" && input instanceof Request ? input.url : String(input);
    const url = new URL(source);
    if (url.protocol !== "https:" || url.origin !== PHOTON_ORIGIN) {
      throw new Error("invalidProviderRequest");
    }
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const isReverse = url.pathname === "/reverse";
    try {
      let payload: unknown;
      if (url.pathname === "/api" && url.searchParams.has("q")) {
        payload = await invoke("search_weather_location", {
          query: url.searchParams.get("q"),
        });
      } else if (isReverse && url.searchParams.has("lat") && url.searchParams.has("lon")) {
        payload = await invoke("reverse_geocode_weather_location", {
          latitude: Number(url.searchParams.get("lat")),
          longitude: Number(url.searchParams.get("lon")),
        });
      } else {
        throw new Error("invalidProviderRequest");
      }
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw requestError(error, isReverse);
    }
  };
}

export const nativeGeocodingFetch = createNativeGeocodingFetch();
