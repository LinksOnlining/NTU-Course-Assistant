import type { WeatherLocation, WeatherRequestSignal } from "../types/weather.ts";
import { nativeGeocodingFetch, type GeocodingFetch } from "./native-geocoding-transport.ts";

type JsonRecord = Record<string, unknown>;

const PHOTON_LAYERS = new Set([
  "house",
  "street",
  "locality",
  "district",
  "city",
  "county",
  "state",
  "country",
  "other",
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function coordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function precision(properties: JsonRecord): WeatherLocation["precision"] {
  const type = text(properties.type)?.toLowerCase();
  if (type && PHOTON_LAYERS.has(type)) return type as WeatherLocation["precision"];

  const key = text(properties.osm_key)?.toLowerCase();
  const value = text(properties.osm_value)?.toLowerCase();
  if (key === "highway") return "street";
  if (key === "place") {
    if (value === "house") return "house";
    if (value === "street") return "street";
    if (
      ["neighbourhood", "suburb", "quarter", "hamlet", "village", "locality"].includes(value ?? "")
    ) {
      return "locality";
    }
    if (["city_district", "borough", "district"].includes(value ?? "")) return "district";
    if (["city", "town", "municipality"].includes(value ?? "")) return "city";
    if (value === "county") return "county";
    if (["state", "province", "region"].includes(value ?? "")) return "state";
    if (value === "country") return "country";
  }
  if (properties.housenumber !== undefined) return "house";
  if (text(properties.name)) return "other";
  return "unknown";
}

function normalizeFeature(value: unknown): WeatherLocation | null {
  if (!isRecord(value) || !isRecord(value.properties) || !isRecord(value.geometry)) return null;
  const properties = value.properties;
  const coordinates = value.geometry.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const longitude = coordinate(coordinates[0]);
  const latitude = coordinate(coordinates[1]);
  if (
    longitude === null ||
    longitude < -180 ||
    longitude > 180 ||
    latitude === null ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null;
  }

  const street = text(properties.street);
  const locality = text(properties.locality);
  const district = text(properties.district) ?? text(properties.city_district);
  const city = text(properties.city);
  const county = text(properties.county);
  const state = text(properties.state);
  const country = text(properties.country);
  const locationPrecision = precision(properties);
  const name = text(properties.name);
  const houseNumber = text(properties.housenumber);
  const displayName =
    (locationPrecision === "house" &&
    name &&
    houseNumber &&
    name.replace(/\s|号$/gu, "") === houseNumber.replace(/\s|号$/gu, "")
      ? undefined
      : name) ??
    street ??
    locality ??
    district ??
    city ??
    county ??
    state ??
    country;
  if (!displayName) return null;

  const osmType = text(properties.osm_type);
  const osmId =
    typeof properties.osm_id === "string" || typeof properties.osm_id === "number"
      ? String(properties.osm_id)
      : undefined;

  return {
    displayName,
    latitude,
    longitude,
    timezone: null,
    country,
    admin1: state,
    admin2: city ?? county,
    admin3: district,
    admin4: locality,
    county,
    street,
    providerId: osmType && osmId ? `${osmType}:${osmId}` : undefined,
    precision: locationPrecision,
    source: "manual",
  };
}

function parseResults(value: unknown): readonly WeatherLocation[] {
  if (!isRecord(value) || !Array.isArray(value.features)) {
    throw new Error("invalid-location-response");
  }
  if (value.features.length === 0) return [];
  const locations = value.features.flatMap((feature) => {
    const location = normalizeFeature(feature);
    return location ? [location] : [];
  });
  if (locations.length === 0) throw new Error("invalid-location-response");
  return locations;
}

function locationIdentity(location: WeatherLocation): string {
  return location.providerId
    ? `osm:${location.providerId}`
    : `coordinates:${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}`;
}

function rankResults(
  locations: readonly WeatherLocation[],
  query: string,
): readonly WeatherLocation[] {
  const normalize = (value: string) =>
    value.replace(/[\s·,，.。/\\-]/gu, "").toLocaleLowerCase("zh-CN");
  const exactQuery = normalize(query);
  const priority = (location: WeatherLocation): number => {
    if (normalize(location.displayName) === exactQuery) return 0;
    if (["locality", "district", "street"].includes(location.precision ?? "")) return 1;
    if (location.precision === "city") return 2;
    return 3;
  };
  const seen = new Set<string>();
  return locations
    .map((location, index) => ({ location, index, priority: priority(location) }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .flatMap(({ location }) => {
      const identity = locationIdentity(location);
      if (seen.has(identity)) return [];
      seen.add(identity);
      return [location];
    });
}

async function fetchJson(
  fetcher: GeocodingFetch,
  url: URL,
  signal?: WeatherRequestSignal,
): Promise<unknown> {
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
  if (!response.ok) throw new Error("geocodingUnavailable");
  return response.json() as Promise<unknown>;
}

export function createPhotonLocationSearchProvider(fetcher: GeocodingFetch = nativeGeocodingFetch) {
  return {
    async searchLocation(
      query: string,
      signal?: WeatherRequestSignal,
    ): Promise<readonly WeatherLocation[]> {
      const term = query.trim();
      if (!term) return [];
      const search = async (value: string) => {
        const url = new URL("https://photon.komoot.io/api");
        url.searchParams.set("q", value);
        url.searchParams.set("lang", "default");
        url.searchParams.set("limit", "12");
        return rankResults(parseResults(await fetchJson(fetcher, url, signal)), term);
      };

      return search(term);
    },
  };
}
