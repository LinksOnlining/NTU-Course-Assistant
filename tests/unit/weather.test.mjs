import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyWeatherCache,
  formatTemperature,
  createWorkspaceWeatherProvider,
  weatherLocationHierarchy,
  weatherLocationIdentity,
  weatherCodeLabel,
  weatherLocationKey,
} from "../../src/application/weather/weather.ts";
import {
  DEFAULT_WEATHER_SETTINGS,
  WEATHER_CACHE_KEY,
  WEATHER_SETTINGS_KEY,
  loadWeatherCache,
  loadWeatherSettings,
  normalizeWeatherLocation,
  saveWeatherCache,
  saveWeatherSettings,
} from "../../src/services/weather-storage.ts";
import {
  createNativeWeatherLocationProvider,
  getWeatherMapImage,
  getWeatherProviderCredentialStatus,
  removeWeatherProviderKey,
  saveWeatherProviderKey,
} from "../../src/services/weather-location-transport.ts";
import { createOpenMeteoProvider } from "../../src/services/weather-provider.ts";
import {
  gcj02PixelForCoordinate,
  gcj02ToWgs84,
  mapPixelToGcj02,
  normalizeWeatherCoordinate,
  openMeteoCoordinates,
  panGcj02Map,
  wgs84ToGcj02,
} from "../../src/core/weather-coordinate.ts";

const location = {
  displayName: "南通",
  displayAddress: "江苏省 · 南通市",
  latitude: 31.98,
  longitude: 120.89,
  coordinateSystem: "wgs84",
  timezone: "Asia/Shanghai",
  source: "manual",
};

function snapshot(fetchedAt = "2026-09-24T00:00:00.000Z", target = location) {
  return {
    location: target,
    fetchedAt,
    timezone: target.timezone,
    current: {
      time: "2026-09-24T08:00",
      temperatureCelsius: 22,
      apparentTemperatureCelsius: 21,
      weatherCode: 2,
      isDay: true,
      humidityPercent: 65,
    },
    hourly: [
      {
        time: "2026-09-24T09:00",
        temperatureCelsius: 23,
        precipitationProbability: null,
        weatherCode: 1,
      },
    ],
    daily: Array.from({ length: 7 }, (_, index) => ({
      date: "2026-09-" + String(24 + index).padStart(2, "0"),
      highCelsius: 25,
      lowCelsius: 18,
      precipitationProbability: null,
      weatherCode: 2,
    })),
  };
}

function memoryStorage({ failWrites = false } = {}) {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrites) throw new Error("storage unavailable");
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
    values,
  };
}

function nativeLocation(overrides = {}) {
  return {
    displayName: "王村",
    displayAddress: "江苏省 · 徐州市 · 丰县 · 邢楼镇",
    latitude: 34.7,
    longitude: 116.2,
    coordinateSystem: "gcj02",
    timezone: null,
    country: "中国",
    admin1: "江苏省",
    admin2: "徐州市",
    admin3: "丰县",
    admin4: "邢楼镇",
    provider: "amap",
    providerId: "A-1",
    type: "村庄",
    precision: "locality",
    source: "manual",
    ...overrides,
  };
}

test("weather is opt-in and settings/cache use namespaced local keys", () => {
  const storage = memoryStorage();
  assert.deepEqual(loadWeatherSettings(storage), DEFAULT_WEATHER_SETTINGS);
  assert.equal(WEATHER_SETTINGS_KEY, "links-workplace.weather.settings");
  assert.equal(WEATHER_CACHE_KEY, "links-workplace.weather.cache");
  assert.equal(
    saveWeatherSettings({ enabled: true, location, temperatureUnit: "fahrenheit" }, storage),
    true,
  );
  assert.deepEqual(loadWeatherSettings(storage), {
    enabled: true,
    location,
    temperatureUnit: "fahrenheit",
  });
  storage.setItem(
    WEATHER_SETTINGS_KEY,
    JSON.stringify({ enabled: true, location, temperatureUnit: "kelvin" }),
  );
  assert.equal(loadWeatherSettings(storage).temperatureUnit, "celsius");
  assert.equal(loadWeatherSettings(storage).enabled, true);
});

