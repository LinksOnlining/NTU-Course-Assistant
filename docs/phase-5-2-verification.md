# Phase 5.2 验证记录

## 状态

**PASS**（2026-09-12）。未进入 Phase 5.3，未创建 Git 提交。

## Scheduler

- `src-tauri/src/scheduler.rs` 使用一个线程和一个 channel；refresh 会立即替换等待中的计划，无 busy polling、无 SQLite 轮询。
- TypeScript 是 Course、教学周、课程实例、提醒时刻和 catch-up 判断的权威；Rust 仅接收稳定 key、UTC epoch 毫秒 trigger 及课程开始时刻。
- 相同 trigger 的计划按 key 一次批量 due；会话内已 due 的 key 不重复触发；due 后继续等待下一计划。

## 自动验证

- TypeScript unit：104 PASS；architecture：39 PASS。
- UI：282 PASS，15 个既有条件 skip；一次 Windows 网络缓冲瞬断导致一个窗口场景失败，随后的 9 种窗口组合针对性重测和完整 UI 重试均 PASS。
- Rust：22 PASS；`cargo fmt -- --check`、`cargo clippy --all-targets -- -D warnings`、build 与 `npm run verify` 均 PASS。

## Desktop 验收

- 在真实 `npm run tauri dev` 独立窗口中确认标题“大学课程表”、schema 3、进程响应正常。
- 通过开发态临时桥接向既有 scheduler command 传入两条 absolute future plan：`phase5-desktop-a` 与 `phase5-desktop-b`；它们分别在实际 trigger 后记录一次 `Reminder due`，顺序正确且无重复。
- 窗口保持响应，正常关闭后无孤立应用进程。桥接、日志和测试计划均已清理；未写入 Course 或 SQLite。

## 当前未实现

Windows 通知、重启/休眠完整恢复、Phase 5.4 持久去重、托盘、自启动和桌面小组件。
