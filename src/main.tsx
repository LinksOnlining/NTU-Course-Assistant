import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { WindowErrorBoundary } from "./components/WindowErrorBoundary.tsx";
import { WidgetPrototype } from "./components/WidgetPrototype.tsx";
import { applyTheme, getThemePreference, resolveTheme } from "./theme/index.ts";
import { recordStartupStage } from "./startup-diagnostics.ts";
import "./theme/theme.css";
import "./styles.css";
import "./widget.css";

recordStartupStage("main-module-evaluated");
const root = document.getElementById("root");
if (!root) throw new Error("缺少应用挂载节点");
recordStartupStage("root-found");
const isWidgetWindow = new URLSearchParams(window.location.search).has("widget");
if (!isWidgetWindow) {
  recordStartupStage("theme-apply-start");
  const preference = getThemePreference();
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(resolveTheme(preference, systemTheme), document.documentElement);
  recordStartupStage("theme-applied");
}

const reactRoot = createRoot(root);
recordStartupStage("react-root-created");
reactRoot.render(
  <StrictMode>
    <WindowErrorBoundary title={isWidgetWindow ? "桌面小组件" : "课程表"}>
      {isWidgetWindow ? <WidgetPrototype /> : <App />}
    </WindowErrorBoundary>
  </StrictMode>,
);
recordStartupStage("react-render-requested");
