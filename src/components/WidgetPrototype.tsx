import { useEffect, useMemo, useState } from "react";
import { buildWidgetViewModel } from "../core/widget-view.ts";
import { loadWidgetData } from "../services/widget-data.ts";
import { openMainWindow, subscribeWidgetDataChanged } from "../services/widget-window.ts";
import type { Course } from "../types/course.ts";
import type { TermConfig } from "../types/reminder.ts";

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
  const [mode, setMode] = useState<"today" | "week">("today");
  const [courses, setCourses] = useState<readonly Course[]>([]);
  const [termConfig, setTermConfig] = useState<TermConfig | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [clock, setClock] = useState(shanghaiNow);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const data = await loadWidgetData();
        if (!active) return;
        setCourses(data.courses);
        setTermConfig(data.termConfig);
        setStatus("ready");
      } catch {
        if (active) setStatus("error");
      }
    };
    void refresh();
    const unsubscribe = subscribeWidgetDataChanged(() => void refresh());
    const timer = window.setInterval(() => setClock(shanghaiNow()), 60_000);
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, []);

  const view = useMemo(
    () => buildWidgetViewModel(courses, termConfig, clock),
    [clock, courses, termConfig],
  );

  return (
    <main className="widget-prototype" aria-label="桌面课程小组件原型">
      <header className="widget-prototype__header">
        <div>
          <p className="widget-prototype__eyebrow">课程小组件</p>
          {view.kind === "ready" && (
            <strong>
              {view.weekdayLabel} · 第 {view.teachingWeek} 周
            </strong>
          )}
        </div>
        <button
          type="button"
          className="widget-prototype__open"
          onClick={() => void openMainWindow()}
        >
          打开课程表
        </button>
      </header>
      <div className="widget-prototype__tabs" role="tablist" aria-label="课程范围">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "today"}
          onClick={() => setMode("today")}
        >
          今日
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "week"}
          onClick={() => setMode("week")}
        >
          本周
        </button>
      </div>
      {status === "loading" && <p className="widget-prototype__state">正在加载课程…</p>}
      {status === "error" && <p className="widget-prototype__state">课程加载失败</p>}
      {status === "ready" && view.kind === "missing-term" && (
        <p className="widget-prototype__state">请先确认学期设置</p>
      )}
      {status === "ready" && view.kind === "outside-term" && (
        <p className="widget-prototype__state">当前不在教学周</p>
      )}
      {status === "ready" && view.kind === "ready" && mode === "today" && (
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
      {status === "ready" && view.kind === "ready" && mode === "week" && (
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
