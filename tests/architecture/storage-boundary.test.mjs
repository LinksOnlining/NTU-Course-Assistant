import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("React orchestration uses the course storage service rather than Tauri or SQL directly", () => {
  const app = source("src/App.tsx");
  assert.match(app, /services\/course-storage\.ts/);
  assert.doesNotMatch(
    app,
    /@tauri-apps|\\b(?:SELECT|INSERT|UPDATE|DELETE)\\s+(?:FROM|INTO|TABLE|DATABASE)\\b/i,
  );
});

test("only service adapters import frontend Tauri APIs", () => {
  assert.match(source("src/services/course-storage.ts"), /@tauri-apps\/api\/core/);
  assert.match(source("src/services/reminder-notification.ts"), /@tauri-apps\/api\/core/);
  assert.match(source("src/services/widget-window.ts"), /@tauri-apps\/api\/core/);
  assert.match(source("src/services/pdf-import.ts"), /@tauri-apps\/plugin-(?:dialog|fs)/);
  for (const path of [
    "src/App.tsx",
    "src/core/course-input.ts",
    "src/core/pdf-text.ts",
    "src/core/time.ts",
    "src/core/timetable-layout.ts",
  ]) {
    assert.doesNotMatch(source(path), /@tauri-apps|sqlite/i);
  }
});

test("widget window stays outside course storage and reminder scheduling", () => {
  const widgetService = source("src/services/widget-window.ts");
  const widgetUi = source("src/components/WidgetPrototype.tsx");
  const widgetCore = source("src/core/widget-view.ts");
  const rust = source("src-tauri/src/lib.rs");

  assert.match(widgetService, /invoke\("open_widget"\)/);
  assert.match(widgetService, /invoke\("hide_widget"\)/);
  assert.match(rust, /load_widget_settings/);
  assert.match(rust, /fn load_widget_data/);
  assert.match(rust, /patch_widget_settings/);
  assert.doesNotMatch(widgetService, /course-storage|sqlite|reminder/i);
  assert.doesNotMatch(
    widgetUi,
    /course-storage|sqlite|ReminderScheduler|notification|@tauri-apps/i,
  );
  assert.doesNotMatch(widgetCore, /(?:react|@tauri-apps|sqlite|\binvoke\s*\()/i);
  assert.match(rust, /get_webview_window\("widget"\)/);
  assert.match(rust, /always_on_bottom\(true\)/);
  assert.doesNotMatch(rust, /always_on_top/);
  assert.match(rust, /available_monitors\(\)/);
  const capability = source("src-tauri/capabilities/default.json");
  assert.match(capability, /"main"/);
  assert.match(capability, /"widget"/);
  assert.match(capability, /core:window:allow-start-dragging/);
  assert.equal((rust.match(/ReminderScheduler::new/g) ?? []).length, 1);
});

test("draft schedule editing remains local while the widget uses one native snapshot read", () => {
  const settings = source("src/components/PeriodSettings.tsx");
  const widget = source("src/components/WidgetPrototype.tsx");
  const widgetData = source("src/services/widget-data.ts");
  assert.doesNotMatch(settings, /course-storage|notifyWidget|refreshStoredReminderSchedule/);
  assert.match(widget, /lockedRef/);
  assert.match(widget, /\}, \[\]\);/);
  assert.match(widgetData, /invoke<WidgetData>\("load_widget_data"\)/);
  const rust = source("src-tauri/src/lib.rs");
  assert.match(rust, /let updates_lock_state = patch\.locked\.is_some\(\)/);
  assert.match(rust, /if updates_lock_state/);
  assert.doesNotMatch(rust, /database\.save_widget_settings\(&next\)/);
});

test("main and widget windows have a render failure fallback", () => {
  const main = source("src/main.tsx");
  const boundary = source("src/components/WindowErrorBoundary.tsx");
  assert.match(main, /WindowErrorBoundary/);
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /window\.location\.reload/);
});

test("tray lifecycle has one native boundary and reuses main and widget helpers", () => {
  const rust = source("src-tauri/src/lib.rs");
  assert.equal((rust.match(/TrayIconBuilder::with_id/g) ?? []).length, 1);
  assert.match(rust, /fn show_main_window/);
  assert.match(rust, /show_main_window\(app\)/);
  assert.match(rust, /TRAY_TOGGLE_WIDGET/);
  assert.match(rust, /TRAY_QUIT => app\.exit\(0\)/);
  assert.match(rust, /window\.label\(\) == "main" \|\| window\.label\(\) == "widget"/);
  assert.doesNotMatch(rust, /always_on_top|SELECT\s+.*tray|INSERT\s+.*tray/i);
});

test("NTU parsing stays pure and cannot create or persist courses", () => {
  const parser = source("src/importers/ntu-pdf/parse.ts");
  assert.match(parser, /PdfExtraction/);
  assert.match(parser, /ImportCandidate/);
  assert.doesNotMatch(
    parser,
    /(?:react|@tauri-apps|course-storage|\binsertStoredCourse\b|\bsaveStoredPeriodTimes\b|\binvoke\s*\()/i,
  );
});

test("PDF preview and proposal preparation cannot call storage adapters", () => {
  for (const path of ["src/components/PdfImportPreview.tsx", "src/core/import-proposal.ts"]) {
    const contents = source(path);
    assert.doesNotMatch(
      contents,
      /(?:@tauri-apps|course-storage|insertStoredCourse|updateStoredCourse|deleteStoredCourse|importStoredCourses|\binvoke\s*\()/i,
    );
  }
  assert.match(source("src/core/import-proposal.ts"), /validateCourseInput/);
});

test("batch PDF persistence crosses one frontend service and one Rust transaction command", () => {
  const service = source("src/services/course-storage.ts");
  const app = source("src/App.tsx");
  assert.match(service, /invoke<readonly Course\[]>\("import_courses", \{ courses \}\)/);
  assert.match(app, /importStoredCourses\(pendingImportCourses\)/);
  assert.doesNotMatch(app, /for[\s\S]{0,120}insertStoredCourse/);
});
