# Links Workplace v2.0 — Planner / Personal Task Domain Contract

状态：Phase 2.0 Domain Contract 已冻结；Phase 2.1 Debug DB 隔离与 schema 5→6 迁移、Phase 2.2 PersonalTask 与 Phase 2.3 PlannerEvent/TimeBlock 实现及验证已完成。后续 Phase 2 实现必须遵守本契约。

## 1. 当前实现审计基线

- SQLite 当前为 schema 5；版本迁移在 `src-tauri/src/db.rs` 的 `CourseDatabase::migrate` 顺序执行。`CourseDatabase::open` 打开连接、启用 `foreign_keys` 与 WAL 后迁移；普通命令通过 `CourseState::run_in_background` 使用 `spawn_blocking`，每次 operation 创建短生命周期连接。`CourseState` 只保留数据库路径，不持有全局 SQLite connection 或 mutex。
- 当前生产路径由 Tauri `app_local_data_dir()` 决定，文件为 `courses.sqlite3`；Tauri identifier 是 `com.ntu-course-assistant.desktop`。开发态当前尚未隔离，迁移开发前必须先完成 Phase 2.1 隔离。
- schema 5 的 Academic 表包含 courses、period_times、app_settings、handled_reminders、semesters、course_overrides、academic_tasks、exams、reminder_rules、reminder_instances。当前连接逐条执行 `PRAGMA foreign_keys = ON`；新 planner connection 也必须如此。
- Rust storage 错误为 `StorageError`，边界将其记录并转成面向用户的中文错误；Tauri command 返回 `Result`。新 Planner 命令遵循同一后台 blocking 路径，不在 Tauri async worker 同步执行 SQLite。
- Academic Rust models 使用 serde camelCase 暴露字段；SQL snake_case；枚举在 SQL / Rust wire format 使用大写值。Academic `priority` 是 0–2 数字，本契约的 PersonalTask priority 是独立语义，不复用 AcademicTask 类型。
- 前端稳定 ID 由 `crypto.randomUUID()` 生成；审计时间由 `new Date().toISOString()` 生成并按 UTC RFC3339 字符串存储。日期与日程钟点是本地 wall-clock 字符串，不转换成 UTC 时间戳。
- 现有 TimelineItem 是应用层只读投影，Academic adapter 消费已经解析的 canonical `AcademicCourseOccurrence`。其类型已预留 plannerEvent / timeBlock 来源和 `editable` / `draggable` / `resizable` / `occupiesTime` 能力；Workspace route union 已含 Tasks / Schedule，但 `getShellRouteView` 当前仍将其显示为 unsupported。
- 当前 workspace application 汇总 AcademicApplication 返回的数据；Presentation 不直接访问 Academic storage。新 Planner 写入必须经 Planner application use case，再由 service/Tauri adapter 落库。

## 2. 三个独立领域对象

### PersonalTask

表达“要完成什么”，字段为 `id`、`title`、可选 `description`、`status`、`priority`、`deadlineDate`、`deadlineTime`、`createdAt`、`updatedAt`、可空 `completedAt`。

- `status`：`open | completed`。
- `priority`：`none | low | medium | high`，与 AcademicTask priority 独立。
- 标题 trim 后非空，最多 200 个 Unicode 字符；描述可空，最多 5,000 个字符。
- deadline 均为空表示无截止日期；只有日期允许；有时间必须有日期。日期型 deadline 不伪造成 23:59。
- Deadline 是提醒/排序事实，不生成 TimelineItem，也不占用时间。
- 一个任务可以关联 0 到多个 TimeBlock。
- 完成只改变任务状态和完成审计时间，不删除或隐藏 TimeBlock；重新打开清除 completedAt。删除任务需 UI 确认关联时间块将级联删除。

### PlannerEvent

表达独立个人日程，包含 `id`、`title`、可选 `description`、`date`、`startTime`、`endTime`、可选 `location`、`bufferBeforeMinutes`、`bufferAfterMinutes`、`createdAt`、`updatedAt`。它不要求关联任务。

### TimeBlock

