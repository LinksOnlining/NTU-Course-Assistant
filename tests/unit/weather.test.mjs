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
  saveWeatherCache,
  saveWeatherSettings,
} from "../../src/services/weather-storage.ts";
import { createOpenMeteoProvider } from "../../src/services/weather-provider.ts";
import { createPhotonLocationSearchProvider } from "../../src/services/photon-location-provider.ts";
import { createPhotonReverseGeocodingProvider } from "../../src/services/reverse-geocoding-provider.ts";

const location = {
  displayName: "南通 · 江苏 · 中国",
  latitude: 31.98,
  longitude: 120.89,
  timezone: "Asia/Shanghai",
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
      date: `2026-09-${String(24 + index).padStart(2, "0")}`,
      highCelsius: 25,
      lowCelsius: 18,
      precipitationProbability: null,
      weatherCode: 2,
    })),
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

function photonFeature(properties, longitude = 120.89, latitude = 31.98) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [longitude, latitude] },
    properties,
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

test("a selected detailed location persists supported hierarchy and provider identity", () => {
  const storage = memoryStorage();
  const selected = {
    displayName: "青年中路",
    latitude: 31.98123,
    longitude: 120.86234,
    timezone: null,
    country: "中国",
    admin1: "江苏省",
    admin2: "南通市",
    admin3: "崇川区",
    street: "青年中路",
    providerId: "W:1234",
    precision: "street",
    source: "manual",
  };
  assert.equal(
    saveWeatherSettings({ enabled: true, location: selected, temperatureUnit: "celsius" }, storage),
    true,
  );
  assert.deepEqual(loadWeatherSettings(storage).location, selected);
});

test("weather cache freshness, expiry, future timestamps, and location changes are explicit", () => {
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
      snapshot("2026-09-24T11:00:00.000Z", { ...location, latitude: 30 }),
      location,
      now,
    ),
    "missing",
  );
});

test("weather storage rejects and removes a malformed persistent cache", () => {
  const storage = memoryStorage();
  storage.setItem(WEATHER_CACHE_KEY, "not-json");
  assert.equal(loadWeatherCache(storage), null);
  assert.equal(storage.getItem(WEATHER_CACHE_KEY), null);
  assert.equal(saveWeatherCache(snapshot(), storage), true);
  assert.deepEqual(loadWeatherCache(storage), snapshot());
});

test("temperature and WMO labels are normalized for presentation", () => {
  assert.equal(formatTemperature(0, "fahrenheit"), "32°F");
  assert.equal(formatTemperature(22.4, "celsius"), "22°C");
  assert.equal(weatherCodeLabel(0), "晴");
  assert.equal(weatherCodeLabel(95), "雷雨");
  assert.equal(weatherCodeLabel(999), "天气情况未知");
  assert.match(weatherLocationKey(location), /^31\.9800,120\.8900$/u);
});

test("Open-Meteo adapter sends only explicit city/weather parameters and normalizes data", async () => {
  const urls = [];
  const provider = createOpenMeteoProvider(async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.hostname === "geocoding-api.open-meteo.com") {
      return new Response(
        JSON.stringify({
          results: [
            {
              name: "南通",
              admin1: "江苏",
              country: "中国",
              feature_code: "ADM2",
              latitude: 31.98,
              longitude: 120.89,
              timezone: "Asia/Shanghai",
            },
          ],
        }),
        { status: 200 },
      );
    }
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
          time: Array.from({ length: 7 }, (_, i) => `2026-09-${String(24 + i).padStart(2, "0")}`),
          temperature_2m_max: Array(7).fill(25),
          temperature_2m_min: Array(7).fill(18),
          weather_code: Array(7).fill(2),
          precipitation_probability_max: Array(7).fill(null),
        },
      }),
      { status: 200 },
    );
  });

  const locations = await provider.searchLocation(" 南通 ");
  assert.equal(locations[0].displayName, "南通");
  assert.equal(locations[0].admin1, "江苏");
  assert.equal(locations[0].precision, "city");
  assert.equal(locations[0].source, "manual");
  const result = await provider.fetchForecast(locations[0]);
  assert.equal(result.current.temperatureCelsius, 22);
  assert.equal(result.hourly[0].precipitationProbability, null);
  assert.equal(result.daily.length, 7);
  assert.ok(Number.isFinite(Date.parse(result.fetchedAt)));
  assert.deepEqual(
    urls.map((url) => url.hostname),
    ["geocoding-api.open-meteo.com", "api.open-meteo.com"],
  );
  assert.equal(urls[0].searchParams.get("name"), "南通");
  assert.equal(urls[0].searchParams.get("language"), "zh");
  assert.equal(urls[0].searchParams.get("count"), "5");
  assert.equal(urls[1].searchParams.get("latitude"), "31.98");
  assert.equal(urls[1].searchParams.get("forecast_days"), "7");
  assert.equal(urls[1].searchParams.has("task"), false);
  assert.equal(urls[1].searchParams.has("diary"), false);
  assert.equal(urls[1].searchParams.has("inbox"), false);
  assert.equal(urls[1].searchParams.has("course"), false);
  assert.equal(urls[1].searchParams.has("query"), false);
});

