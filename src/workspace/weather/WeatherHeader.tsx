import { useState } from "react";
import {
  formatTemperature,
  formatWeatherDate,
  formatWeatherTime,
  weatherCodeLabel,
} from "../../application/weather/weather.ts";
import type { WorkspaceWeatherController } from "./use-workspace-weather.ts";
import "./weather.css";

interface WeatherHeaderProps {
  readonly weather: WorkspaceWeatherController;
}

export function WeatherHeader({ weather }: WeatherHeaderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { settings, viewState } = weather;
  if (!settings.enabled || !settings.location) return null;

  const snapshot =
    viewState.kind === "ready" || viewState.kind === "stale" ? viewState.snapshot : null;
  const temperature = snapshot
    ? formatTemperature(snapshot.current.temperatureCelsius, settings.temperatureUnit)
    : "天气";
  const status = snapshot ? weatherCodeLabel(snapshot.current.weatherCode) : "查看天气";

  return (
    <div className="weather-header">
      <button
        type="button"
        className="weather-header-button"
        aria-label={`天气：${temperature}，${status}`}
        aria-expanded={isOpen}
        aria-controls="weather-popover"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span aria-hidden="true">☁</span>
        <strong>{temperature}</strong>
        <span>{status}</span>
      </button>
      {isOpen && (
        <section id="weather-popover" className="weather-popover" aria-label="天气预报">
          <div className="weather-popover-heading">
            <div>
              <h2>{settings.location.displayName}</h2>
              <p>
                {viewState.kind === "stale" ? "缓存天气 · " : "天气更新于 "}
                {snapshot ? new Date(snapshot.fetchedAt).toLocaleString("zh-CN") : "正在获取…"}
              </p>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="关闭天气详情"
              onClick={() => setIsOpen(false)}
            >
              ×
            </button>
          </div>
          {snapshot ? (
            <>
              <div className="weather-current-summary">
                <strong>
                  {formatTemperature(snapshot.current.temperatureCelsius, settings.temperatureUnit)}
                </strong>
                <span>{weatherCodeLabel(snapshot.current.weatherCode)}</span>
                {snapshot.current.apparentTemperatureCelsius !== null && (
                  <span>
                    体感{" "}
                    {formatTemperature(
                      snapshot.current.apparentTemperatureCelsius,
                      settings.temperatureUnit,
                    )}
                  </span>
                )}
              </div>
              {viewState.kind === "stale" && (
                <p className="weather-cache-notice" role="status">
                  正在显示缓存天气{viewState.error ? "；暂时无法更新" : ""}
                </p>
              )}
              <h3>未来 6 小时</h3>
              <div className="weather-hourly-list">
                {snapshot.hourly.slice(0, 6).map((item) => (
                  <div className="weather-forecast-item" key={item.time}>
                    <span>{formatWeatherTime(item.time)}</span>
                    <strong>
                      {formatTemperature(item.temperatureCelsius, settings.temperatureUnit)}
                    </strong>
                    <span>{weatherCodeLabel(item.weatherCode)}</span>
                  </div>
                ))}
              </div>
              <h3>未来 7 天</h3>
              <div className="weather-daily-list">
                {snapshot.daily.map((item) => (
                  <div className="weather-forecast-item" key={item.date}>
                    <span>{formatWeatherDate(item.date)}</span>
                    <span>{weatherCodeLabel(item.weatherCode)}</span>
                    <strong>
                      {formatTemperature(item.highCelsius, settings.temperatureUnit)} /{" "}
                      {formatTemperature(item.lowCelsius, settings.temperatureUnit)}
                    </strong>
                  </div>
                ))}
              </div>
              <p className="weather-attribution">天气数据由 Open-Meteo 提供，遵循 CC BY 4.0</p>
            </>
          ) : (
            <p
              className="weather-cache-notice"
              role={viewState.kind === "unavailable" ? "alert" : "status"}
            >
              {viewState.kind === "unavailable" ? viewState.error : "正在读取天气…"}
            </p>
          )}
          <button
            type="button"
            className="secondary-button weather-refresh-button"
            disabled={weather.isRefreshing}
            onClick={() => void weather.refresh()}
          >
            {weather.isRefreshing ? "正在更新…" : "刷新天气"}
          </button>
        </section>
      )}
    </div>
  );
}
