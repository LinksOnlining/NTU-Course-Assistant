import type {
  WeatherCurrent,
  WeatherDailyForecast,
  WeatherHourlyForecast,
  WeatherLocation,
  WeatherProvider,
  WeatherRequestSignal,
  WeatherSnapshot,
} from "../types/weather.ts";

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberArray(value: unknown): readonly number[] | null {
  if (!Array.isArray(value)) return null;
  const numbers = value.map(finiteNumber);
  return numbers.some((item) => item === null) ? null : (numbers as number[]);
}

function nullableNumberArray(value: unknown): readonly (number | null)[] | null {
  if (!Array.isArray(value)) return null;
  const values = value.map((item) => (item === null ? null : finiteNumber(item)));
  return values.some((item, index) => item === null && value[index] !== null)
    ? null
    : (values as (number | null)[]);
}

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.map(nonEmptyString);
  return strings.some((item) => item === null) ? null : (strings as string[]);
}

function locationDisplayName(record: JsonRecord): string | null {
  const name = nonEmptyString(record.name);
  if (!name) return null;
  return [name, nonEmptyString(record.admin1), nonEmptyString(record.country)]
    .filter((part, index, parts) => part && parts.indexOf(part) === index)
    .join(" · ");
}

function parseLocations(value: unknown): readonly WeatherLocation[] {
  if (!isRecord(value) || !Array.isArray(value.results)) return [];
  return value.results.flatMap((item) => {
    if (!isRecord(item)) return [];
    const latitude = finiteNumber(item.latitude);
    const longitude = finiteNumber(item.longitude);
    const displayName = locationDisplayName(item);
    if (latitude === null || longitude === null || !displayName) return [];
    return [
      {
        displayName,
        latitude,
        longitude,
        timezone: nonEmptyString(item.timezone),
      },
    ];
  });
}

function parseForecast(
  value: unknown,
  location: WeatherLocation,
): Omit<WeatherSnapshot, "fetchedAt"> {
  if (
    !isRecord(value) ||
    !isRecord(value.current) ||
    !isRecord(value.hourly) ||
    !isRecord(value.daily)
  ) {
    throw new Error("invalid-weather-response");
  }

  const currentRecord = value.current;
  const currentTime = nonEmptyString(currentRecord.time);
  const temperatureCelsius = finiteNumber(currentRecord.temperature_2m);
  const weatherCode = finiteNumber(currentRecord.weather_code);
  const isDay = currentRecord.is_day;
  if (
    !currentTime ||
    temperatureCelsius === null ||
    weatherCode === null ||
    (isDay !== 0 && isDay !== 1)
  ) {
    throw new Error("invalid-weather-response");
  }
  const current: WeatherCurrent = {
    time: currentTime,
    temperatureCelsius,
    apparentTemperatureCelsius: finiteNumber(currentRecord.apparent_temperature),
    weatherCode,
    isDay: isDay === 1,
    humidityPercent: finiteNumber(currentRecord.relative_humidity_2m),
  };

  const hourlyTimes = stringArray(value.hourly.time);
  const hourlyTemperatures = numberArray(value.hourly.temperature_2m);
  const hourlyCodes = numberArray(value.hourly.weather_code);
  const hourlyPrecipitation = nullableNumberArray(value.hourly.precipitation_probability);
  if (
    !hourlyTimes ||
    !hourlyTemperatures ||
    !hourlyCodes ||
    !hourlyPrecipitation ||
    hourlyTimes.length !== hourlyTemperatures.length ||
    hourlyTimes.length !== hourlyCodes.length ||
    hourlyTimes.length !== hourlyPrecipitation.length
  ) {
    throw new Error("invalid-weather-response");
  }
  const hourly: readonly WeatherHourlyForecast[] = hourlyTimes.slice(0, 48).map((time, index) => ({
    time,
    temperatureCelsius: hourlyTemperatures[index]!,
    precipitationProbability: hourlyPrecipitation[index]!,
    weatherCode: hourlyCodes[index]!,
  }));

  const dailyTimes = stringArray(value.daily.time);
  const dailyHighs = numberArray(value.daily.temperature_2m_max);
  const dailyLows = numberArray(value.daily.temperature_2m_min);
  const dailyCodes = numberArray(value.daily.weather_code);
  const dailyPrecipitation = nullableNumberArray(value.daily.precipitation_probability_max);
  if (
    !dailyTimes ||
    !dailyHighs ||
    !dailyLows ||
    !dailyCodes ||
    !dailyPrecipitation ||
    dailyTimes.length !== dailyHighs.length ||
    dailyTimes.length !== dailyLows.length ||
    dailyTimes.length !== dailyCodes.length ||
    dailyTimes.length !== dailyPrecipitation.length
  ) {
    throw new Error("invalid-weather-response");
  }
  const daily: readonly WeatherDailyForecast[] = dailyTimes.slice(0, 7).map((date, index) => ({
    date,
    highCelsius: dailyHighs[index]!,
    lowCelsius: dailyLows[index]!,
    precipitationProbability: dailyPrecipitation[index]!,
    weatherCode: dailyCodes[index]!,
  }));
  const timezone = nonEmptyString(value.timezone);
  if (hourly.length === 0 || daily.length !== 7 || !timezone) {
    throw new Error("invalid-weather-response");
  }
  return { location, timezone, current, hourly, daily };
}

async function getJson(
  fetcher: FetchLike,
  url: URL,
  signal?: WeatherRequestSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(10_000);
  const abortSignal = signal instanceof AbortSignal ? signal : undefined;
  const combinedSignal = abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout;
  const response = await fetcher(url, {
    signal: combinedSignal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("weather-provider-unavailable");
  return response.json() as Promise<unknown>;
}

export function createOpenMeteoProvider(fetcher: FetchLike = fetch): WeatherProvider {
  return {
    async searchLocation(query, signal) {
      const term = query.trim();
      if (!term) return [];
      const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
      url.searchParams.set("name", term);
      url.searchParams.set("count", "5");
      url.searchParams.set("language", "zh");
      return parseLocations(await getJson(fetcher, url, signal));
    },
    async fetchForecast(location, signal) {
      const url = new URL("https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", String(location.latitude));
      url.searchParams.set("longitude", String(location.longitude));
      url.searchParams.set("timezone", location.timezone ?? "auto");
      url.searchParams.set("forecast_days", "7");
      url.searchParams.set("forecast_hours", "48");
      url.searchParams.set(
        "current",
        "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code",
      );
      url.searchParams.set("hourly", "temperature_2m,precipitation_probability,weather_code");
      url.searchParams.set(
        "daily",
        "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      );
      const result = parseForecast(await getJson(fetcher, url, signal), location);
      return { ...result, fetchedAt: new Date().toISOString() };
    },
  };
}
