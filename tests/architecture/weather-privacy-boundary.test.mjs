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

test("Weather forecast stays separate from the native AMap/Baidu location resolver", () => {
  const files = sourceFiles("src");
  const transportCalls = files.filter((path) => /\bfetcher\s*\(/u.test(read(path))).sort();
  assert.deepEqual(transportCalls, ["src/services/weather-provider.ts"]);
  const provider = read("src/services/weather-provider.ts");
  assert.match(provider, /https:\/\/api\.open-meteo\.com\/v1\/forecast/u);
  assert.doesNotMatch(provider, /geocoding-api\.open-meteo\.com/u);
  assert.match(provider, /openMeteoCoordinates/u);
  assert.doesNotMatch(provider, /navigator\.geolocation|\bIP\s*location/u);
  const transport = read("src/services/weather-location-transport.ts");
  assert.match(transport, /search_weather_location/u);
  assert.match(transport, /reverse_geocode_weather_location/u);
  assert.match(transport, /cancel_weather_location_search/u);
  assert.match(transport, /get_weather_map_image/u);
  assert.match(transport, /set_weather_provider_key/u);
  assert.match(transport, /get_weather_credential_status/u);
  assert.doesNotMatch(transport, /restapi\.amap\.com|api\.map\.baidu\.com|\bfetch\s*\(/u);
  const native = read("src-tauri/src/geocoding.rs");
  assert.match(native, /restapi\.amap\.com/u);
  assert.match(native, /api\.map\.baidu\.com/u);
  assert.match(native, /LinksWorkplace\//u);
  assert.match(native, /v3\/assistant\/inputtips/u);
  assert.match(native, /v3\/place\/text/u);
  assert.match(native, /v3\/geocode\/geo/u);
  assert.match(native, /v3\/config\/district/u);
  assert.match(native, /geoconv\/v2/u);
  assert.match(native, /model.*5/u);
  assert.match(native, /CACHE_TTL/u);
  assert.doesNotMatch(native, /println!\([^\n]*(?:query|key|token)/iu);
  assert.doesNotMatch(native, /photon|nominatim/u);
  assert.match(native, /CACHE_TTL/u);
  const application = read("src/application/weather/weather.ts");
  assert.match(application, /createNativeWeatherLocationProvider/u);
  assert.match(application, /createOpenMeteoProvider/u);
  const credentials = read("src-tauri/src/secure_credentials.rs");
  assert.match(credentials, /keyring::Entry/u);
  assert.match(read("src-tauri/src/ai.rs"), /secure_credentials::get/u);

  const config = read("src-tauri/tauri.conf.json");
  const connectSrc = config.match(/connect-src ([^";]+)/u)?.[1] ?? "";
  const imageSrc = config.match(/img-src ([^";]+)/u)?.[1] ?? "";
  assert.match(connectSrc, /https:\/\/api\.open-meteo\.com/u);
  assert.doesNotMatch(connectSrc, /amap|baidu|photon|nominatim|geocoding-api/u);
  assert.doesNotMatch(connectSrc, /\*/u);
  assert.match(imageSrc, /\bblob:/u, "the map image is rendered from a Blob object URL");
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
