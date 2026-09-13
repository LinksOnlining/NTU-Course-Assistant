# Phase 7.3 Verification

## Scope

Phase 7.3 turns the existing course widget into an opt-in, persisted desktop feature. It does not add a table, migration, tray process, scheduler, notification flow, multi-monitor matrix, or DPI compatibility matrix.

## Widget settings

`WidgetSettings` is stored as the `widget_settings` JSON value in the existing `app_settings` table. Its defaults are `enabled=false`, `displayMode=today`, `locked=false`, and null position/size. The database schema remains `user_version = 4`.

The Rust boundary validates display mode, paired coordinates, paired dimensions, a 280×220 minimum, and a 1200×1200 maximum. Malformed persisted JSON falls back safely to defaults without deleting the original value. Saving widget settings does not alter term configuration or reminder settings.

## Window behavior

- Saving enabled opens or shows the one `widget` window; saving disabled hides it.
- Application startup reads the setting and restores only an enabled widget with `focused(false)`.
- Today/Week and locked state persist through the same settings path.
- The widget uses the Tauri drag region only while unlocked; Rust applies `set_resizable(!locked)` to an existing window and the builder applies it on restoration.
- Native move/resize events are combined and persisted with a 500 ms debounce. A failed geometry write keeps the current window usable and presents an error instead of changing persisted state.
- Explicit “关闭” in the widget first saves `enabled=false`, then hides it. The system close button continues to hide without changing enabled state.
- Both windows exchange a no-payload `widget-settings-changed` event and reload their own settings. Reloading does not write or re-emit.

## Verification

- Targeted typecheck, architecture tests, lint, three Rust widget-settings tests, and the 18 widget UI scenarios passed during implementation.
- Final `npm run verify` passed: 107 unit tests, 43 architecture tests, and 333 UI scenarios (318 passed; 15 environment-gated skips), plus typecheck, lint, Prettier, and build.
- Final Rust checks passed: 31 tests, `cargo fmt -- --check`, and `cargo clippy --all-targets -- -D warnings`. The MSVC linker informational warning remains non-blocking.
- `npm run tauri dev` compiled and launched the independent Windows window titled “大学课程表”; the local database opened at schema 4.

## Boundary

Widget settings do not create Courses, modify PeriodTime/TermConfig/ReminderSettings, restart the reminder scheduler, clear handled reminders, or send notifications. Phase 7.4 compatibility and final acceptance remain pending user confirmation.
