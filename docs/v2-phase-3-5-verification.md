# Links Workplace v2.0 Phase 3.5 验证记录

## 范围

日常习惯（Routine）管理与确定性安排建议。没有新增 schema migration；复用 schema 7 中已有 `routines` 表。建议只生成一个基于真实空闲时间的 PlannerEvent 草稿，用户在日程编辑器明确保存后才创建事实。

## 行为与边界

- Routine 支持读取、新建、编辑、启用/停用及删除；校验名称、5–720 分钟时长、至少一个星期和成对的可选偏好时间窗口。
- Dashboard 最多显示一个建议。选择习惯按 `createdAt`、`id` 稳定排序；只考虑启用、适用于本地今天且今天尚未安排的习惯。
- 使用现有 Timeline 占用投影计算空闲区间，纳入安排前后 buffer；建议从当前时刻开始，服从偏好窗口，只选可容纳完整目标时长的最早区间。
- 点击“安排”只打开预填的 PlannerEvent 编辑器；取消不写入。确认保存通过单个 SQLite immediate transaction 创建 PlannerEvent 并更新对应 Routine 的 `last_scheduled_date`。若任一步失败则事务回滚。
- Routine 不创建 PersonalTask 或 TimeBlock。删除 Routine 不删除其已创建的 PlannerEvent。

## 自动验证

- 针对性 TypeScript：`npm run typecheck` PASS。
- Routine 与 Dashboard 单元测试：16 PASS；专项 Routine 测试 5 PASS。
- Routine Dashboard UI：2 PASS（取消无写入；确认安排后写入日程；Routine 管理 CRUD）。
- Rust routine 验证及事务专项测试 PASS；阶段完整 Rust 测试：65 PASS，`cargo fmt -- --check` PASS，`cargo clippy --all-targets -- -D warnings` PASS。
- 完整 `npm run verify` PASS：229 unit、104 architecture、777 UI PASS，15 条条件跳过；typecheck、lint、Prettier、frontend build 均 PASS。
- `git diff --check` PASS。

## 未执行

- 未运行 Tauri production build、Production EXE 或安装器；Phase 3.7 再执行其明确要求的生产构建门禁。
- 未访问 release 用户数据库；未改变 v1.3.1 稳定版本或 schema 版本。