test("Photon forward search supports the required Chinese detailed-place queries without layer filtering", async () => {
  const queries = [
    "崇川区",
    "南通市崇川区",
    "文峰街道",
    "南通市崇川区文峰街道",
    "青年中路",
    "南通大学",
  ];
  const requested = [];
  const provider = createPhotonLocationSearchProvider(async (input) => {
    const url = new URL(String(input));
    requested.push(url);
    const query = url.searchParams.get("q");
    const properties = {
      崇川区: {
        name: "崇川区",
        type: "district",
        osm_key: "place",
        osm_value: "city_district",
        district: "崇川区",
        state: "江苏省",
        country: "中国",
        osm_type: "R",
        osm_id: 100,
      },
      南通市崇川区: {
        name: "崇川区",
        type: "district",
        district: "崇川区",
        city: "南通市",
        state: "江苏省",
        country: "中国",
        osm_type: "R",
        osm_id: 101,
      },
      文峰街道: {
        name: "文峰街道",
        type: "locality",
        locality: "文峰街道",
        city: "南通市",
        state: "江苏省",
        country: "中国",
        osm_type: "R",
        osm_id: 102,
      },
      南通市崇川区文峰街道: {
        name: "文峰街道",
        type: "locality",
        locality: "文峰街道",
        district: "崇川区",
        city: "南通市",
        state: "江苏省",
        country: "中国",
        osm_type: "R",
        osm_id: 103,
      },
      青年中路: {
        name: "青年中路",
        type: "street",
        street: "青年中路",
        district: "崇川区",
        city: "南通市",
        state: "江苏省",
        country: "中国",
        osm_key: "highway",
        osm_value: "residential",
        osm_type: "W",
        osm_id: 104,
      },
      南通大学: {
        name: "南通大学",
        type: "other",
        street: "啬园路",
        district: "崇川区",
        city: "南通市",
        state: "江苏省",
        country: "中国",
        osm_key: "amenity",
        osm_value: "university",
        osm_type: "N",
        osm_id: 105,
      },
    }[query];
    return new Response(
      JSON.stringify({ features: properties ? [photonFeature(properties)] : [] }),
      { status: 200 },
    );
  });

  for (const query of queries) {
    const locations = await provider.searchLocation(query);
    assert.equal(locations.length, 1, query);
    assert.equal(locations[0].source, "manual");
    assert.equal(locations[0].timezone, null);
  }
  assert.deepEqual(
    requested.map((url) => url.searchParams.get("q")),
    queries,
  );
  assert.ok(requested.every((url) => url.pathname === "/api"));
  assert.ok(requested.every((url) => url.searchParams.get("lang") === "zh"));
  assert.ok(requested.every((url) => url.searchParams.get("limit") === "12"));
  assert.ok(requested.every((url) => !url.searchParams.has("layer")));
  assert.ok(requested.every((url) => !url.searchParams.has("countrycode")));
});

