import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import {
  formatTemperature,
  weatherCodeLabel,
  weatherLocationHierarchy,
  weatherLocationIdentity,
  weatherLocationPrecisionLabel,
  weatherLocationSourceLabel,
} from "../../application/weather/weather.ts";
import {
  gcj02PixelForCoordinate,
  mapPixelToGcj02,
  panGcj02Map,
} from "../../core/weather-coordinate.ts";
import {
  getWeatherMapImage,
  getWeatherProviderCredentialStatus,
  removeWeatherProviderKey,
  saveWeatherProviderKey,
  type WeatherProviderCredentialStatus,
} from "../../services/weather-location-transport.ts";
import type { TemperatureUnit, WeatherCoordinateSystem } from "../../types/weather.ts";
import type { WorkspaceWeatherController } from "./use-workspace-weather.ts";
import "./weather.css";

interface WeatherSettingsPanelProps {
  readonly weather: WorkspaceWeatherController;
}

type ProviderKey = "amap" | "baidu";
type MapPoint = { readonly latitude: number; readonly longitude: number };

const MAP_WIDTH = 640;
const MAP_HEIGHT = 420;

export function WeatherSettingsPanel({ weather }: WeatherSettingsPanelProps) {
  const [query, setQuery] = useState("");
  const [adminHint, setAdminHint] = useState("");
  const [showLocationConsent, setShowLocationConsent] = useState(false);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [latitudeInput, setLatitudeInput] = useState("");
  const [longitudeInput, setLongitudeInput] = useState("");
  const [coordinateSystem, setCoordinateSystem] = useState<WeatherCoordinateSystem>("gcj02");
  const [credentialStatus, setCredentialStatus] = useState<WeatherProviderCredentialStatus | null>(
    null,
  );
  const [credentialStatusError, setCredentialStatusError] = useState("");
  const [credentialMessage, setCredentialMessage] = useState("");
  const [credentialError, setCredentialError] = useState("");
  const [credentialBusy, setCredentialBusy] = useState<ProviderKey | null>(null);
  const [keys, setKeys] = useState<Record<ProviderKey, string>>({ amap: "", baidu: "" });
  const { settings, viewState, searchState } = weather;

  useEffect(() => {
    let active = true;
    void getWeatherProviderCredentialStatus()
      .then((status) => {
        if (active) {
          setCredentialStatus(status);
          setCredentialStatusError("");
        }
      })
      .catch(() => {
        if (active) setCredentialStatusError("无法读取 Windows 凭据存储状态。");
      });
    return () => {
      active = false;
    };
  }, []);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void weather.searchLocation(query, adminHint);
  }

  function submitCoordinates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const latitude = Number(latitudeInput.trim());
    const longitude = Number(longitudeInput.trim());
    void weather.selectCoordinates(latitude, longitude, coordinateSystem, "manual");
  }

  async function refreshCredentialStatus() {
    const status = await getWeatherProviderCredentialStatus();
    setCredentialStatus(status);
    setCredentialStatusError("");
  }

  async function saveCredential(provider: ProviderKey) {
    setCredentialBusy(provider);
    setCredentialMessage("");
    setCredentialError("");
    try {
      await saveWeatherProviderKey(provider, keys[provider]);
      setKeys((current) => ({ ...current, [provider]: "" }));
      await refreshCredentialStatus();
      setCredentialMessage((provider === "amap" ? "高德" : "百度") + "地点服务密钥已安全保存。");
    } catch {
      setCredentialError("密钥未能保存到 Windows 凭据存储；请检查输入后重试。");
    } finally {
      setCredentialBusy(null);
    }
  }

  async function deleteCredential(provider: ProviderKey) {
    setCredentialBusy(provider);
    setCredentialMessage("");
    setCredentialError("");
    try {
      await removeWeatherProviderKey(provider);
      await refreshCredentialStatus();
      setCredentialMessage((provider === "amap" ? "高德" : "百度") + "地点服务密钥已删除。");
    } catch {
      setCredentialError("密钥未能从 Windows 凭据存储删除，请稍后重试。");
    } finally {
      setCredentialBusy(null);
    }
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
        天气默认关闭。搜索地点时，仅在你提交后将地点文字发送给地图服务；选择地点后只保存当前坐标与显示名称，天气按经纬度查询。不保存搜索历史或定位轨迹，也不发送课程、日记、收件箱或任务内容。
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
                  允许获取一次设备坐标。坐标会先模糊到约百米级，再转换为地图坐标供天气查询；地点服务只用于尝试识别地名。仅保存当前天气地点，不记录定位历史，也不会用于其他功能。
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
            <label htmlFor="weather-location-query">搜索地点</label>
            <div className="weather-location-search-row">
              <input
                id="weather-location-query"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="村、乡镇、街道、学校、社区或详细地址…"
                autoComplete="off"
                maxLength={160}
              />
              <button
                type="submit"
                className="secondary-button"
                disabled={query.trim().length < 2 || searchState.kind === "searching"}
              >
                {searchState.kind === "searching" ? "搜索中…" : "搜索地点"}
              </button>
            </div>
            <label htmlFor="weather-location-admin-hint">上级地区提示（可选）</label>
            <input
              id="weather-location-admin-hint"
              value={adminHint}
              onChange={(event) => setAdminHint(event.currentTarget.value)}
              placeholder="例如：江苏省徐州市丰县"
              autoComplete="off"
              maxLength={80}
            />
            <small>支持两字乡村短地名；地区提示只辅助搜索，不会限制搜索范围。</small>
          </form>
          {searchState.kind === "searching" && (
            <p role="status" className="weather-search-status">
              正在查询地点…
            </p>
          )}
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
                    <span className="weather-result-name">{location.displayName}</span>
                    <span className="weather-result-type">{location.type ?? "地点"}</span>
                    <small>
                      {location.displayAddress ||
                        weatherLocationHierarchy(location).slice(1).join(" · ")}
                      <span> · {weatherLocationPrecisionLabel(location.precision)}</span>
                    </small>
                  </button>
                ))
              ) : (
                <p role="status">没有找到合适的文字搜索结果；可在地图上选点或输入经纬度。</p>
              )}
            </div>
          )}

          <div className="weather-location-fallbacks">
            <button
              type="button"
              className="secondary-button"
              disabled={!credentialStatus?.amapConfigured}
              aria-expanded={showMapPicker}
              onClick={() => setShowMapPicker((open) => !open)}
            >
              {showMapPicker ? "收起地图选点" : "在地图上选择"}
            </button>
            {!credentialStatus?.amapConfigured && (
              <small role="status">
                {credentialStatus
                  ? "地图选点需要先配置高德 Web Service 密钥；也可以使用经纬度输入。"
                  : credentialStatusError || "正在检查地图服务配置…"}
              </small>
            )}
            <details className="weather-coordinate-entry">
              <summary>使用经纬度</summary>
              <form onSubmit={submitCoordinates}>
                <label htmlFor="weather-coordinate-latitude">纬度</label>
                <input
                  id="weather-coordinate-latitude"
                  inputMode="decimal"
                  value={latitudeInput}
                  onChange={(event) => setLatitudeInput(event.currentTarget.value)}
                  placeholder="例如：31.2304"
                  required
                />
                <label htmlFor="weather-coordinate-longitude">经度</label>
                <input
                  id="weather-coordinate-longitude"
                  inputMode="decimal"
                  value={longitudeInput}
                  onChange={(event) => setLongitudeInput(event.currentTarget.value)}
                  placeholder="例如：121.4737"
                  required
                />
                <label htmlFor="weather-coordinate-system">输入坐标类型</label>
                <select
                  id="weather-coordinate-system"
                  value={coordinateSystem}
                  onChange={(event) =>
                    setCoordinateSystem(event.currentTarget.value as WeatherCoordinateSystem)
                  }
                >
                  <option value="gcj02">高德 / 国内地图坐标（GCJ-02）</option>
                  <option value="wgs84">GPS / WGS-84 坐标</option>
                </select>
                <small>请按所选坐标类型输入；系统会在必要时转换后用于天气查询。</small>
                <button
                  className="secondary-button"
                  type="submit"
                  disabled={!latitudeInput.trim() || !longitudeInput.trim()}
                >
                  使用此坐标
                </button>
              </form>
            </details>
          </div>
          {showMapPicker && (
            <WeatherMapPicker
              initialCenter={
                settings.location
                  ? {
                      latitude: settings.location.latitude,
                      longitude: settings.location.longitude,
                    }
                  : undefined
              }
              onConfirm={(point) => {
                setShowMapPicker(false);
                void weather.selectCoordinates(point.latitude, point.longitude, "gcj02", "map");
              }}
            />
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

      <details className="weather-provider-settings">
        <summary>地点服务高级设置</summary>
        <p>
          天气预报继续使用 Open-Meteo，无需天气密钥。地点文字检索和地图底图使用独立的高德 Web
          Service 密钥，百度 Web Service 密钥仅作搜索/逆地理编码备用。密钥只保存在本机 Windows
          凭据存储；本版本不使用 QWeather。
        </p>
        <div className="weather-provider-key">
          <h4>高德 Web Service</h4>
          <p role="status">
            {credentialStatus
              ? credentialStatus.amapConfigured
                ? "已配置"
                : "未配置"
              : credentialStatusError || "正在检查凭据状态…"}
          </p>
          <div>
            <input
              type="password"
              aria-label="高德 Web Service 密钥"
              autoComplete="new-password"
              value={keys.amap}
              onChange={(event) =>
                setKeys((current) => ({ ...current, amap: event.currentTarget.value }))
              }
              placeholder="粘贴高德 Web Service Key"
            />
            <button
              type="button"
              className="secondary-button"
              disabled={!keys.amap.trim() || credentialBusy !== null}
              onClick={() => void saveCredential("amap")}
            >
              {credentialBusy === "amap" ? "保存中…" : "安全保存"}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!credentialStatus?.amapConfigured || credentialBusy !== null}
              onClick={() => void deleteCredential("amap")}
            >
              删除密钥
            </button>
          </div>
          <a href="https://lbs.amap.com/api/webservice/summary" target="_blank" rel="noreferrer">
            高德 Web 服务申请说明
          </a>
        </div>
        <div className="weather-provider-key">
          <h4>百度 Web Service（备用）</h4>
          <p role="status">
            {credentialStatus
              ? credentialStatus.baiduConfigured
                ? "已配置"
                : "未配置"
              : credentialStatusError || "正在检查凭据状态…"}
          </p>
          <div>
            <input
              type="password"
              aria-label="百度 Web Service 密钥"
              autoComplete="new-password"
              value={keys.baidu}
              onChange={(event) =>
                setKeys((current) => ({ ...current, baidu: event.currentTarget.value }))
              }
              placeholder="粘贴百度 Web Service AK"
            />
            <button
              type="button"
              className="secondary-button"
              disabled={!keys.baidu.trim() || credentialBusy !== null}
              onClick={() => void saveCredential("baidu")}
            >
              {credentialBusy === "baidu" ? "保存中…" : "安全保存"}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!credentialStatus?.baiduConfigured || credentialBusy !== null}
              onClick={() => void deleteCredential("baidu")}
            >
              删除密钥
            </button>
          </div>
          <a
            href="https://lbsyun.baidu.com/index.php?title=webapi"
            target="_blank"
            rel="noreferrer"
          >
            百度 Web 服务申请说明
          </a>
        </div>
        {(credentialMessage || credentialError || credentialStatusError) && (
          <p role={credentialError || credentialStatusError ? "alert" : "status"}>
            {credentialError || credentialStatusError || credentialMessage}
          </p>
        )}
      </details>
      {weather.storageWarning && <p role="status">{weather.storageWarning}</p>}
      <p className="weather-attribution">
        天气数据由 Open-Meteo 提供（CC BY 4.0）；地点检索与底图服务由高德提供，百度仅作为可选备用。
      </p>
    </div>
  );
}

