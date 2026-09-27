import type { WeatherCoordinateSystem, WeatherLocation } from "../types/weather.ts";

const PI = Math.PI;
const EARTH_RADIUS = 6_378_245;
const ECCENTRICITY_SQUARED = 0.006693421622965943;
const MIN_CHINA_LONGITUDE = 72.004;
const MAX_CHINA_LONGITUDE = 137.8347;
const MIN_CHINA_LATITUDE = 0.8293;
const MAX_CHINA_LATITUDE = 55.8271;
const MAX_MERCATOR_LATITUDE = 85.05112878;

export interface WeatherCoordinate {
  readonly latitude: number;
  readonly longitude: number;
  readonly coordinateSystem: WeatherCoordinateSystem;
}

function inMainlandChina(latitude: number, longitude: number): boolean {
  return (
    longitude >= MIN_CHINA_LONGITUDE &&
    longitude <= MAX_CHINA_LONGITUDE &&
    latitude >= MIN_CHINA_LATITUDE &&
    latitude <= MAX_CHINA_LATITUDE
  );
}

function transformLatitude(x: number, y: number): number {
  let value = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  value += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  value += ((20 * Math.sin(y * PI) + 40 * Math.sin((y / 3) * PI)) * 2) / 3;
  value += ((160 * Math.sin((y / 12) * PI) + 320 * Math.sin((y * PI) / 30)) * 2) / 3;
  return value;
}

function transformLongitude(x: number, y: number): number {
  let value = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  value += ((20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2) / 3;
  value += ((20 * Math.sin(x * PI) + 40 * Math.sin((x / 3) * PI)) * 2) / 3;
  value += ((150 * Math.sin((x / 12) * PI) + 300 * Math.sin((x / 30) * PI)) * 2) / 3;
  return value;
}

export function wgs84ToGcj02(latitude: number, longitude: number): WeatherCoordinate {
  if (!inMainlandChina(latitude, longitude)) {
    return { latitude, longitude, coordinateSystem: "wgs84" };
  }
  const x = longitude - 105;
  const y = latitude - 35;
  const latitudeDelta = transformLatitude(x, y);
  const longitudeDelta = transformLongitude(x, y);
  const radians = (latitude / 180) * PI;
  const magic = 1 - ECCENTRICITY_SQUARED * Math.sin(radians) ** 2;
  const sqrtMagic = Math.sqrt(magic);
  const adjustedLatitude =
    (latitudeDelta * 180) /
    (((EARTH_RADIUS * (1 - ECCENTRICITY_SQUARED)) / (magic * sqrtMagic)) * PI);
  const adjustedLongitude =
    (longitudeDelta * 180) / ((EARTH_RADIUS / sqrtMagic) * Math.cos(radians) * PI);
  return {
    latitude: latitude + adjustedLatitude,
    longitude: longitude + adjustedLongitude,
    coordinateSystem: "gcj02",
  };
}

export function gcj02ToWgs84(latitude: number, longitude: number): WeatherCoordinate {
  if (!inMainlandChina(latitude, longitude)) {
    return { latitude, longitude, coordinateSystem: "wgs84" };
  }
  let estimatedLatitude = latitude;
  let estimatedLongitude = longitude;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const projected = wgs84ToGcj02(estimatedLatitude, estimatedLongitude);
    if (projected.coordinateSystem !== "gcj02") break;
    const latitudeError = latitude - projected.latitude;
    const longitudeError = longitude - projected.longitude;
    estimatedLatitude += latitudeError;
    estimatedLongitude += longitudeError;
    if (Math.max(Math.abs(latitudeError), Math.abs(longitudeError)) < 1e-8) break;
  }
  return {
    latitude: estimatedLatitude,
    longitude: estimatedLongitude,
    coordinateSystem: "wgs84",
  };
}

export function normalizeWeatherCoordinate(
  latitude: number,
  longitude: number,
  inputSystem: WeatherCoordinateSystem,
): WeatherCoordinate {
  if (inputSystem === "gcj02") {
    return { latitude, longitude, coordinateSystem: "gcj02" };
  }
  return wgs84ToGcj02(latitude, longitude);
}

export function openMeteoCoordinates(location: WeatherLocation): WeatherCoordinate {
  return location.coordinateSystem === "gcj02"
    ? gcj02ToWgs84(location.latitude, location.longitude)
    : { latitude: location.latitude, longitude: location.longitude, coordinateSystem: "wgs84" };
}

function worldPixel(latitude: number, longitude: number, zoom: number) {
  const size = 256 * 2 ** zoom;
  const boundedLatitude = Math.max(
    -MAX_MERCATOR_LATITUDE,
    Math.min(MAX_MERCATOR_LATITUDE, latitude),
  );
  const sin = Math.sin((boundedLatitude * PI) / 180);
  return {
    size,
    x: ((longitude + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * PI)) * size,
  };
}

function coordinateFromWorldPixel(x: number, y: number, zoom: number): WeatherCoordinate {
  const size = 256 * 2 ** zoom;
  const longitude = (x / size) * 360 - 180;
  const n = PI - (2 * PI * y) / size;
  const latitude = (180 / PI) * Math.atan(Math.sinh(n));
  return { latitude, longitude, coordinateSystem: "gcj02" };
}

export function mapPixelToGcj02(
  center: Pick<WeatherCoordinate, "latitude" | "longitude">,
  zoom: number,
  pixelX: number,
  pixelY: number,
  width: number,
  height: number,
): WeatherCoordinate {
  const projected = worldPixel(center.latitude, center.longitude, zoom);
  return coordinateFromWorldPixel(
    projected.x + pixelX - width / 2,
    projected.y + pixelY - height / 2,
    zoom,
  );
}

export function panGcj02Map(
  center: Pick<WeatherCoordinate, "latitude" | "longitude">,
  zoom: number,
  deltaX: number,
  deltaY: number,
): WeatherCoordinate {
  const projected = worldPixel(center.latitude, center.longitude, zoom);
  return coordinateFromWorldPixel(projected.x - deltaX, projected.y - deltaY, zoom);
}

export function gcj02PixelForCoordinate(
  center: Pick<WeatherCoordinate, "latitude" | "longitude">,
  target: Pick<WeatherCoordinate, "latitude" | "longitude">,
  zoom: number,
  width: number,
  height: number,
): { readonly x: number; readonly y: number } {
  const centerPixel = worldPixel(center.latitude, center.longitude, zoom);
  const targetPixel = worldPixel(target.latitude, target.longitude, zoom);
  return {
    x: targetPixel.x - centerPixel.x + width / 2,
    y: targetPixel.y - centerPixel.y + height / 2,
  };
}
