# Phase 7.1：桌面课程小组件原型验证

## 状态

**PASS**（2026-09-13）。本阶段只建立一个可验证的底层第二窗口原型；未进入 Phase 7.2 的今日/本周课程内容、窗口状态持久化、托盘或发布。

## 实现

- 同一 Tauri 进程提供 Rust `open_widget` command。首次通过官方 `WebviewWindowBuilder` 创建 label 为 `widget` 的独立顶级窗口；后续请求只显示该窗口，不创建 `widget-2` 等重复窗口。
- 原型窗口加载 `index.html?widget`，固定为 320×180，`decorations(false)`、`skip_taskbar(true)`、不可缩放、不可最大化、不可最小化，且没有全屏或置顶配置。
- 底层行为使用官方 `always_on_bottom(true)`；创建时采用 `focused(false)`，重用窗口只调用 `show()`，不调用 `set_focus()`。用户点击窗口时仍保持普通可聚焦窗口行为。
- `CloseRequested` 会阻止关闭并隐藏 widget，主窗口与现有应用生命周期不变。开发态的“打开小组件原型”入口仅用于验收，生产构建不渲染该入口。
- `WidgetPrototype` 只显示“课程小组件 / Phase 7.1 prototype”静态文本。它没有 Course 真相源、SQLite 访问、第二 scheduler、通知、托盘、WorkerW/Explorer/壁纸注入或第二 exe/process。

## 自动验证

- TypeScript unit：105 PASS。
- Architecture：40 PASS。新增断言确认窗口 service 是唯一的前端 Tauri 边界，原型组件不包含 course storage、SQLite、reminder 或 Tauri API；Rust 仍只构造一个 `ReminderScheduler`。
- UI：324 个场景中 309 PASS、15 项既有设备/私有样本条件 skip。新增开发态打开入口回归，确认主时间表与小组件原型路由分离。
- `npm run typecheck`、`npm run test:unit`、`npm run test:arch`、`npm run test:ui`、`npm run lint`、`npm run format:check`、`npm run build`、`npm run verify` 全部 PASS。
- Rust：28 tests PASS；`cargo fmt -- --check` 与 `cargo clippy --all-targets -- -D warnings` PASS。

## Windows 桌面验收

- 真实 `npm run tauri dev` 成功打开标题为“大学课程表”的独立 Windows 窗口；点击开发态入口后，同一进程创建标题为“课程小组件”的第二窗口。
- 实测单一 `ntu-course-assistant` 进程、两个窗口（主窗口和 widget）；连续再次打开后窗口数量仍为两个。
- widget 创建后主课程表继续处于前景，且主课程表覆盖 widget；这同时验证了创建不抢焦点和底层窗口不覆盖普通应用窗口。关闭 widget 请求后主应用继续运行，重新打开仍复用原窗口。
- widget 配置为跳过任务栏且无系统标题栏；未实施 always-on-top、AppBar、Explorer restart、桌面嵌入或壁纸窗口技巧。Win+D、Alt+Tab、多显示器和 DPI 状态保持在后续交互/兼容性阶段验证，未作为本最小窗口原型的实现内容。

## 未实现

- 今日或本周课程内容与 CourseOccurrence 映射。
- 窗口位置、尺寸、显示状态或 monitor/DPI 的持久化与恢复。
- 托盘、全局快捷键、通知、第二调度器、第二进程、安装包或发布。