表达为一个 PersonalTask 预留的具体时间，包含 `id`、`personalTaskId`、`date`、`startTime`、`endTime`、前后 buffer、创建/更新时间。不保存重复标题；Timeline 标题从关联任务读出，因此任务改名会自然反映。删除任务级联删除其时间块；完成任务不删除时间块。

## 3. 日期、时间与有效性

- `date` / `deadlineDate` 采用严格有效的 `YYYY-MM-DD` 公历日期；时间采用严格 `HH:mm`，范围 00:00–23:59。
- 日程按本地 wall-clock 解释，不隐式应用 UTC 或夏令时转换。`startTime < endTime`，首版只支持同一自然日，不支持跨午夜、重复/recurrence、全天事件。
- 标题 trim 后非空、最多 200 字符；description 最多 5,000 字符；location 最多 200 字符。
- Buffer 前后分别是 0–240 分钟，默认 0。Buffer 只影响冲突检测和空闲时间，不改变数据库实际 start/end，也不扩张 Timeline 卡片。
- 实际日界为 `[00:00, 24:00]`。手动表单可使用合法分钟；拖动/resize 吸附 5 分钟并 clamp 到日界，pointer resize 最短 5 分钟，业务对象只要求结束晚于开始。
- `createdAt` / `updatedAt` / `completedAt` 是 UTC RFC3339 审计时间；绝不作为用户本地日程钟点。

## 4. Timeline、冲突与空闲时间

- TimelineItem 仍是应用层展示 projection，不是数据库事实。来源仅为已解析 AcademicCourseOccurrence、PlannerEvent 与 TimeBlock；PersonalTask、其 deadline 和任务摘要均不直接变成 TimelineItem。
- AcademicCourseOccurrence 在 Planner 永远 `editable=false`、`draggable=false`、`resizable=false`。课程变化必须经既有 Academic CourseOverride 工作流。Planner 不重解析 Academic override，也不改 Academic tables。
- PlannerEvent / TimeBlock 对应 sourceRef 使用稳定 source ID，具备编辑、拖动和调整大小能力；TimeBlock 的展示标题关联 PersonalTask。
- 实际时间段用来显示。有效占用区间为：课程实际区间；日程/时间块实际区间减去 before buffer、加上 after buffer。停课 occurrence 不占用。
- 两个有效区间严格重叠才是冲突；相邻边界（end == next start）且无 buffer 时不冲突。编辑、拖动、resize 必须排除自身 sourceRef。
- 冲突是提示而不是数据库约束：保存前列出冲突，用户可以返回调整/取消，或明确选择仍然保存。保存失败必须与冲突提示区分。
- Free Time 仅使用 `occupiesTime=true` 的有效占用：排序后合并重叠或相邻区间，再生成 00:00–24:00 内空闲间隔；取消课程被忽略。Timeline 展示仍按实际而非有效占用区间。

## 5. schema 6 单次迁移

Phase 2 只新增一个生产迁移：`5 → 6`；Phase 2.2 / 2.3 不再递增 schema。此迁移已在 Phase 2.1 实现。新表与 Academic 数据共用原 `courses.sqlite3`。

