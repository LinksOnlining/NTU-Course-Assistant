import { useState, type FormEvent } from "react";
import {
  formatTemperature,
  weatherCodeLabel,
  weatherLocationHierarchy,
  weatherLocationIdentity,
  weatherLocationPrecisionLabel,
  weatherLocationSourceLabel,
} from "../../application/weather/weather.ts";
import type { TemperatureUnit } from "../../types/weather.ts";
import type { WorkspaceWeatherController } from "./use-workspace-weather.ts";
import "./weather.css";

interface WeatherSettingsPanelProps {
  readonly weather: WorkspaceWeatherController;
}

export function WeatherSettingsPanel({ weather }: WeatherSettingsPanelProps) {
  const [query, setQuery] = useState("");
  const [showLocationConsent, setShowLocationConsent] = useState(false);
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
          onChange={(event) => {
            if (!event.currentTarget.checked) setShowLocationConsent(false);
            weather.setEnabled(event.currentTarget.checked);
          }}
        />
        <span>启用天气</span>
      </label>
      <p className="settings-domain-note">
        天气默认关闭。手动搜索时，搜索文字会发送给 Photon；仅在 Photon 暂不可用时才会请求
        Nominatim。选择地点后，所选坐标会发送给 Open-Meteo 查询天气。使用当前位置前会先征求同意，
        隐私模糊后的坐标会发送给地点服务解析地名。仅保存当前选择，不保存搜索历史或门牌号，
        也不发送课程或个人内容。
      </p>
      {settings.enabled && (
        <>
          <div className="weather-current-location-action">
            <button
              type="button"
              className="secondary-button"
              disabled={
                weather.locationRequestState.kind === "locating" ||
                weather.locationRequestState.kind === "resolving" ||
                weather.locationRequestState.kind === "fetching"
              }
              aria-expanded={showLocationConsent}
              aria-controls="weather-location-consent"
              onClick={() => setShowLocationConsent((show) => !show)}
            >
              {weather.locationRequestState.kind === "locating"
                ? "正在获取位置…"
                : weather.locationRequestState.kind === "resolving"
                  ? "正在识别地区…"
                  : weather.locationRequestState.kind === "fetching"
                    ? "正在获取天气…"
                    : "使用当前位置"}
            </button>
            {showLocationConsent && (
              <section
                id="weather-location-consent"
                className="weather-location-consent"
                aria-label="当前位置使用说明"
              >
                <p>
                  允许获取一次设备坐标。模糊后的坐标会发送给 Open-Meteo 查询天气，并发送给 Photon /
                  OpenStreetMap（必要时使用 Nominatim）识别行政区名称；只保存当前天气地点，
                  不保存定位历史，也不会用于其他功能。
                </p>
                <div>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      setShowLocationConsent(false);
                      void weather.useCurrentLocation();
                    }}
                  >
                    同意并定位
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setShowLocationConsent(false)}
                  >
                    取消
                  </button>
                </div>
              </section>
            )}
            {weather.locationRequestState.kind === "error" && (
              <p role="alert">{weather.locationRequestState.message}</p>
            )}
            {weather.locationRequestState.kind === "notice" && (
              <p role="status">{weather.locationRequestState.message}</p>
            )}
          </div>
          <form className="weather-location-search" onSubmit={submitSearch}>
            <label htmlFor="weather-location-query">搜索城市、区县、街道或地点</label>
            <div>
              <input
                id="weather-location-query"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="例如：崇川区 / 文峰街道 / 南通大学"
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
                    key={weatherLocationIdentity(location)}
                    aria-pressed={
                      settings.location
                        ? weatherLocationIdentity(settings.location) ===
                          weatherLocationIdentity(location)
                        : false
                    }
                    onClick={() => weather.selectLocation(location)}
                  >
                    <span>{location.displayName}</span>
                    <small>
                      {weatherLocationHierarchy(location).slice(1).join(" · ")}
                      {weatherLocationHierarchy(location).length > 1 ? " · " : ""}精度：
                      {weatherLocationPrecisionLabel(location.precision)}
                    </small>
                  </button>
                ))
              ) : (
                <p>没有找到匹配地点。</p>
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
              <p>{weatherLocationHierarchy(settings.location).join(" · ")}</p>
              <p>
                {weatherLocationSourceLabel(settings.location.source)} · 精度：
                {weatherLocationPrecisionLabel(settings.location.precision)}
              </p>
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
      <p className="weather-attribution">
        天气数据由 Open-Meteo 提供（CC BY 4.0）；地点由 Photon 解析，必要时使用 Nominatim。 地图数据
        © OpenStreetMap contributors。
      </p>
    </div>
  );
}
