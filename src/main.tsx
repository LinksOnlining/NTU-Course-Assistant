import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { WindowErrorBoundary } from "./components/WindowErrorBoundary.tsx";
import { WidgetPrototype } from "./components/WidgetPrototype.tsx";
import "./styles.css";
import "./widget.css";

const root = document.getElementById("root");
if (!root) throw new Error("缺少应用挂载节点");
const isWidgetWindow = new URLSearchParams(window.location.search).has("widget");

createRoot(root).render(
  <StrictMode>
    <WindowErrorBoundary title={isWidgetWindow ? "桌面小组件" : "课程表"}>
      {isWidgetWindow ? <WidgetPrototype /> : <App />}
    </WindowErrorBoundary>
  </StrictMode>,
);