```sql
CREATE TABLE personal_tasks (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
  description TEXT NULL CHECK(description IS NULL OR length(description) <= 5000),
  status TEXT NOT NULL CHECK(status IN ('OPEN', 'COMPLETED')),
  priority TEXT NOT NULL DEFAULT 'NONE'
    CHECK(priority IN ('NONE', 'LOW', 'MEDIUM', 'HIGH')),
  deadline_date TEXT NULL,
  deadline_time TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NULL,
  CHECK(deadline_time IS NULL OR deadline_date IS NOT NULL),
  CHECK((status = 'OPEN' AND completed_at IS NULL) OR
        (status = 'COMPLETED' AND completed_at IS NOT NULL))
);
CREATE INDEX personal_tasks_status_deadline
  ON personal_tasks(status, deadline_date, deadline_time, priority);

CREATE TABLE planner_events (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
  description TEXT NULL CHECK(description IS NULL OR length(description) <= 5000),
  date TEXT NOT NULL CHECK(length(date) = 10),
  start_time TEXT NOT NULL CHECK(length(start_time) = 5),
  end_time TEXT NOT NULL CHECK(length(end_time) = 5),
  location TEXT NULL CHECK(location IS NULL OR length(trim(location)) BETWEEN 1 AND 200),
  buffer_before_minutes INTEGER NOT NULL DEFAULT 0 CHECK(buffer_before_minutes BETWEEN 0 AND 240),
  buffer_after_minutes INTEGER NOT NULL DEFAULT 0 CHECK(buffer_after_minutes BETWEEN 0 AND 240),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(start_time < end_time)
);
CREATE INDEX planner_events_date_time ON planner_events(date, start_time, end_time);

CREATE TABLE time_blocks (
  id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
  personal_task_id TEXT NOT NULL REFERENCES personal_tasks(id) ON DELETE CASCADE,
  date TEXT NOT NULL CHECK(length(date) = 10),
  start_time TEXT NOT NULL CHECK(length(start_time) = 5),
  end_time TEXT NOT NULL CHECK(length(end_time) = 5),
  buffer_before_minutes INTEGER NOT NULL DEFAULT 0 CHECK(buffer_before_minutes BETWEEN 0 AND 240),
  buffer_after_minutes INTEGER NOT NULL DEFAULT 0 CHECK(buffer_after_minutes BETWEEN 0 AND 240),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(start_time < end_time)
);
CREATE INDEX time_blocks_date_time ON time_blocks(date, start_time, end_time);
CREATE INDEX time_blocks_task_date ON time_blocks(personal_task_id, date, start_time);
```

The application validator performs exact Gregorian date and `HH:mm` checks in addition to SQL structural checks. All planner SQLite connections enable foreign keys. Foreign-key enforcement, task deletion cascade, populated schema-5 preservation, new-schema integrity, and rejected partial migration are migration gates.

### Phase 2.1 实施与安全验证

- Debug app 数据库位于 `<app_local_data_dir>/dev-v2/courses.sqlite3`；Release 仍为 `<app_local_data_dir>/courses.sqlite3`，不访问或复制真实用户数据库。
- 新鲜数据库直接创建 schema 6；旧 schema 1–5 在迁移前使用 SQLite `VACUUM INTO` 创建并校验一致性备份，备份失败则迁移失败关闭。
- schema 5→6 的三张表、索引与版本号在单个事务内创建；迁移后校验表、索引、外键、`user_version` 与 `integrity_check`，任一失败则回滚。
- Phase 2.1 结果与自动验证见 `docs/v2-phase-2.1-verification.md`。

### Phase 2.2 PersonalTask 实施

- PersonalTask CRUD 已通过 Application use cases 与 storage adapter 暴露给 Workspace Tasks；个人任务和 AcademicTask 在同一页面分组呈现，但 AcademicTask 保持只读并链接回 Academic 管理入口。
- 状态仅为 `open | completed`；完成可从已完成列表重新打开。任务删除前明确确认关联 TimeBlock 将级联删除。日期、日期+时间、无截止日期均受支持；单独设置时间会被拒绝。
- Deadline、逾期分组、自然日期标签、排序及表单校验位于 `src/application/planner/personal-tasks.ts`；Workspace presentation 不直接调用 Tauri 或访问存储。
- PersonalTask deadline 不生成 TimelineItem；对应保护测试位于 `tests/architecture/planner-application-boundary.test.mjs`。
- Phase 2.2 自动验证见 `docs/v2-phase-2.2-verification.md`。

### Phase 2.3 PlannerEvent / TimeBlock 实施