test("legacy selected locations migrate to explicit WGS-84 metadata without losing settings", () => {
  const storage = memoryStorage();
  const legacy = { displayName: "旧版本位置", latitude: 31, longitude: 120, timezone: null };
  storage.setItem(
    WEATHER_SETTINGS_KEY,
    JSON.stringify({ enabled: true, location: legacy, temperatureUnit: "celsius" }),
  );
  const loaded = loadWeatherSettings(storage);
  assert.equal(loaded.enabled, true);
  assert.equal(loaded.location.coordinateSystem, "wgs84");
  assert.equal(loaded.location.source, "manual");
  assert.deepEqual(JSON.parse(storage.getItem(WEATHER_SETTINGS_KEY)).location, loaded.location);
});

test("legacy location remains usable if local storage rejects migration writes", () => {
  const storage = memoryStorage();
  storage.values.set(
    WEATHER_SETTINGS_KEY,
    JSON.stringify({
      enabled: true,
      location: { displayName: "旧位置", latitude: 31, longitude: 120, timezone: null },
      temperatureUnit: "celsius",
    }),
  );
  const failingStorage = {
    ...storage,
    setItem() {
      throw new Error("quota exceeded");
    },
  };
  const loaded = loadWeatherSettings(failingStorage);
  assert.equal(loaded.enabled, true);
  assert.equal(loaded.location.displayName, "旧位置");
});

test("invalid stored coordinates are rejected; valid coordinate-only map locations persist", () => {
  assert.equal(normalizeWeatherLocation({ ...location, latitude: Number.NaN }), null);
  const storage = memoryStorage();
  const selected = nativeLocation({
    displayName: "地图选定位置",
    latitude: 31.2,
    longitude: 121.4,
    coordinateSystem: "gcj02",
    source: "map",
    precision: "coordinatesOnly",
  });
  assert.equal(
    saveWeatherSettings({ enabled: true, location: selected, temperatureUnit: "celsius" }, storage),
    true,
  );
  assert.equal(loadWeatherSettings(storage).location.source, "map");
  assert.equal(loadWeatherSettings(storage).location.coordinateSystem, "gcj02");
});

test("weather cache freshness, expiry, future timestamps, and coordinate-system changes are explicit", () => {
  const now = Date.parse("2026-09-24T12:00:00.000Z");
  assert.equal(classifyWeatherCache(null, location, now), "missing");
  assert.equal(
    classifyWeatherCache(snapshot(new Date(now - 20 * 60_000).toISOString()), location, now),
    "fresh",
  );
  assert.equal(
    classifyWeatherCache(snapshot(new Date(now - 2 * 60 * 60_000).toISOString()), location, now),
    "stale",
  );
  assert.equal(
    classifyWeatherCache(snapshot(new Date(now - 25 * 60 * 60_000).toISOString()), location, now),
    "expired",
  );
  assert.equal(
    classifyWeatherCache(snapshot(new Date(now + 1).toISOString()), location, now),
    "expired",
  );
  assert.equal(
    classifyWeatherCache(
      snapshot("2026-09-24T11:00:00.000Z", { ...location, coordinateSystem: "gcj02" }),
      location,
      now,
    ),
    "missing",
  );
});

test("weather storage removes malformed cache and keeps normalized valid cache", () => {
  const storage = memoryStorage();
  storage.setItem(WEATHER_CACHE_KEY, "not-json");
  assert.equal(loadWeatherCache(storage), null);
  assert.equal(storage.getItem(WEATHER_CACHE_KEY), null);
  assert.equal(saveWeatherCache(snapshot(), storage), true);
  assert.deepEqual(loadWeatherCache(storage), snapshot());
});

test("temperature, WMO labels, hierarchy and location identity use normalized location metadata", () => {
  assert.equal(formatTemperature(0, "fahrenheit"), "32°F");
  assert.equal(formatTemperature(22.4, "celsius"), "22°C");
  assert.equal(weatherCodeLabel(0), "晴");
  assert.equal(weatherCodeLabel(95), "雷雨");
  assert.equal(weatherCodeLabel(999), "天气情况未知");
  assert.equal(weatherLocationKey(location), "wgs84:31.9800,120.8900");
  assert.deepEqual(weatherLocationHierarchy(nativeLocation()), [
    "王村",
    "江苏省 · 徐州市 · 丰县 · 邢楼镇",
  ]);
  assert.equal(weatherLocationIdentity(nativeLocation()), "amap:A-1");
});

