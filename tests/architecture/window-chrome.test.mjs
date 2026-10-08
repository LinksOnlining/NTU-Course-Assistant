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

test("main close is hidden only while a visible widget keeps the process alive", () => {
  const source = readFileSync(path.join(root, "src-tauri/src/lib.rs"), "utf8");
  const start = source.indexOf(".on_window_event(|window, event|");
  const end = source.indexOf(".run(tauri::generate_context!())", start);

  assert.notEqual(start, -1, "window close handler should exist");
  assert.notEqual(end, -1, "window close handler should end before app run");
  const handler = source.slice(start, end);
  assert.match(handler, /window\.label\(\) == "widget"/u);
  assert.match(handler, /window\.label\(\) == "main"/u);
  assert.match(handler, /get_webview_window\("widget"\)/u);
  assert.match(handler, /is_visible\(\)/u);
  assert.match(handler, /if widget_is_visible \{[\s\S]*?api\.prevent_close\(\)[\s\S]*?window\.hide\(\)/u);
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
