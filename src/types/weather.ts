export interface WeatherLocation {
  readonly displayName: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly timezone: string | null;
  /** Provider-reported parent areas; no street address or house number is kept. */
  readonly country?: string;
  readonly admin1?: string;
  readonly admin2?: string;
  readonly admin3?: string;
  readonly admin4?: string;
  readonly precision?: WeatherLocationPrecision;
  readonly source?: "manual" | "device";
}

export type WeatherLocationPrecision =
  "locality" | "district" | "city" | "region" | "coordinatesOnly" | "unknown";

export interface WeatherProvider {
  searchLocation(query: string, signal?: WeatherRequestSignal): Promise<readonly WeatherLocation[]>;
  fetchForecast(location: WeatherLocation, signal?: WeatherRequestSignal): Promise<WeatherSnapshot>;
}

export interface ReverseGeocodingProvider {
  reverseGeocode(
    latitude: number,
    longitude: number,
    signal?: WeatherRequestSignal,
  ): Promise<WeatherLocation | null>;
}

export type WorkspaceWeatherProvider = WeatherProvider & ReverseGeocodingProvider;

export type WeatherLocationRequestState =
  | { readonly kind: "idle" }
  | { readonly kind: "locating" }
  | { readonly kind: "resolving" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "notice"; readonly message: string };

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
