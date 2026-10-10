import { useEffect, useState, type ReactNode } from "react";
import { getShellRouteView, routeForProductMode } from "../navigation/navigation.ts";
import type { AcademicRoute, ProductMode } from "../navigation/navigation.ts";
import type { AppRoute } from "../navigation/types.ts";
import { workplaceModuleRegistry } from "../modules/registry.ts";
import {
  formatHeaderDate,
  localDateKey,
  millisecondsUntilNextLocalMidnight,
} from "./daily-quote.ts";
import { displayQuoteForLocalDate, DAILY_QUOTE_UPDATED_EVENT } from "./daily-quote-override.ts";
import "./shell.css";

interface AppShellProps {
  readonly route: AppRoute;
  readonly workplaceTitle: string;
  readonly lastAcademicRoute: AcademicRoute | null;
  readonly onNavigate: (route: AppRoute) => void;
  readonly onOpenSettings: () => void;
  readonly settingsDisabled: boolean;
  readonly weatherSlot?: ReactNode;
  readonly contextTitle?: string;
  readonly contextActions?: ReactNode;
  readonly children: ReactNode;
}

const PRODUCT_MODES = workplaceModuleRegistry.navigation.filter(
  (entry) => entry.placement === "product-mode" && isNavigationAvailable(entry),
);
const HEADER_ACTIONS = workplaceModuleRegistry.navigation.filter(
  (entry) => entry.placement === "header-action" && isNavigationAvailable(entry),
);
const ACADEMIC_LINKS = workplaceModuleRegistry.navigation.filter(
  (entry) => entry.placement === "academic-subnav" && isNavigationAvailable(entry),
);

function isNavigationAvailable(entry: (typeof workplaceModuleRegistry.navigation)[number]) {
  const state = workplaceModuleRegistry.getModuleState(entry.moduleId);
  return entry.available && state?.available && state.enabled;
}

function ShellHeader({
  route,
  workplaceTitle,
  lastAcademicRoute,
  onNavigate,
  onOpenSettings,
  settingsDisabled,
  weatherSlot,
}: Omit<AppShellProps, "children" | "contextTitle" | "contextActions">) {
  const [today, setToday] = useState(() => new Date());
  const [, refreshQuote] = useState(0);
  const quote = displayQuoteForLocalDate(today);
  useEffect(() => {
    const refresh = () => refreshQuote((value) => value + 1);
    window.addEventListener(DAILY_QUOTE_UPDATED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(DAILY_QUOTE_UPDATED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
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
        <h1 title={workplaceTitle}>{workplaceTitle}</h1>
        <p className="shell-daily-quote" title={`${quote.author} · ${quote.source}`}>
          <span aria-hidden="true">“</span>
          {quote.text}
          <span aria-hidden="true">”</span>
          <span className="shell-quote-author">· {quote.author}</span>
        </p>
      </div>
      <div className="shell-drag-region" data-tauri-drag-region="" aria-hidden="true" />
      <div className="shell-header-actions">
        <time className="shell-date" dateTime={localDateKey(today)}>
          {formatHeaderDate(today)}
        </time>
        {weatherSlot ? <div className="shell-weather-slot">{weatherSlot}</div> : null}
        <nav className="shell-mode-switch" aria-label="产品模式">
          {PRODUCT_MODES.map(({ id, label, route, productMode }) => (
            <button
              key={id}
              type="button"
              aria-current={activeMode === productMode ? "page" : undefined}
              onClick={() =>
                onNavigate(
                  productMode === "academic"
                    ? routeForProductMode("academic", lastAcademicRoute)
                    : route,
                )
              }
            >
              {label}
            </button>
          ))}
        </nav>
        {HEADER_ACTIONS.map(({ id, label, accessibilityLabel, route, action }) => (
          <button
            key={id}
            type="button"
            className={action === "open-settings" ? "shell-settings-button" : "shell-search-button"}
            aria-label={accessibilityLabel ?? label}
            title={label}
            disabled={action === "open-settings" && settingsDisabled}
            onClick={() => (action === "open-settings" ? onOpenSettings() : onNavigate(route))}
          >
            {label}
          </button>
        ))}
      </div>
    </header>
  );
}

export function AppShell({
  route,
  workplaceTitle,
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
        workplaceTitle={workplaceTitle}
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
            {ACADEMIC_LINKS.map(({ id, label, route: target }) => (
              <button
                key={id}
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
