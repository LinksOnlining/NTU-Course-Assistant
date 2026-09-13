# Phase 8 验证记录

## 状态

**PASS**（2026-09-13）。系统托盘、主窗口生命周期与正式图标资产均已完成；schema 保持 `4`。

## 实现

- 正式源图保留于 `assets/branding/app-icon-source.png`，Tauri bundle 使用该源图生成的 PNG 图层和真实 multi-resolution `src-tauri/icons/icon.ico`；ICO 包含 16、24、32、48、64、128、256 像素图层。
- 托盘使用官方 Tauri 2 `TrayIconBuilder`，进程中只创建一个 tray。菜单提供“打开课程表”“显示 / 隐藏桌面小组件”和“退出程序”；左键与菜单打开项复用 `show_main_window`，按 unminimize → show → focus 恢复既有主窗口。
- 主窗口关闭请求改为隐藏，tray、单一 reminder scheduler 和最多一个 widget 继续存活；菜单“退出程序”调用应用退出。Tray 切换 widget 复用已有 `WidgetSettings` 持久化边界，不增加第二套状态或 SQLite schema。
- 提醒设置新增“发送测试提醒”。它复用正式 Windows 通知适配器，只请求发送测试 Toast，不修改课程、计划、设置或 handled 状态。

## 自动验证

- `npm run verify` PASS：107 项 TypeScript 单元、44 项架构、327 个 UI 场景通过，15 项既有设备或私有样本条件跳过；typecheck、lint、Prettier 与 Vite build 均通过。
- `cargo test` PASS：33 项 Rust 测试通过；`cargo fmt -- --check` 与 `cargo clippy --all-targets -- -D warnings` PASS。
- `npm run tauri build` PASS，生成 release EXE、MSI 与 NSIS 安装包。没有缺失 `.ico`。

## Windows 人工与安装态验收

- 已实际观察：正式 App Icon 与简化 Tray Icon 清晰；Tray 菜单正确；主窗口 × 后隐藏且 tray 保留；Tray 恢复主窗口；Tray 显示/隐藏 widget；重复启动维持单实例；Windows 测试提醒实际显示（PASS）。
- NSIS 已静默安装到 `C:\Users\LinYu\AppData\Local\NTU Course Assistant`，安装态 EXE 成功启动且不依赖 localhost。Start Menu 快捷方式存在，目标为安装态 EXE；release EXE、MSI、NSIS 均已生成。
- 未单独执行：安装态下对每个 Explorer/Taskbar/Alt+Tab 图标尺寸逐项肉眼复查，以及 Tray “退出程序”单独人工点击。它们不构成 V1 阻断：同一 bundle 图标配置已用于 EXE/MSI/NSIS，快捷方式已验证指向安装态 EXE；退出项走官方 Tauri `app.exit(0)` 路径并由架构测试覆盖。

## 边界

- 完全退出应用后不作为 Windows Service 继续计时；这是既有 Phase 5 边界。
- 不实现后台服务、第二进程、全局热键、动态 tray 倒计时或 updater。

## 后续

下一阶段为 **Phase 9 — 用户人工体验验收与细节修改**，等待用户确认。