- PlannerEvent 与 TimeBlock 已使用 schema 6 的既有表实现 Rust CRUD；可按闭区间日期范围读取，TimeBlock 也可按 PersonalTask ID 读取。没有新增 schema migration。
- 保存边界验证公历日期、同日 `start < end`、必填关联任务、标题/描述/地点长度及 0–240 分钟 buffers。跨午夜明确拒绝；buffer 不改事实起止时间。
- TimeBlock 只保存 PersonalTask ID，不复制任务标题。Timeline projection 从当前 PersonalTask 读取标题；任务改名后重新投影即可显示新标题。完成任务保留 TimeBlock，删除任务由既有外键 cascade 删除 TimeBlock；PlannerEvent 独立保留。
- `PlannerEventEditor` 与 `TimeBlockEditor` 使用 Planner Application draft 校验；Timeline adapters 为两种来源建立稳定 sourceRef，设为可编辑、可拖动、可 resize、占用时间。
- Phase 2.3 自动验证见 `docs/v2-phase-2.3-verification.md`。

### Phase 2.5 interactive scheduling

- Only PlannerEvent and TimeBlock accept pointer drag/resize. Drag moves in five-minute increments; resize has a five-minute interaction minimum; both clamp within 00:00–24:00 and never cross into another date. Forms remain the keyboard-accessible editing alternative.
- `24:00` is accepted only as a planner interval end. It is stored as the same-day boundary; start times and Academic/PeriodTime clocks still use 00:00–23:59.
- Conflict and free-time functions operate on Timeline projections. Planner buffers expand effective occupancy for those calculations only; displayed/persisted actual start/end are unchanged. Cancelled Academic occurrences do not occupy time; adjacent intervals without a buffer do not conflict.
- Conflict is a pre-save warning with “仍然保存” / “返回调整”, not a persistence invariant. Editing excludes the same source reference; save failures leave the existing time unchanged.
- Verification: `docs/v2-phase-2.5-verification.md`.

### Migration safety sequence

1. Reject unsupported future schema. A fresh version-0 DB follows the existing bootstrap and initializes directly to schema 6 without a legacy backup.
2. For an existing schema 1–5 DB, create a SQLite-consistent snapshot in the matching app-data root under `backups/migrations/`; the current supported production upgrade is schema 5 → 6. Names include source schema, target schema, UTC epoch-millisecond timestamp and a collision suffix. Do not copy only the main DB while WAL is active; do not delete migration backups.
3. Reopen/validate the snapshot (`user_version` equals the original source version, SQLite integrity and foreign keys clean) before touching the live database. Backup failure aborts migration. Existing legacy migrations 1–4 remain supported and keep their original-version backup before those migrations run.
4. Execute schema-6 DDL and `user_version=6` in one transaction; validate required objects, foreign keys, `PRAGMA foreign_key_check` and integrity before commit.
5. On any schema-6 migration failure, transaction rollback leaves the live DB at schema 5 with Academic rows intact and the validated backup available. Tests inject a post-DDL in-transaction failure and compare populated Academic fixtures before/after.
6. An already-valid schema 6 reopens without repeating migration or creating another backup.

Backup uses SQLite `VACUUM INTO` for a consistent snapshot, including committed WAL data; no dependency or rusqlite feature is added. Reopen and integrity-check each snapshot before migration.

## 6. Implementation boundaries

- Domain validation, sorting, deadline semantics, projections, conflict/free-time logic, and use cases belong in `src/application/planner/` and nearby domain type modules, following existing Application patterns.
- Tauri persistence bridge follows `src/services/` invoke adapters. Workspace Presentation never issues raw planner invoke/SQL. Rust planner persistence may live in a focused `planner_db.rs`; `db.rs` remains connection, schema migration orchestration and common Academic storage.
- `workspace/tasks` and `workspace/schedule` are typed and active Workspace routes. Phase 2.2 and 2.4 activate them without adding a router dependency.
- Workspace read composition uses Application boundaries. The Academic adapter continues to return canonical occurrences; Planner code never reproduces course override/time resolution.
- Empty migrations must not alter course, semester, override, AcademicTask, exam, PeriodTime, reminder, widget, or app-settings rows. Do not change Tauri identifier, production DB path or DB filename.

## 7. Explicit non-goals

No recurrence, cross-midnight, all-day schedule, focus/session/actual activity, quick capture/global hotkey, Diary, Inbox, AI, Weather, Context, Routine, Search/Ctrl+K, brand/identifier migration, version bump, installer/updater E2E, push/tag/release, or Phase 3.
