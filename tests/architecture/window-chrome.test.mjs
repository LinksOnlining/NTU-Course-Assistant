import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { test } from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("main Tauri window is frameless and starts maximized, not fullscreen", () => {
  const config = JSON.parse(readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const main = config.app.windows[0];

  assert.ok(main, "main window must be configured");
  assert.equal(main.decorations, false);
  assert.equal(main.maximized, true);
  assert.notEqual(main.fullscreen, true);
});

test("main close preserves its WebView when the widget is enabled and exists", () => {
  const source = readFileSync(path.join(root, "src-tauri/src/lib.rs"), "utf8");
  const start = source.indexOf(".on_window_event(|window, event|");
  const end = source.indexOf(".run(tauri::generate_context!())", start);

  assert.notEqual(start, -1, "window close handler should exist");
  assert.notEqual(end, -1, "window close handler should end before app run");
  const handler = source.slice(start, end);
  assert.match(handler, /window\.label\(\) == "widget"/u);
  assert.match(handler, /window\.label\(\) == "main"/u);
  assert.match(handler, /state::<WidgetLifecycleState>\(\)\.is_enabled\(\)/u);
  assert.match(handler, /get_webview_window\("widget"\)\.is_some\(\)/u);
  assert.match(
    handler,
    /if should_preserve_main_window\(widget_enabled, widget_exists\) \{[\s\S]*?api\.prevent_close\(\)[\s\S]*?window\.hide\(\)/u,
  );
  assert.match(handler, /else \{[\s\S]*?app\.exit\(0\)/u);
  assert.match(source, /widget_enabled && widget_exists/u);
});

test("disabling the last visible widget ends the otherwise hidden process", () => {
  const source = readFileSync(path.join(root, "src-tauri/src/lib.rs"), "utf8");
  const start = source.indexOf("fn hide_widget(");
  const end = source.indexOf("#[tauri::command]", start);
  const hide = source.slice(start, end);

  assert.match(hide, /WidgetLifecycleState/u);
  assert.match(hide, /main\.is_visible\(\)/u);
  assert.match(hide, /should_exit_after_hiding_widget\(widget_enabled, main_visible\)/u);
  assert.match(hide, /app\.exit\(0\)/u);
  assert.match(source, /!widget_enabled && !main_visible/u);
});

test("a missing main window still has a configured recreation fallback", () => {
  const source = readFileSync(path.join(root, "src-tauri/src/lib.rs"), "utf8");
  const start = source.indexOf("fn show_main_window(");
  const end = source.indexOf("#[tauri::command]", start);
  const restore = source.slice(start, end);

  assert.match(restore, /\.config\(\)/u);
  assert.match(restore, /\.windows/u);
  assert.match(restore, /\.first\(\)/u);
  assert.match(restore, /WebviewWindowBuilder::from_config\(app, config\)/u);
  assert.match(restore, /\.build\(\)/u);
  assert.match(restore, /\.unminimize\(\)[\s\S]*?\.show\(\)[\s\S]*?\.set_focus\(\)/u);
});