test("WGS-84 and GCJ-02 conversions round-trip mainland coordinates and preserve outside coordinates", () => {
  const wgs = { latitude: 31.2304, longitude: 121.4737 };
  const gcj = wgs84ToGcj02(wgs.latitude, wgs.longitude);
  assert.equal(gcj.coordinateSystem, "gcj02");
  assert.ok(Math.abs(gcj.latitude - wgs.latitude) > 0.001);
  assert.ok(Math.abs(gcj.longitude - wgs.longitude) > 0.001);
  const roundTrip = gcj02ToWgs84(gcj.latitude, gcj.longitude);
  assert.ok(Math.abs(roundTrip.latitude - wgs.latitude) < 0.00001);
  assert.ok(Math.abs(roundTrip.longitude - wgs.longitude) < 0.00001);
  assert.deepEqual(normalizeWeatherCoordinate(40, -74, "wgs84"), {
    latitude: 40,
    longitude: -74,
    coordinateSystem: "wgs84",
  });
});

test("Open-Meteo request converts internal GCJ-02 coordinates back to WGS-84", async () => {
  const urls = [];
  const provider = createOpenMeteoProvider(async (input) => {
    urls.push(new URL(String(input)));
    return new Response(
      JSON.stringify({
        timezone: "Asia/Shanghai",
        current: {
          time: "2026-09-24T08:00",
          temperature_2m: 22,
          apparent_temperature: 21,
          weather_code: 2,
          is_day: 1,
          relative_humidity_2m: 65,
        },
        hourly: {
          time: ["2026-09-24T08:00"],
          temperature_2m: [22],
          weather_code: [2],
          precipitation_probability: [null],
        },
        daily: {
          time: Array.from({ length: 7 }, (_, i) => "2026-09-" + String(24 + i).padStart(2, "0")),
          temperature_2m_max: Array(7).fill(25),
          temperature_2m_min: Array(7).fill(18),
          weather_code: Array(7).fill(2),
          precipitation_probability_max: Array(7).fill(null),
        },
      }),
      { status: 200 },
    );
  });
  const gcj = wgs84ToGcj02(location.latitude, location.longitude);
  await provider.fetchForecast({
    ...location,
    latitude: gcj.latitude,
    longitude: gcj.longitude,
    coordinateSystem: "gcj02",
  });
  const expected = openMeteoCoordinates({
    ...location,
    latitude: gcj.latitude,
    longitude: gcj.longitude,
    coordinateSystem: "gcj02",
  });
  assert.equal(Number(urls[0].searchParams.get("latitude")), expected.latitude);
  assert.equal(Number(urls[0].searchParams.get("longitude")), expected.longitude);
  assert.notEqual(urls[0].searchParams.get("latitude"), String(gcj.latitude));
  assert.equal(urls[0].searchParams.get("forecast_days"), "7");
  assert.equal(urls[0].searchParams.has("task"), false);
  assert.equal(urls[0].searchParams.has("diary"), false);
  assert.equal(urls[0].searchParams.has("inbox"), false);
});

test("map projection maps center, clicks, and drag pans in intuitive directions", () => {
  const center = { latitude: 31.23, longitude: 121.47 };
  const centerPoint = mapPixelToGcj02(center, 12, 320, 210, 640, 420);
  assert.ok(Math.abs(centerPoint.latitude - center.latitude) < 1e-8);
  assert.ok(Math.abs(centerPoint.longitude - center.longitude) < 1e-8);
  assert.equal(centerPoint.coordinateSystem, "gcj02");
  const east = mapPixelToGcj02(center, 12, 400, 210, 640, 420);
  const north = mapPixelToGcj02(center, 12, 320, 130, 640, 420);
  assert.ok(east.longitude > center.longitude);
  assert.ok(Math.abs(east.latitude - center.latitude) < 1e-8);
  assert.ok(north.latitude > center.latitude);
  const panned = panGcj02Map(center, 12, 80, 40);
  assert.ok(panned.longitude < center.longitude);
  assert.ok(panned.latitude > center.latitude);
  const pixel = gcj02PixelForCoordinate(center, east, 12, 640, 420);
  assert.ok(Math.abs(pixel.x - 400) < 0.001);
});

test("native weather transport sends text only to Rust and normalizes backend results", async () => {
  const calls = [];
  const provider = createNativeWeatherLocationProvider(async (command, args) => {
    calls.push({ command, args });
    if (command === "search_weather_location") return [nativeLocation()];
    if (command === "cancel_weather_location_search") return null;
    if (command === "reverse_geocode_weather_location") return nativeLocation();
    throw new Error("unexpected command");
  });
  const results = await provider.searchLocation("王村", undefined, "江苏省徐州市丰县");
  assert.equal(results[0].coordinateSystem, "gcj02");
  assert.deepEqual(calls[0].args, {
    query: "王村",
    adminHint: "江苏省徐州市丰县",
    requestId: calls[0].args.requestId,
  });
  assert.equal(typeof calls[0].args.requestId, "string");
  assert.deepEqual(await provider.reverseGeocode(34.7, 116.2), nativeLocation());
});

