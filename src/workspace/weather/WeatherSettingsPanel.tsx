import { useState, type FormEvent } from "react";
import { formatTemperature, weatherCodeLabel } from "../../application/weather/weather.ts";
import type { TemperatureUnit } from "../../types/weather.ts";
import type { WorkspaceWeatherController } from "./use-workspace-weather.ts";
import "./weather.css";

interface WeatherSettingsPanelProps {
  readonly weather: WorkspaceWeatherController;
}

export function WeatherSettingsPanel({ weather }: WeatherSettingsPanelProps) {
  const [query, setQuery] = useState("");
  const { settings, viewState, searchState } = weather;

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void weather.searchLocation(query);
  }

  const snapshot =
    viewState.kind === "ready" || viewState.kind === "stale" ? viewState.snapshot : null;

  return (
    <div className="weather-settings" data-testid="weather-settings">
      <label className="weather-settings-toggle">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) => weather.setEnabled(event.currentTarget.checked)}
        />
        <span>启用天气</span>
      </label>
      <p className="settings-domain-note">
        天气默认关闭；只有启用并主动搜索、选择城市后才会连接天气服务。不会读取设备定位，也不会发送课程或个人内容。
      </p>
      {settings.enabled && (
        <>
          <form className="weather-location-search" onSubmit={submitSearch}>
            <label htmlFor="weather-location-query">城市或地区</label>
            <div>
              <input
                id="weather-location-query"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="例如：南通"
                autoComplete="off"
              />
              <button
                type="submit"
                className="secondary-button"
                disabled={!query.trim() || searchState.kind === "searching"}
              >
                {searchState.kind === "searching" ? "搜索中…" : "搜索地点"}
              </button>
            </div>
          </form>
          {searchState.kind === "error" && <p role="alert">{searchState.message}</p>}
          {searchState.kind === "results" && (
            <div className="weather-location-results" aria-label="地点搜索结果">
              {searchState.locations.length > 0 ? (
                searchState.locations.map((location) => (
                  <button
                    type="button"
                    key={`${location.latitude}-${location.longitude}-${location.displayName}`}
                    aria-pressed={settings.location?.displayName === location.displayName}
                    onClick={() => weather.selectLocation(location)}
                  >
                    <span>{location.displayName}</span>
                    <small>
                      {location.latitude.toFixed(2)}, {location.longitude.toFixed(2)}
                    </small>
                  </button>
                ))
              ) : (
                <p>没有找到地点，请尝试更具体的城市名称。</p>
              )}
            </div>
          )}
          <label className="weather-unit-setting" htmlFor="weather-temperature-unit">
            温度单位
          </label>
          <select
            id="weather-temperature-unit"
            value={settings.temperatureUnit}
            onChange={(event) =>
              weather.setTemperatureUnit(event.currentTarget.value as TemperatureUnit)
            }
          >
            <option value="celsius">摄氏度（℃）</option>
            <option value="fahrenheit">华氏度（℉）</option>
          </select>
          {settings.location && (
            <section className="weather-current-settings" aria-label="当前天气设置">
              <h4>当前地点：{settings.location.displayName}</h4>
              {snapshot && (
                <p>
                  {formatTemperature(snapshot.current.temperatureCelsius, settings.temperatureUnit)}{" "}
                  · {weatherCodeLabel(snapshot.current.weatherCode)}
                  {viewState.kind === "stale" ? " · 缓存数据" : ""}
                </p>
              )}
              {viewState.kind === "unavailable" && <p role="alert">{viewState.error}</p>}
              <button
                type="button"
                className="secondary-button"
                disabled={weather.isRefreshing}
                onClick={() => void weather.refresh()}
              >
                {weather.isRefreshing ? "正在更新…" : "手动刷新天气"}
              </button>
            </section>
          )}
        </>
      )}
      {weather.storageWarning && <p role="status">{weather.storageWarning}</p>}
      <p className="weather-attribution">天气数据由 Open-Meteo 提供，遵循 CC BY 4.0。</p>
    </div>
  );
}
