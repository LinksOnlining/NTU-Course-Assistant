# Phase 6：开机自启动验证

## 状态

**PASS**（2026-09-13）。本阶段只实现 Windows 当前用户登录后的自动启动和重复启动保护；未进入 Phase 7、小组件、托盘或发布。

## 实现

- 使用官方 `tauri-plugin-autostart` 和 `@tauri-apps/plugin-autostart`。前端服务只调用 `isEnabled`、`enable`、`disable`；能力配置为 `autostart:default`，其实际范围只有读取、启用和关闭。
- 设置弹窗加入独立“启动设置”。默认关闭，打开时读取系统状态，窗口重新获得焦点时再次读取；切换后立即复读实际状态。命令失败、读取失败或系统状态与用户请求不一致时显示错误且不显示伪成功。
- 自动启动不写 SQLite，不改变课程、作息、提醒设置或 `PRAGMA user_version`；数据库 schema 继续为 4。
- 检查到自动启动和手动双击会导致两个应用进程、进而可能重复运行 reminder scheduler，因此使用官方 `tauri-plugin-single-instance`。后续启动请求会显示并聚焦既有 `main` 窗口。

## 自动验证

- TypeScript unit：105 PASS。
- Architecture：39 PASS，React 仍只经 service adapter 使用 Tauri 前端 API。
- UI：315 个场景中 300 PASS、15 个既有条件 skip。新增覆盖默认关闭、enable 成功、disable 成功、enable 失败、disable 失败和操作后的系统状态复读不一致。
- `npm run typecheck`、`npm run lint`、`npm run format:check`、`npm run build`、`npm run verify` 均 PASS。
- Rust：28 tests PASS；`cargo fmt -- --check` 与 `cargo clippy --all-targets -- -D warnings` PASS。

## Windows 安装态验收

- 真实 `npm run tauri dev` 窗口正常打开，标题为“大学课程表”。
- 从本机构建的 NSIS 包安装应用后，设置弹窗显示默认未选中的“登录 Windows 后自动启动应用”。启用后，官方 plugin 在当前用户 Run 注册项写入安装态 executable；关闭后该项实际消失。
- 应用保持普通可见窗口行为，没有隐藏启动、托盘或后台服务。第二次启动安装态 executable 后系统中仍只有一个应用进程。
- 测试结束后开关恢复为关闭，测试安装已卸载；课程数据库、作息和提醒设置未被此阶段改写。
- 没有为验收强制注销、重启或睡眠开发机，因此未模拟真实下次登录；Windows 注册项与安装态 executable 的实际创建、清除和单实例行为已完成验证。

## 仍未实现

- 桌面课程小组件、托盘和正式发布。
