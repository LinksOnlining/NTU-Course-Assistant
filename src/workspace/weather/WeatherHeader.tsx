import { useEffect, useRef, useState } from "react";
import {
  formatTemperature,
  formatWeatherDate,
  formatWeatherTime,
  weatherLocationHierarchy,
  weatherLocationPrecisionLabel,
  weatherLocationSourceLabel,
  weatherCodeLabel,
} from "../../application/weather/weather.ts";
import type { WorkspaceWeatherController } from "./use-workspace-weather.ts";
import "./weather.css";

interface WeatherHeaderProps {
  readonly weather: WorkspaceWeatherController;
}

export function WeatherHeader({ weather }: WeatherHeaderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const { settings, viewState } = weather;
  useEffect(() => {
    if (!isOpen || !settings.enabled || !settings.location) return;
    popoverRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, settings.enabled, settings.location]);
  useEffect(() => {
    if (!settings.enabled || !settings.location) setIsOpen(false);
  }, [settings.enabled, settings.location]);

  if (!settings.enabled || !settings.location) return null;

  const snapshot =
    viewState.kind === "ready" || viewState.kind === "stale" ? viewState.snapshot : null;
  const temperature = snapshot
    ? formatTemperature(snapshot.current.temperatureCelsius, settings.temperatureUnit)
    : "天气";
  const status = snapshot ? weatherCodeLabel(snapshot.current.weatherCode) : "查看天气";
  const hierarchy = weatherLocationHierarchy(settings.location);

  return (
    <div className="weather-header" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="weather-header-button"
        title={settings.location.displayName}
        aria-label={`天气：${settings.location.displayName}，${temperature}，${status}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-controls="weather-popover"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span aria-hidden="true">☁</span>
        <span className="weather-header-location">{settings.location.displayName}</span>
        <strong>{temperature}</strong>
        <span className="weather-header-status">{status}</span>
      </button>
      {isOpen && (
        <section
          ref={popoverRef}
          id="weather-popover"
          className="weather-popover"
          role="dialog"
          aria-labelledby="weather-popover-title"
          tabIndex={-1}
        >
          <div className="weather-popover-heading">
            <div>
              <h2 id="weather-popover-title">{settings.location.displayName}</h2>
              {hierarchy.length > 1 && (
                <p className="weather-location-hierarchy">{hierarchy.slice(1).join(" · ")}</p>
              )}
              <p>
                {viewState.kind === "stale" ? "缓存天气 · " : "天气更新于 "}
                {snapshot ? new Date(snapshot.fetchedAt).toLocaleString("zh-CN") : "正在获取…"}
              </p>
              <p className="weather-location-source">
                {weatherLocationSourceLabel(settings.location.source)} · 精度：
                {weatherLocationPrecisionLabel(settings.location.precision)}
              </p>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="关闭天气详情"
              onClick={() => {
                setIsOpen(false);
                triggerRef.current?.focus();
              }}
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
              <p className="weather-attribution">
                天气数据由 Open-Meteo 提供（CC BY 4.0）；地名由 Photon / OpenStreetMap 解析。©
                OpenStreetMap contributors。
              </p>
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
