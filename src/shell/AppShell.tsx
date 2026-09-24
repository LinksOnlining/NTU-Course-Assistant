import { useEffect, useState, type ReactNode } from "react";
import {
  createAcademicScheduleTarget,
  createWorkspaceSearchTarget,
  getShellRouteView,
  routeForAcademicHubTab,
  routeForProductMode,
} from "../navigation/navigation.ts";
import type { AcademicRoute, ProductMode } from "../navigation/navigation.ts";
import type { AppRoute } from "../navigation/types.ts";
import {
  formatHeaderDate,
  localDateKey,
  millisecondsUntilNextLocalMidnight,
  quoteForLocalDate,
} from "./daily-quote.ts";
import "./shell.css";

interface AppShellProps {
  readonly route: AppRoute;
  readonly lastAcademicRoute: AcademicRoute | null;
  readonly onNavigate: (route: AppRoute) => void;
  readonly onOpenSettings: () => void;
  readonly settingsDisabled: boolean;
  readonly weatherSlot?: ReactNode;
  readonly contextTitle?: string;
  readonly contextActions?: ReactNode;
  readonly children: ReactNode;
}

const ACADEMIC_LINKS = [
  { label: "周课表", route: createAcademicScheduleTarget().route },
  { label: "课程变化", route: routeForAcademicHubTab("changes") },
  { label: "考试", route: routeForAcademicHubTab("exams") },
  { label: "学期管理", route: routeForAcademicHubTab("semesters") },
  // 临时保留现有 AcademicTask 界面；统一工作台任务完成后移除此入口。
  { label: "学业事项", route: routeForAcademicHubTab("tasks") },
] as const;

function ShellHeader({
  route,
  lastAcademicRoute,
  onNavigate,
  onOpenSettings,
  settingsDisabled,
  weatherSlot,
}: Omit<AppShellProps, "children" | "contextTitle" | "contextActions">) {
  const [today, setToday] = useState(() => new Date());
  const quote = quoteForLocalDate(today);
  const activeMode: ProductMode | null =
    route.area === "workspace" ? "workspace" : route.area === "academic" ? "academic" : null;

  useEffect(() => {
    let timer = 0;
    const scheduleNextDay = () => {
      timer = window.setTimeout(() => {
        const now = new Date();
        setToday(now);
        scheduleNextDay();
      }, millisecondsUntilNextLocalMidnight(new Date()));
    };
    scheduleNextDay();
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <header className="shell-header">
      <div className="shell-brand">
        <h1>Links Workplace</h1>
        <p className="shell-daily-quote" title={`${quote.author} · ${quote.source}`}>
          <span aria-hidden="true">“</span>
          {quote.text}
          <span aria-hidden="true">”</span>
          <span className="shell-quote-author">· {quote.author}</span>
        </p>
      </div>
      <div className="shell-header-actions">
        <time className="shell-date" dateTime={localDateKey(today)}>
          {formatHeaderDate(today)}
        </time>
        {weatherSlot ? <div className="shell-weather-slot">{weatherSlot}</div> : null}
        <nav className="shell-mode-switch" aria-label="产品模式">
          {(
            [
              ["workspace", "工作台"],
              ["academic", "课表"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-current={activeMode === mode ? "page" : undefined}
              onClick={() => onNavigate(routeForProductMode(mode, lastAcademicRoute))}
            >
              {label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="shell-search-button"
          aria-label="搜索本机内容"
          title="搜索本机内容"
          onClick={() => onNavigate(createWorkspaceSearchTarget().route)}
        >
          搜索
        </button>
        <button
          type="button"
          className="shell-settings-button"
          aria-label="设置"
          title="设置"
          disabled={settingsDisabled}
          onClick={onOpenSettings}
        >
          设置
        </button>
      </div>
    </header>
  );
}

export function AppShell({
  route,
  lastAcademicRoute,
  onNavigate,
  onOpenSettings,
  settingsDisabled,
  weatherSlot,
  contextTitle,
  contextActions,
  children,
}: AppShellProps) {
  const routeView = getShellRouteView(route);
  return (
    <div className="app-shell">
      <ShellHeader
        route={route}
        lastAcademicRoute={lastAcademicRoute}
        onNavigate={onNavigate}
        onOpenSettings={onOpenSettings}
        settingsDisabled={settingsDisabled}
        weatherSlot={weatherSlot}
      />
      {route.area === "academic" && (
        <section className="academic-context-bar" aria-label="课表页面导航">
          <div className="academic-context-heading">
            <h2>{contextTitle}</h2>
            {routeView === "academic-schedule" && contextActions}
          </div>
          <nav className="academic-subnav" aria-label="课表二级导航">
            {ACADEMIC_LINKS.map(({ label, route: target }) => (
              <button
                key={label}
                type="button"
                aria-current={
                  route.area === "academic" && route.page === target.page ? "page" : undefined
                }
                onClick={() => onNavigate(target)}
              >
                {label}
              </button>
            ))}
          </nav>
        </section>
      )}
      <main className="app-shell-content">{children}</main>
    </div>
  );
}
