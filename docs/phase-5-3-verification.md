# Phase 5.3 验证记录

## 状态

**PASS**（2026-09-13）。未进入 Phase 5.4，未创建 Git 提交。

## 实现

- 使用官方 `tauri-plugin-notification` 2.4.0 和 `notification:default` capability。
- TypeScript 计划新增最小展示 payload：课程名、开始时间和可选教室；不向 Rust 发送完整 Course。
- Rust scheduler 保持绝对时间生命周期职责；`WindowsNotificationAdapter` 只在 due 时通过官方插件发送标题“课程即将开始”。空教室不显示伪值。
- 发送失败只记录内部错误；已 due key 不重试，后续计划继续处理。

## 自动验证

- 104 TypeScript unit、39 architecture、282 UI PASS，15 项既有条件 skip。
- Rust 24 PASS；fmt、clippy、build 与 `npm run verify` PASS。

## Desktop

- 开发态 Tauri 窗口对中文课程和空教室两条短时 absolute plan 均产生 due，无 adapter 错误，窗口持续响应。
- 已构建并安装本地 NSIS 测试包；安装目录应用以 Windows 安装态身份运行，同样接收两条短时计划并在到期后无待办、窗口响应正常。验收后已卸载测试应用，未写入课程或 SQLite。

官方 Tauri 文档说明 Windows 的正式通知仅适用于已安装应用；开发态使用开发身份。 [Tauri 通知文档](https://v2.tauri.app/plugin/notification/)

## 未实现

重启/睡眠恢复、持久去重、托盘、自启动和桌面小组件。