test("Photon normalization accepts missing city/district, maps layers, ranks exact detailed results, and deduplicates", async () => {
  const provider = createPhotonLocationSearchProvider(
    async () =>
      new Response(
        JSON.stringify({
          features: [
            photonFeature({
              name: "南通市",
              type: "city",
              city: "南通市",
              state: "江苏省",
              osm_type: "R",
              osm_id: 1,
            }),
            photonFeature({
              name: "崇川区",
              type: "district",
              district: "崇川区",
              state: "江苏省",
              country: "中国",
              osm_type: "R",
              osm_id: 2,
            }),
            photonFeature({
              name: "崇川区",
              type: "district",
              district: "崇川区",
              state: "江苏省",
              country: "中国",
              osm_type: "R",
              osm_id: 2,
            }),
            photonFeature({
              name: "文峰街道",
              type: "locality",
              locality: "文峰街道",
              district: "崇川区",
              state: "江苏省",
              country: "中国",
              osm_type: "R",
              osm_id: 3,
            }),
            photonFeature({
              name: "青年中路",
              type: "street",
              street: "青年中路",
              city: "南通市",
              state: "江苏省",
              osm_type: "W",
              osm_id: 4,
            }),
            photonFeature({
              name: "命名住宅",
              type: "house",
              street: "青年中路",
              housenumber: "88",
              osm_type: "W",
              osm_id: 5,
            }),
            photonFeature({
              name: "88号",
              type: "house",
              street: "青年中路",
              housenumber: "88",
              osm_type: "W",
              osm_id: 12,
            }),
            photonFeature({
              name: "南通大学",
              type: "other",
              street: "啬园路",
              osm_key: "amenity",
              osm_value: "university",
              osm_type: "N",
              osm_id: 6,
            }),
            photonFeature({
              name: "崇川片区",
              type: "locality",
              locality: "崇川片区",
              state: "江苏省",
              osm_type: "R",
              osm_id: 7,
            }),
            photonFeature({
              name: "海安县",
              type: "county",
              county: "海安县",
              state: "江苏省",
              osm_type: "R",
              osm_id: 8,
            }),
            photonFeature({
              name: "江苏省",
              type: "state",
              state: "江苏省",
              country: "中国",
              osm_type: "R",
              osm_id: 9,
            }),
            photonFeature({
              name: "中国",
              type: "country",
              country: "中国",
              osm_type: "R",
              osm_id: 10,
            }),
            photonFeature({
              name: "未分类地点",
              type: "building",
              city: "南通市",
              osm_type: "W",
              osm_id: 11,
            }),
          ],
        }),
        { status: 200 },
      ),
  );

  const results = await provider.searchLocation("崇川区");
  assert.deepEqual(
    results.slice(0, 3).map((item) => item.displayName),
    ["崇川区", "文峰街道", "青年中路"],
  );
  assert.equal(results.filter((item) => item.providerId === "R:2").length, 1);
  assert.equal(results.find((item) => item.displayName === "崇川区").precision, "district");
  assert.equal(results.find((item) => item.displayName === "文峰街道").precision, "locality");
  assert.equal(results.find((item) => item.displayName === "青年中路").precision, "street");
  assert.equal(results.find((item) => item.displayName === "命名住宅").precision, "house");
  assert.equal(results.find((item) => item.providerId === "W:12").displayName, "青年中路");
  assert.equal(results.find((item) => item.providerId === "W:12").precision, "house");
  assert.equal(results.find((item) => item.displayName === "青年中路").precision, "street");
  assert.equal(results.find((item) => item.displayName === "南通大学").precision, "other");
  assert.equal(results.find((item) => item.displayName === "海安县").precision, "county");
  assert.equal(results.find((item) => item.displayName === "江苏省").precision, "state");
  assert.equal(results.find((item) => item.displayName === "中国").precision, "country");
  assert.equal(results.find((item) => item.displayName === "未分类地点").precision, "other");
  const districtWithoutCity = results.find((item) => item.displayName === "崇川区");
  const localityWithoutDistrict = results.find((item) => item.displayName === "崇川片区");
  assert.equal(districtWithoutCity.admin2, undefined);
  assert.equal(localityWithoutDistrict.admin3, undefined);
  assert.deepEqual(weatherLocationHierarchy(districtWithoutCity), ["崇川区", "江苏省", "中国"]);
  assert.equal(JSON.stringify(results).includes("housenumber"), false);
  assert.equal(JSON.stringify(results).includes("88"), false);
  assert.equal(weatherLocationIdentity(results[0]), "osm:R:2");
});

test("Photon falls back only after an empty administrative-suffix search and still uses provider results", async () => {
  const requested = [];
  const provider = createPhotonLocationSearchProvider(async (input) => {
    const url = new URL(String(input));
    requested.push(url.searchParams.get("q"));
    return new Response(
      JSON.stringify({
        features:
          url.searchParams.get("q") === "崇川"
            ? [
                photonFeature({
                  name: "崇川区",
                  type: "district",
                  district: "崇川区",
                  state: "江苏省",
                }),
              ]
            : [],
      }),
      { status: 200 },
    );
  });
  const results = await provider.searchLocation("崇川区");
  assert.deepEqual(requested, ["崇川区", "崇川"]);
  assert.equal(results[0].displayName, "崇川区");

  const empty = createPhotonLocationSearchProvider(
    async () => new Response(JSON.stringify({ features: [] }), { status: 200 }),
  );
  assert.deepEqual(await empty.searchLocation("青年中路"), []);
  const malformed = createPhotonLocationSearchProvider(
    async () =>
      new Response(JSON.stringify({ features: [{ properties: { name: "缺少坐标" } }] }), {
        status: 200,
      }),
  );
  await assert.rejects(() => malformed.searchLocation("青年中路"), /invalid-location-response/u);
});

