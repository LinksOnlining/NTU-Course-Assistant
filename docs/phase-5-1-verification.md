# Phase 5.1 验证记录

日期：2026-09-12
状态：**PASS**

## 已实现

- `TermConfig`：第 1 教学周星期一、1–30 总教学周数、固定 `Asia/Shanghai`。
- `ReminderSettings`：默认关闭，提前量可设为 0–180 分钟。
- 纯函数：教学周、课程实例、稳定实例键、提醒时刻、future/catch-up/none 决策。
- SQLite schema 2→3：新增 `app_settings`，作息、学期和提醒设置在同一事务中保存；失败时保留旧值。
- 设置界面提供学期起点、总周数、提醒开关和提前量；明确提示本阶段不会发送系统通知。

## 自动验证

- TypeScript typecheck、单元测试、架构测试、lint、格式检查、生产构建。
- Rust 单元测试、格式检查和 clippy。
- `npm run verify` 通过：103 项单元测试、39 项架构测试、282 个 UI 场景通过，15 项私有样本条件跳过，typecheck、lint、格式检查和 build 均通过。
- Rust：20 项测试、`cargo fmt -- --check` 与 `cargo clippy --all-targets -- -D warnings` 通过。
- 真实 Tauri：`npm run tauri dev` 启动独立窗口，窗口标题“大学课程表”、进程响应正常，数据库打开为 schema 3。

## 阶段边界

- 未实现 Windows 通知、提醒调度、托盘、自启动或后台驻留。
- Phase 4 已由用户取消，未继续教务系统导入。
- 本阶段完成后不进入 Phase 5.2，也不创建 Git 提交。
