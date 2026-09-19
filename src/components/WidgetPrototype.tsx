import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { buildWidgetViewModel } from "../core/widget-view.ts";
import {
  DEFAULT_WIDGET_SETTINGS,
  loadWidgetData,
  loadWidgetSettings,
  patchWidgetSettings,
} from "../services/widget-data.ts";
import {
  hideWidget,
  notifyWidgetSettingsChanged,
  openMainWindow,
  startWidgetDragging,
  subscribeWidgetBounds,
  subscribeWidgetDataChanged,
  subscribeWidgetSettingsChanged,
} from "../services/widget-window.ts";
import type { Course } from "../types/course.ts";
import type { TermConfig } from "../types/reminder.ts";
import type { WidgetDisplayMode, WidgetSettings } from "../types/widget-settings.ts";

function shanghaiNow(): { readonly date: string; readonly time: string } {
  const fields = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts();
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    fields.find((part) => part.type === type)!.value;
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

export function WidgetPrototype() {
  const [settings, setSettings] = useState<WidgetSettings>(DEFAULT_WIDGET_SETTINGS);
  const [courses, setCourses] = useState<readonly Course[]>([]);
  const [termConfig, setTermConfig] = useState<TermConfig | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [settingsError, setSettingsError] = useState("");
  const [clock, setClock] = useState(shanghaiNow);
  const lockedRef = useRef(settings.locked);
  const settingsOperation = useRef(0);

  useEffect(() => {
    lockedRef.current = settings.locked;
  }, [settings.locked]);

  useEffect(() => {
    let active = true;
    const refreshData = async () => {
      const settingsRevision = settingsOperation.current;
      try {
        const data = await loadWidgetData();
        if (!active) return;
        setCourses(data.courses);
        setTermConfig(data.termConfig);
        if (settingsRevision === settingsOperation.current) setSettings(data.settings);
        setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    };
    const refreshSettings = async () => {
      const revision = ++settingsOperation.current;
      try {
        const next = await loadWidgetSettings();
        if (active && revision === settingsOperation.current) setSettings(next);
      } catch {
        if (active) setSettingsError("无法读取小组件设置，将继续显示上一份内容。");
      }
    };
    void refreshData();
    const unsubscribe = subscribeWidgetDataChanged(() => void refreshData());
    const unsubscribeSettings = subscribeWidgetSettingsChanged(() => void refreshSettings());
    const timer = window.setInterval(() => setClock(shanghaiNow()), 60_000);
    return () => {
      active = false;
      unsubscribe();
      unsubscribeSettings();
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    let active = true;
    const unsubscribe = subscribeWidgetBounds((bounds) => {
      if (!active || lockedRef.current) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!active) return;
        const operation = ++settingsOperation.current;
        void patchWidgetSettings(bounds)
          .then((saved) => {
            if (!active || operation !== settingsOperation.current) return;
            setSettings(saved);
          })
          .catch(() => {
            if (active) {
              setSettingsError("无法保存小组件位置或尺寸，下次打开将使用上次保存的位置。");
            }
          });
      }, 500);
    });
    return () => {
      active = false;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  async function updateSettings(change: Partial<WidgetSettings>) {
    const operation = ++settingsOperation.current;
    try {
      const saved = await patchWidgetSettings(change);
      if (operation !== settingsOperation.current) return;
      setSettings(saved);
      setSettingsError("");
      notifyWidgetSettingsChanged();
    } catch {
      setSettingsError("保存小组件设置失败，当前设置未应用。");
    }
  }

  async function closeWidget() {
    const operation = ++settingsOperation.current;
    try {
      const saved = await patchWidgetSettings({ enabled: false });
      if (operation !== settingsOperation.current) return;
      setSettings(saved);
      notifyWidgetSettingsChanged();
      await hideWidget();
    } catch {
      setSettingsError("关闭小组件失败，当前显示状态未改变。");
    }
  }

  function startDrag(event: MouseEvent<HTMLElement>) {
    if (
      settings.locked ||
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest("button, input, select"))
    ) {
      return;
    }
    void startWidgetDragging().catch((error: unknown) =>
      setSettingsError(error instanceof Error ? error.message : "无法移动小组件，请稍后重试。"),
    );
  }

  const view = useMemo(
    () => buildWidgetViewModel(courses, termConfig, clock),
    [clock, courses, termConfig],
  );

  return (
    <main className="widget-prototype" aria-label="桌面课程小组件">
      <header
        className={`widget-prototype__header${settings.locked ? " is-locked" : ""}`}
        onMouseDown={startDrag}
      >
        <div>
          <p className="widget-prototype__eyebrow">课程小组件</p>
          {view.kind === "ready" && (
            <strong>
              {view.weekdayLabel} · 第 {view.teachingWeek} 周
            </strong>
          )}
        </div>
        <div className="widget-prototype__controls">
          <button
            type="button"
            className="widget-prototype__open"
            onClick={() => void updateSettings({ locked: !settings.locked })}
          >
            {settings.locked ? "解锁" : "锁定"}
          </button>
          <button
            type="button"
            className="widget-prototype__open"
            onClick={() =>
              void openMainWindow().catch((error: unknown) =>
                setSettingsError(
                  error instanceof Error ? error.message : "无法打开课程表，请稍后重试。",
                ),
              )
            }
          >
            打开课程表
          </button>
          <button
            type="button"
            className="widget-prototype__open"
            onClick={() => void closeWidget()}
            aria-label="关闭小组件"
          >
            关闭
          </button>
        </div>
      </header>
      <div className="widget-prototype__tabs" role="tablist" aria-label="课程范围">
        <button
          type="button"
          role="tab"
          aria-selected={settings.displayMode === "today"}
          onClick={() => void updateSettings({ displayMode: "today" as WidgetDisplayMode })}
        >
          今日
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={settings.displayMode === "week"}
          onClick={() => void updateSettings({ displayMode: "week" as WidgetDisplayMode })}
        >
          本周
        </button>
      </div>
      {status === "loading" && <p className="widget-prototype__state">正在加载课程…</p>}
      {status === "error" && <p className="widget-prototype__state">课程加载失败</p>}
      {settingsError && (
        <p className="widget-prototype__state" role="alert">
          {settingsError}
        </p>
      )}
      {status === "ready" && view.kind === "missing-term" && (
        <p className="widget-prototype__state">请先确认学期设置</p>
      )}
      {status === "ready" && view.kind === "outside-term" && (
        <p className="widget-prototype__state">当前不在教学周</p>
      )}
      {status === "ready" && view.kind === "ready" && settings.displayMode === "today" && (
        <section className="widget-prototype__list" aria-label="今日课程">
          <p className="widget-prototype__date">{view.date}</p>
          {view.today.length === 0 ? (
            <p className="widget-prototype__state">今天没有课程</p>
          ) : (
            view.today.map((item) => (
              <article className={`widget-course widget-course--${item.state}`} key={item.key}>
                <strong>{item.name}</strong>
                <span>
                  {item.startTime}–{item.endTime}
                </span>
                {item.classroom && <small>{item.classroom}</small>}
              </article>
            ))
          )}
        </section>
      )}
      {status === "ready" && view.kind === "ready" && settings.displayMode === "week" && (
        <section className="widget-prototype__week" aria-label="本周课程">
          {view.week.map((day) => (
            <article key={day.date}>
              <strong>{day.label}</strong>
              {day.courses.length === 0 ? (
                <span>无课</span>
              ) : (
                day.courses.map((item) => (
                  <span key={item.key}>
                    {item.startTime} {item.name}
                    {item.classroom ? ` · ${item.classroom}` : ""}
                  </span>
                ))
              )}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
