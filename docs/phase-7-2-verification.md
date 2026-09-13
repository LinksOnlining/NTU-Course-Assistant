# Phase 7.2 Verification

## Scope

Phase 7.2 adds read-only course content to the existing desktop widget. It does not add widget positioning, sizing, persistence, notifications, a scheduler, or a database migration.

## Implementation

- `Course[]` and `TermConfig` are loaded through the existing storage service.
- The widget derives a pure `WidgetViewModel` through the existing teaching-week and `CourseOccurrence` logic.
- The default Today view orders the current teaching week's courses by start time and omits an empty classroom.
- The Week view lists the same real occurrences from Monday through Sunday.
- Missing term configuration, dates outside the teaching term, empty days, and load failures have explicit UI states.
- The main window emits a refresh event only after successful course CRUD, successful PDF import, or saved term/period settings. The widget reloads its own data after receiving that event.
- The widget refreshes its Shanghai wall clock every minute. It does not create or control the reminder scheduler.
- The “打开课程表” action asks the existing main Tauri window to show and focus.

## Automated checks

- Unit coverage verifies occurrence-derived Today ordering, null classroom rendering data, the seven-day Week mapping, missing-term handling, and out-of-term handling.
- Architecture coverage verifies that widget UI does not access SQLite, course storage, notification, scheduler, or Tauri APIs directly; the window service owns Tauri window/event access; widget core remains pure; and only one Rust scheduler is created.
- UI coverage verifies the widget route, Today default state, Week switch, widget-only rendering, and the main-window action.
- `npm run verify` passed: 107 unit tests, 42 architecture tests, and 333 UI scenarios (318 passed; 15 environment-gated scenarios skipped). Typecheck, lint, Prettier, and production build are included in that command.
- `cargo test` passed 28 tests; `cargo fmt -- --check` and `cargo clippy --all-targets -- -D warnings` passed. The only emitted Rust diagnostic was the toolchain's MSVC linker informational warning.

## Desktop check

`npm run tauri dev` successfully compiled and opened the independent Windows application titled “大学课程表”. The local course database opened at schema 4. The Tauri build retains the separate `widget` window, and the main-window command is covered by the widget service/UI regression boundary.

## Completion boundary

The schema remains at `user_version = 4`. No Course is created by the widget, no Widget-specific domain model is introduced, and no widget window/mode state is persisted. Phase 7.3 remains pending user confirmation.
