export interface WeatherLocation {
  readonly displayName: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly timezone: string | null;
}

export interface WeatherProvider {
  searchLocation(query: string, signal?: WeatherRequestSignal): Promise<readonly WeatherLocation[]>;
  fetchForecast(location: WeatherLocation, signal?: WeatherRequestSignal): Promise<WeatherSnapshot>;
}

export interface WeatherRequestSignal {
  readonly aborted: boolean;
}

export type TemperatureUnit = "celsius" | "fahrenheit";

export interface WeatherSettings {
  readonly enabled: boolean;
  readonly location: WeatherLocation | null;
  readonly temperatureUnit: TemperatureUnit;
}

export interface WeatherCurrent {
  readonly time: string;
  readonly temperatureCelsius: number;
  readonly apparentTemperatureCelsius: number | null;
  readonly weatherCode: number;
  readonly isDay: boolean;
  readonly humidityPercent: number | null;
}

export interface WeatherHourlyForecast {
  readonly time: string;
  readonly temperatureCelsius: number;
  readonly precipitationProbability: number | null;
  readonly weatherCode: number;
}

export interface WeatherDailyForecast {
  readonly date: string;
  readonly highCelsius: number;
  readonly lowCelsius: number;
  readonly precipitationProbability: number | null;
  readonly weatherCode: number;
}

export interface WeatherSnapshot {
  readonly location: WeatherLocation;
  readonly fetchedAt: string;
  readonly timezone: string;
  readonly current: WeatherCurrent;
  readonly hourly: readonly WeatherHourlyForecast[];
  readonly daily: readonly WeatherDailyForecast[];
}

export type WeatherViewState =
  | { readonly kind: "disabled" }
  | { readonly kind: "needsLocation" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly snapshot: WeatherSnapshot }
  | {
      readonly kind: "stale";
      readonly snapshot: WeatherSnapshot;
      readonly refreshing: boolean;
      readonly error?: string;
    }
  | { readonly kind: "unavailable"; readonly error: string };

export type WeatherSearchState =
  | { readonly kind: "idle" }
  | { readonly kind: "searching" }
  | { readonly kind: "results"; readonly locations: readonly WeatherLocation[] }
  | { readonly kind: "error"; readonly message: string };
