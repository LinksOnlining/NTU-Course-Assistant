# Phase 3.2 Inbox Verification

## Scope

Implemented the Workspace Inbox flow: preserve raw text locally, parse it deterministically on-device, let the user review/edit a preview, then explicitly create a PersonalTask or PlannerEvent. No global shortcut, clipboard capture, tray capture, network request, AI/NLP dependency, or Academic write path was added. SQLite remains schema 7; no migration was added.

## Behavior

- The raw text is persisted before parsing. If parse-result persistence fails, the raw capture remains available and can be reviewed later.
- Local parser recognizes explicit `任务：` / `待办：` and `日程：` / `安排：` prefixes; 今天/明天/后天, `YYYY-MM-DD`, `M月D日`; `HH:mm`, time ranges; and explicit 截止/DDL markers for task deadlines.
- Unknown intent requires an explicit Task/Event choice. Ambiguous wording such as “明天下午” never receives an invented clock time.
- Task confirmation requires a title. Event confirmation requires date, start, and end. The preview fields are editable before the user confirms.
- Creating a task/event and recording the Inbox target reference is atomic and idempotent. A failed target/reference transaction rolls back. Deleting an Inbox item never deletes its created task or event; dismissed items create no target.
- Dashboard displays only the pending count; it does not load or expose raw text.
- Raw Inbox model intentionally does not implement Rust `Debug`; application/storage code does not log raw captures.

## Verification

- TypeScript and core typecheck: PASS.
- Targeted Inbox unit, architecture, database, and Workspace Inbox UI tests: PASS.
- Full `npm run verify`: PASS — 211 unit, 97 architecture, 741 UI passed / 15 conditionally skipped; typecheck, lint, Prettier, and frontend build passed.
- Full Rust gate: PASS — 62 tests, `cargo fmt -- --check`, and `cargo clippy --all-targets -- -D warnings`.
- Production EXE / installer, installation, and real user database were not used for this development phase.

## Known limitations

- Parser is intentionally small and deterministic; unsupported or ambiguous phrasing is preserved for user review rather than inferred.
- Date-only task wording is not silently interpreted as a deadline; the user may explicitly apply a recognized date/time to the deadline in the preview.
