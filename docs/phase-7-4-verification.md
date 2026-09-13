# Phase 7.4 Verification

## Implemented compatibility correction

Widget geometry is saved and restored in physical pixels only: the frontend reports Tauri `PhysicalPosition` and `PhysicalSize`, while Rust restores with `set_position(PhysicalPosition)` and `set_size(PhysicalSize)`. This avoids mixing physical saved geometry with the builder's logical-pixel constructor.

At restore, Rust reads the current monitor work areas. If the saved widget rectangle intersects any available work area, it is retained. If it is completely outside every available work area, it returns to the primary work area at a 40px offset. No monitor identity, EDID, WorkerW, Explorer API, always-on-top path, or additional window process is introduced.

## Automated and installed checks

- Geometry tests retain a valid second-monitor position and return an unavailable-screen position to the primary work area.
- Architecture coverage confirms `always_on_bottom(true)`, monitor enumeration, no `always_on_top`, one scheduler construction, and no direct widget SQL.
- Final `npm run verify` passed: 107 unit tests, 43 architecture tests, and 333 UI scenarios (318 passed; 15 environment-gated skips).
- Final Rust checks passed: 33 tests, `cargo fmt -- --check`, and `cargo clippy --all-targets -- -D warnings`.
- A current NSIS package was built (4.52 MB), silently installed, and its installed `ntu-course-assistant.exe` opened the independent window titled “大学课程表”. The test installation and process were then removed.
- `npm run tauri dev` also started the independent development window and opened the local schema-4 database.

## Windows manual acceptance

The user completed acceptance in the independent Windows application and accepted Phase 7.4 as PASS.

- Widget display, Today/Week content, no taskbar entry, no system title bar, and no abnormal blank or flashing: PASS.
- Normal and maximized application windows cover the Widget: PASS.
- Win+D returns to the desktop with the Widget hidden; when application windows return, they again cover the Widget. This is the observed `always_on_bottom` behavior and is accepted for V1.
- Alt+Tab does not list the Widget: PASS. Creating/restoring Widget does not take focus; clicking it permits normal interaction: PASS.
- Drag, resize, lock, and Widget settings/restart restoration: PASS. The initially found drag and “打开课程表” restore paths were corrected before final acceptance: Widget now explicitly invokes the native drag API from its free header area, and opening the main window restores it from a minimized state before focus.
- The user accepted the completed manual phase gate, including single-instance behavior.

Real dual-monitor removal and Windows DPI switching were not separately reported. They remain documented limitations rather than fabricated hardware PASS results; the physical-geometry and unavailable-monitor fallback checks listed above remain the automated coverage for those environments.

## Save-pending regression repair

The reported permanent “保存中…” state was traced in a real Tauri development window. Both `save_widget_settings` and `save_app_settings` reached their Rust return points after SQL completed; the storage lock left scope before the widget window API ran, so no SQLite mutex deadlock or reminder-scheduler wait was found.

The repair removes the widget bounds listener's initial geometry write. It now writes only after a native move or resize event, preventing the previous save → settings event → refresh → re-subscribe → save feedback path. The period form now always clears its saving state in `finally`. The widget capability is explicitly permitted to listen for events and start dragging, removing the native permission rejections observed during the trace.

Targeted browser UI saves passed across the existing window/DPI matrix; Rust database, formatting and clippy checks passed.

用户在重启后的 Windows 开发窗口中确认设置保存不再永久停留在“保存中…”。结合上述人工验收，Phase 7.4 与 Phase 7 均为 PASS。
