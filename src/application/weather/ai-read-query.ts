import { loadWeatherCache, loadWeatherSettings } from "./weather-storage.ts";
import { weatherCodeLabel, weatherLocationKey } from "./weather.ts";

export function readWeatherAiSummary() {
  const settings = loadWeatherSettings();
  const snapshot = loadWeatherCache();
  if (
    !settings.enabled ||
    !settings.location ||
    !snapshot ||
    weatherLocationKey(settings.location) !== weatherLocationKey(snapshot.location)
  ) {
    return Object.freeze({ location: null, current: null, forecast: Object.freeze([]) });
  }
  const now = new Date();
  const date = localDateKey(now);
  const time = localTimeKey(now);
  const forecast = snapshot.hourly
    .filter((item) => item.time.slice(0, 10) === date && item.time.slice(11, 16) >= time)
    .sort((left, right) => left.time.localeCompare(right.time))
    .slice(0, 12)
    .map((item) => ({
      time: item.time,
      condition: weatherCodeLabel(item.weatherCode),
      temperatureCelsius: item.temperatureCelsius,
      precipitationProbability: item.precipitationProbability,
    }));
  return Object.freeze({
    location: safeText(snapshot.location.displayName),
    current: Object.freeze({
      time: snapshot.current.time,
      condition: weatherCodeLabel(snapshot.current.weatherCode),
      temperatureCelsius: snapshot.current.temperatureCelsius,
      humidityPercent: snapshot.current.humidityPercent,
    }),
    forecast: Object.freeze(forecast),
  });
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localTimeKey(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function safeText(value: string): string {
  return Array.from(value).slice(0, 180).join("");
}
