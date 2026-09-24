import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyWeatherCache,
  formatTemperature,
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
  assert.equal(locations[0].displayName, "南通 · 江苏 · 中国");
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
  assert.equal(urls[1].searchParams.get("latitude"), "31.98");
  assert.equal(urls[1].searchParams.get("forecast_days"), "7");
  assert.equal(urls[1].searchParams.has("task"), false);
  assert.equal(urls[1].searchParams.has("diary"), false);
  assert.equal(urls[1].searchParams.has("inbox"), false);
  assert.equal(urls[1].searchParams.has("course"), false);
  assert.equal(urls[1].searchParams.has("query"), false);
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
