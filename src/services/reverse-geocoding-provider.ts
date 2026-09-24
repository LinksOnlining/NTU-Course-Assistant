import type { ReverseGeocodingProvider, WeatherLocation } from "../types/weather.ts";
import { nativeGeocodingFetch, type GeocodingFetch } from "./native-geocoding-transport.ts";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function reverseLocation(
  value: unknown,
  latitude: number,
  longitude: number,
): WeatherLocation | null {
  if (!isRecord(value) || !Array.isArray(value.features)) return null;
  const feature = value.features.find(
    (item): item is JsonRecord => isRecord(item) && isRecord(item.properties),
  );
  if (!feature || !isRecord(feature.properties)) return null;
  const properties = feature.properties;
  const locality = text(properties.locality);
  const district = text(properties.district) ?? text(properties.county);
  const city = text(properties.city);
  const region = text(properties.state);
  const country = text(properties.country);
  const displayName = locality ?? district ?? city ?? region ?? "地点暂不可解析";
  const precision: WeatherLocation["precision"] = locality
    ? "locality"
    : district
      ? "district"
      : city
        ? "city"
        : region
          ? "region"
          : "coordinatesOnly";

  return {
    displayName,
    latitude,
    longitude,
    timezone: null,
    country,
    admin1: region,
    admin2: city,
    admin3: district,
    admin4: locality,
    precision,
    source: "device",
  };
}

export function createPhotonReverseGeocodingProvider(
  fetcher: GeocodingFetch = nativeGeocodingFetch,
): ReverseGeocodingProvider {
  return {
    async reverseGeocode(latitude, longitude, signal) {
      const url = new URL("https://photon.komoot.io/reverse");
      url.searchParams.set("lat", String(latitude));
      url.searchParams.set("lon", String(longitude));
      url.searchParams.set("lang", "default");
      const timeout = AbortSignal.timeout(10_000);
      const abortSignal = signal instanceof AbortSignal ? signal : undefined;
      const response = await fetcher(url, {
        signal: abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout,
        headers: { Accept: "application/json" },
      });
      if (
        response.status === 400 ||
        (response.status >= 400 && response.status < 500 && response.status !== 429)
      ) {
        throw new Error("invalidProviderRequest");
      }
      if (!response.ok) throw new Error("reverseGeocodingUnavailable");
      return reverseLocation(await response.json(), latitude, longitude);
    },
  };
}
