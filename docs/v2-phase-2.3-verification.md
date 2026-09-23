# Links Workplace v2.0 — Phase 2.3 验证

日期：2026-09-24  
结果：**PASS**

## 范围

- PlannerEvent 与 TimeBlock 在现有 schema 6 中的 Rust / SQLite CRUD。
- 日期范围、按任务读取、字段校验、buffer 持久化、数据库重开。
- Task 完成保留 TimeBlock；Task 删除级联删除 TimeBlock，且不影响独立 PlannerEvent。
- Planner Application 创建、编辑、删除、读取与 draft validation。
- PlannerEvent / TimeBlock Timeline adapters：stable sourceRef、编辑/拖动/resize 权限、实际时间与 Task 标题投影。
- PlannerEvent 与 TimeBlock editor components；日程正式页面及其交互在 Phase 2.4 接入。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run verify` | PASS：187 unit、86 architecture、624 UI；15 个条件跳过。typecheck、lint、Prettier、frontend build 均通过。 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | PASS：53 tests。 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | PASS。 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | PASS。 |
| Planner / PersonalTask targeted unit + architecture | PASS：15 tests。 |
| Workspace Tasks targeted Playwright (`1280-100`) | PASS：2 tests。 |
| `git diff --check` | PASS。 |

完整验证第一次运行时，一个既有 Widget UI 测试的 `beforeEach` 在等待课表导航按钮时超时；该测试隔离运行通过，未改产品代码或放宽断言，随后完整验证重跑通过（624 UI pass）。

## 领域与数据边界

- 仅使用 schema 6 的 `planner_events` / `time_blocks` / `personal_tasks`；未修改 schema、生产 DB 路径或 identifier。
- 日期使用本地 `YYYY-MM-DD`，日程起止使用本地 `HH:mm`；不做 UTC 转换，不支持跨午夜。
- buffers 限制为 0–240 分钟，只作为数据事实保存；Timeline 投影使用真实 start/end，不将 buffer 并入显示几何。
- TimeBlock 不存标题；投影从 PersonalTask 读取名称。任务改名后，下一次读取/投影自然更新标题。
- PersonalTask deadline 不会变成 TimelineItem。PlannerEvent 与 TimeBlock 的 sourceRef 使用自身 stable ID，允许后续 Schedule 交互。
- 未执行 Tauri production build、安装态验收、push、tag 或 Release。

## 重要文件

- `src-tauri/src/models.rs`
- `src-tauri/src/db.rs`
- `src-tauri/src/lib.rs`
- `src/application/planner/planner-schedule.ts`
- `src/application/timeline/planner-timeline.ts`
- `src/workspace/schedule/PlannerEventEditor.tsx`
- `src/workspace/schedule/TimeBlockEditor.tsx`
