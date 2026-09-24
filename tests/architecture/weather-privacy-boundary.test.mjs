import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function sourceFiles(directory) {
  return readdirSync(new URL(`../../${directory}`, import.meta.url), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const path = join(directory, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

test("Weather forecast stays in WebView while geocoding crosses the native transport boundary", () => {
  const files = sourceFiles("src");
  const transportCalls = files.filter((path) => /\bfetcher\s*\(/u.test(read(path))).sort();
  assert.deepEqual(transportCalls, [
    "src/services/photon-location-provider.ts",
    "src/services/reverse-geocoding-provider.ts",
    "src/services/weather-provider.ts",
  ]);
  const provider = read("src/services/weather-provider.ts");
  assert.match(provider, /https:\/\/api\.open-meteo\.com\/v1\/forecast/u);
  assert.doesNotMatch(provider, /geocoding-api\.open-meteo\.com/u);
  assert.doesNotMatch(provider, /navigator\.geolocation|\bIP\s*location/u);
  const reverseProvider = read("src/services/reverse-geocoding-provider.ts");
  assert.match(reverseProvider, /nativeGeocodingFetch/u);
  assert.doesNotMatch(reverseProvider, /fetch\s*\(/u);
  assert.doesNotMatch(reverseProvider, /street|housenumber|postcode\s*:/iu);
  const photonSearch = read("src/services/photon-location-provider.ts");
  assert.match(photonSearch, /nativeGeocodingFetch/u);
  assert.doesNotMatch(photonSearch, /fetch\s*\(/u);
  assert.match(photonSearch, /searchParams\.set\("q"/u);
  assert.match(photonSearch, /searchParams\.set\("lang", "default"\)/u);
  assert.doesNotMatch(photonSearch, /searchParams\.set\("layer"/u);
  assert.doesNotMatch(photonSearch, /searchParams\.set\("countrycode"/u);
  const transport = read("src/services/native-geocoding-transport.ts");
  assert.match(transport, /search_weather_location/u);
  assert.match(transport, /reverse_geocode_weather_location/u);
  assert.doesNotMatch(transport, /\bfetch\s*\(/u);
  const native = read("src-tauri/src/geocoding.rs");
  assert.match(native, /photon\.komoot\.io/u);
  assert.match(native, /nominatim\.openstreetmap\.org/u);
  assert.match(native, /LinksWorkplace\//u);
  assert.match(native, /NOMINATIM_INTERVAL/u);
  assert.match(native, /CACHE_TTL/u);
  const application = read("src/application/weather/weather.ts");
  assert.match(application, /createPhotonLocationSearchProvider/u);
  assert.ok(
    application.indexOf("...createOpenMeteoProvider") <
      application.indexOf("...createPhotonLocationSearchProvider"),
    "Photon forward search must override Open-Meteo city geocoding in production composition",
  );

  const config = read("src-tauri/tauri.conf.json");
  const connectSrc = config.match(/connect-src ([^";]+)/u)?.[1] ?? "";
  assert.match(connectSrc, /https:\/\/api\.open-meteo\.com/u);
  assert.doesNotMatch(connectSrc, /photon|nominatim|geocoding-api/u);
  assert.doesNotMatch(connectSrc, /\*/u);
});

test("Weather UI/application boundary cannot read personal repositories or send their contents", () => {
  const files = [
    ...sourceFiles("src/application/weather"),
    ...sourceFiles("src/workspace/weather"),
  ];
  for (const path of files) {
    const code = read(path);
    assert.doesNotMatch(
      code,
      /diary-storage|inbox-storage|planner-storage|course-storage|repository|\binvoke\s*\(/iu,
    );
    if (path !== "src/workspace/weather/use-workspace-weather.ts") {
      assert.doesNotMatch(code, /navigator\.geolocation/u);
    }
  }
  const settings = read("src/services/weather-storage.ts");
  assert.match(settings, /links-workplace\.weather\./u);
  assert.doesNotMatch(settings, /courses\.sqlite3|user_version|schema/u);
});

test("Weather is opt-in and its persistence has no schema migration", () => {
  const storage = read("src/services/weather-storage.ts");
  assert.match(storage, /enabled:\s*false/u);
  assert.match(storage, /links-workplace\.weather\.settings/u);
  assert.match(storage, /links-workplace\.weather\.cache/u);
  const hook = read("src/workspace/weather/use-workspace-weather.ts");
  assert.match(hook, /if \(!settings\.enabled\)/u);
  assert.doesNotMatch(hook, /setInterval|setTimeout/u);
});