test("nullable optional fields in native AMap responses do not discard valid city results", async () => {
  const city = nativeLocation({
    displayName: "徐州市",
    displayAddress: "江苏省 · 徐州市",
    latitude: 34.2044,
    longitude: 117.2841,
    admin3: null,
    admin4: null,
    county: null,
    street: null,
    providerId: null,
    type: "城市",
    precision: "city",
  });
  const provider = createNativeWeatherLocationProvider(async (command) =>
    command === "search_weather_location" ? [city] : null,
  );

  const results = await provider.searchLocation("徐州市");

  assert.equal(results.length, 1);
  assert.equal(results[0].displayName, "徐州市");
  assert.equal(results[0].coordinateSystem, "gcj02");
  assert.equal(results[0].provider, "amap");
  assert.equal("admin3" in results[0], false);
  assert.equal(normalizeWeatherLocation({ ...city, county: 7 }), null);
});

test("aborted native search requests cancel the backend and discard stale responses", async () => {
  let finishSearch;
  const calls = [];
  const provider = createNativeWeatherLocationProvider((command) => {
    calls.push(command);
    if (command === "search_weather_location") {
      return new Promise((resolve) => {
        finishSearch = resolve;
      });
    }
    return Promise.resolve(null);
  });
  const controller = new AbortController();
  const pending = provider.searchLocation("李庄", controller.signal);
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  finishSearch([nativeLocation()]);
  await assert.rejects(pending, { name: "AbortError" });
  assert.ok(calls.includes("cancel_weather_location_search"));
});

test("location credentials stay write-only in UI status and map bytes retain safe image MIME", async () => {
  const calls = [];
  const invoke = async (command, args) => {
    calls.push({ command, args });
    if (command === "get_weather_credential_status") {
      return { amapConfigured: true, baiduConfigured: false };
    }
    if (command === "set_weather_provider_key" || command === "delete_weather_provider_key") {
      return true;
    }
    if (command === "get_weather_map_image") {
      return { mimeType: "image/jpeg", bytes: [255, 216, 255] };
    }
    return null;
  };
  assert.deepEqual(await getWeatherProviderCredentialStatus(invoke), {
    amapConfigured: true,
    baiduConfigured: false,
  });
  assert.equal(await saveWeatherProviderKey("amap", "private-key", invoke), true);
  assert.equal(await removeWeatherProviderKey("amap", invoke), true);
  const image = await getWeatherMapImage(35, 105, 6, invoke);
  assert.equal(image.type, "image/jpeg");
  assert.deepEqual(
    calls.map((item) => item.command),
    [
      "get_weather_credential_status",
      "set_weather_provider_key",
      "delete_weather_provider_key",
      "get_weather_map_image",
    ],
  );
  assert.deepEqual(Object.keys(await getWeatherProviderCredentialStatus(invoke)).sort(), [
    "amapConfigured",
    "baiduConfigured",
  ]);
});

test("Open-Meteo adapter rejects malformed and failed service responses", async () => {
  const provider = createOpenMeteoProvider(async () => new Response("nope", { status: 200 }));
  await assert.rejects(() => provider.fetchForecast(location));
  const failed = createOpenMeteoProvider(async () => new Response("", { status: 503 }));
  await assert.rejects(() => failed.fetchForecast(location), /weather-provider-unavailable/u);
});

test("production weather composition keeps forecast lookup separate from native location resolution", async () => {
  const calls = [];
  const provider = createWorkspaceWeatherProvider(
    async (input) => {
      calls.push(String(input));
      return new Response("{}", { status: 500 });
    },
    {
      searchLocation: async (query, _signal, adminHint) => {
        calls.push(JSON.stringify({ query, adminHint }));
        return [nativeLocation()];
      },
      reverseGeocode: async () => null,
    },
  );
  const result = await provider.searchLocation("王村", undefined, "丰县");
  assert.equal(result[0].provider, "amap");
  assert.equal(calls[0], JSON.stringify({ query: "王村", adminHint: "丰县" }));
  await assert.rejects(() => provider.fetchForecast(location), /weather-provider-unavailable/u);
  assert.match(calls[1], /^https:\/\/api\.open-meteo\.com\/v1\/forecast/u);
});