function WeatherMapPicker({
  initialCenter,
  onConfirm,
}: {
  readonly initialCenter?: MapPoint;
  readonly onConfirm: (point: MapPoint) => void;
}) {
  const [center, setCenter] = useState<MapPoint>(initialCenter ?? { latitude: 35, longitude: 105 });
  const [picked, setPicked] = useState<MapPoint>(center);
  const [zoom, setZoom] = useState(6);
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  useEffect(() => {
    let active = true;
    let nextUrl = "";
    setLoading(true);
    setError("");
    setImageUrl("");
    void getWeatherMapImage(center.latitude, center.longitude, zoom)
      .then((image) => {
        if (!active) return;
        nextUrl = URL.createObjectURL(image);
        setImageUrl(nextUrl);
      })
      .catch(() => {
        if (active) {
          setImageUrl("");
          setError("地图暂时不可用。你仍可在上方使用经纬度输入选择位置。");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [center.latitude, center.longitude, zoom]);

  function completePointer(event: PointerEvent<HTMLButtonElement>) {
    const started = drag.current;
    if (!started || started.pointerId !== event.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    const deltaX = ((event.clientX - started.x) * MAP_WIDTH) / rect.width;
    const deltaY = ((event.clientY - started.y) * MAP_HEIGHT) / rect.height;
    setDragOffset({ x: 0, y: 0 });
    if (Math.hypot(deltaX, deltaY) < 6) {
      const pixelX = ((event.clientX - rect.left) * MAP_WIDTH) / rect.width;
      const pixelY = ((event.clientY - rect.top) * MAP_HEIGHT) / rect.height;
      setPicked(mapPixelToGcj02(center, zoom, pixelX, pixelY, MAP_WIDTH, MAP_HEIGHT));
      return;
    }
    const nextCenter = panGcj02Map(center, zoom, deltaX, deltaY);
    setCenter(nextCenter);
    setPicked(nextCenter);
  }

  const marker = gcj02PixelForCoordinate(center, picked, zoom, MAP_WIDTH, MAP_HEIGHT);

  return (
    <section className="weather-map-picker" aria-label="地图选点">
      <div className="weather-map-heading">
        <div>
          <h3>在地图上选择位置</h3>
          <p>点击地图选点；拖动地图平移，使用缩放按钮查看附近小地点。</p>
        </div>
        <div className="weather-map-zoom" aria-label="地图缩放">
          <button
            type="button"
            className="secondary-button"
            aria-label="放大地图"
            disabled={zoom >= 17 || loading}
            onClick={() => setZoom((value) => Math.min(17, value + 1))}
          >
            放大
          </button>
          <button
            type="button"
            className="secondary-button"
            aria-label="缩小地图"
            disabled={zoom <= 1 || loading}
            onClick={() => setZoom((value) => Math.max(1, value - 1))}
          >
            缩小
          </button>
        </div>
      </div>
      {loading && <p role="status">正在加载地图…</p>}
      {error && <p role="alert">{error}</p>}
      {imageUrl && (
        <button
          type="button"
          className={"weather-map-canvas" + (drag.current ? " is-dragging" : "")}
          aria-label="地图，点击选择坐标或拖动平移"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current?.pointerId !== event.pointerId) return;
            setDragOffset({
              x: event.clientX - drag.current.x,
              y: event.clientY - drag.current.y,
            });
          }}
          onPointerUp={completePointer}
          onPointerCancel={(event) => {
            drag.current = null;
            setDragOffset({ x: 0, y: 0 });
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
          onClick={(event) => {
            if (event.detail === 0) setPicked(center);
          }}
        >
          <img
            src={imageUrl}
            alt="高德地图"
            draggable={false}
            style={{ transform: "translate(" + dragOffset.x + "px, " + dragOffset.y + "px)" }}
          />
          <span
            className="weather-map-marker"
            aria-hidden="true"
            style={{
              left: (marker.x / MAP_WIDTH) * 100 + "%",
              top: (marker.y / MAP_HEIGHT) * 100 + "%",
            }}
          />
          <span className="weather-map-crosshair" aria-hidden="true" />
        </button>
      )}
      <p className="weather-map-coordinates" aria-live="polite">
        所选坐标：{picked.latitude.toFixed(6)}, {picked.longitude.toFixed(6)}（GCJ-02）
      </p>
      <p className="weather-map-attribution">地图 © 高德地图；所选坐标仅用于当前天气查询。</p>
      <button
        type="button"
        className="primary-button"
        disabled={loading || !imageUrl}
        onClick={() => onConfirm(picked)}
      >
        使用此地图位置
      </button>
    </section>
  );
}
