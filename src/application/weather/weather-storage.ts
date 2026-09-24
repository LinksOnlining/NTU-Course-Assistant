/** 向工作台呈现层公开 Weather 设置与缓存 Application 边界。 */
export {
  DEFAULT_WEATHER_SETTINGS,
  loadWeatherCache,
  loadWeatherSettings,
  removeWeatherCache,
  saveWeatherCache,
  saveWeatherSettings,
} from "../../services/weather-storage.ts";