test("production weather provider searches Photon and forecasts the exact selected coordinates", async () => {
  const urls = [];
  const provider = createWorkspaceWeatherProvider(async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.hostname === "photon.komoot.io") {
      return new Response(
        JSON.stringify({
          features: [
            photonFeature(
              {
                name: "崇川区",
                type: "district",
                district: "崇川区",
                city: "南通市",
                state: "江苏省",
                country: "中国",
              },
              120.86234,
              31.98123,
            ),
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        timezone: "Asia/Shanghai",
        current: { time: "2026-09-24T08:00", temperature_2m: 22, weather_code: 2, is_day: 1 },
        hourly: {
          time: ["2026-09-24T08:00"],
          temperature_2m: [22],
          weather_code: [2],
          precipitation_probability: [null],
        },
        daily: {
          time: Array.from(
            { length: 7 },
            (_, index) => `2026-09-${String(24 + index).padStart(2, "0")}`,
          ),
          temperature_2m_max: Array(7).fill(25),
          temperature_2m_min: Array(7).fill(18),
          weather_code: Array(7).fill(2),
          precipitation_probability_max: Array(7).fill(null),
        },
      }),
      { status: 200 },
    );
  });

  const selected = (await provider.searchLocation("崇川区"))[0];
  const result = await provider.fetchForecast(selected);
  const forecastUrl = urls.find((url) => url.hostname === "api.open-meteo.com");
  assert.equal(urls[0].hostname, "photon.komoot.io");
  assert.equal(urls[0].pathname, "/api");
  assert.equal(forecastUrl.searchParams.get("latitude"), String(selected.latitude));
  assert.equal(forecastUrl.searchParams.get("longitude"), String(selected.longitude));
  assert.deepEqual(result.location, selected);
  assert.equal(selected.latitude, 31.98123);
  assert.equal(selected.longitude, 120.86234);
});

test("Photon reverse geocoding keeps only administrative hierarchy and preserves rounded coordinates", async () => {
  let requestedUrl;
  const provider = createPhotonReverseGeocodingProvider(async (input) => {
    requestedUrl = new URL(String(input));
    return new Response(
      JSON.stringify({
        features: [
          {
            properties: {
              name: "崇川区",
              locality: "观音山街道",
              district: "崇川区",
              city: "南通市",
              state: "江苏省",
              country: "中国",
              street: "私人道路名称",
              housenumber: "88",
              postcode: "226000",
            },
          },
        ],
      }),
      { status: 200 },
    );
  });

  const location = await provider.reverseGeocode(31.223, 120.897);
  assert.equal(requestedUrl.hostname, "photon.komoot.io");
  assert.equal(requestedUrl.pathname, "/reverse");
  assert.equal(requestedUrl.searchParams.get("lat"), "31.223");
  assert.equal(requestedUrl.searchParams.get("lon"), "120.897");
  assert.deepEqual(location, {
    displayName: "观音山街道",
    latitude: 31.223,
    longitude: 120.897,
    timezone: null,
    country: "中国",
    admin1: "江苏省",
    admin2: "南通市",
    admin3: "崇川区",
    admin4: "观音山街道",
    precision: "locality",
    source: "device",
  });
  assert.ok(!JSON.stringify(location).includes("私人道路名称"));
  assert.ok(!JSON.stringify(location).includes("226000"));
});

test("Open-Meteo adapter rejects malformed and failed service responses", async () => {
  const malformed = createOpenMeteoProvider(
    async () => new Response(JSON.stringify({ current: {} }), { status: 200 }),
  );
  await assert.rejects(() => malformed.fetchForecast(location), /invalid-weather-response/u);
  const failed = createOpenMeteoProvider(async () => new Response("", { status: 503 }));
  await assert.rejects(() => failed.searchLocation("南通"), /weather-provider-unavailable/u);
  const empty = createOpenMeteoProvider(
    async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
  );
  assert.deepEqual(await empty.searchLocation("不存在的城市"), []);
});
