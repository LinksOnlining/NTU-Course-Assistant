import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { WidgetPrototype } from "./components/WidgetPrototype.tsx";
import "./styles.css";
import "./widget.css";

const root = document.getElementById("root");
if (!root) throw new Error("缺少应用挂载节点");
const isWidgetWindow = new URLSearchParams(window.location.search).has("widget");

createRoot(root).render(<StrictMode>{isWidgetWindow ? <WidgetPrototype /> : <App />}</StrictMode>);
