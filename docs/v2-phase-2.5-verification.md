# Phase 2.5 — Interactive Scheduling 验证记录

日期：2026-09-24
状态：PASS（自动验证）

## 实现

- 仅 PlannerEvent 与 TimeBlock 可 Pointer Events 拖动、resize；Academic course 保持只读，不能拖动或 resize。
- 拖动五分钟吸附；resize 五分钟交互最小长度；开始/结束被限制在 00:00–24:00，不跨日。手动编辑表单仍可修改任意有效分钟，键盘用户不依赖拖拽。
- Planner conflict / free-time 为纯逻辑：用 buffer 扩展有效占用，取消课程不占用，相邻区间仅在有效占用重叠时才冲突；Timeline 和持久化的实际起止时间不被 buffer 改写。
- 新建、编辑、拖动、resize 在保存前检查冲突，列出冲突对象并提供“仍然保存 / 返回调整”。冲突允许保存，不是数据库约束；编辑时排除自身。存储失败保持原有显示时间并报告错误。
- PlannerEvent / TimeBlock 支持以 `24:00` 作为日末结束边界，起始钟点仍限制 00:00–23:59；Rust 校验和 SQLite 往返覆盖此边界。
- schema 保持 6；无新依赖，无新增 migration，无修改 PersonalTask deadline。

## 验证

- `npm run verify`：PASS。197 unit、88 architecture；UI 696 PASS / 15 条件跳过；typecheck、lint、Prettier、前端 build 均 PASS。
- Interactive Schedule 定向 UI：PASS（7 项）；覆盖 Event/TimeBlock drag/resize、课程不可拖、冲突取消与仍然保存、失败回滚、键盘打开编辑、表单冲突预览、24:00 结束边界。
- 冲突提示框在全量门禁后补充初始焦点、Escape 返回和焦点恢复；TypeScript 与 Schedule 定向 UI（7 项）再次 PASS。
- Timeline / Planner 定向 unit：PASS，覆盖有效占用、buffer overlap、相邻边界、取消/self exclusion、合并和空闲段、snap/clamp/minimum、00:00/24:00。
- `cargo test --manifest-path src-tauri/Cargo.toml`：PASS，54 tests。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：PASS。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`：PASS。
- `git diff --check`：PASS。

## 视觉与范围说明

- UI 覆盖桌面、1366×768、720×520，以及浅色/深色模式；没有引入 drag library。
- 自动化使用 Playwright DOM、交互和视口断言；这不是 Windows 安装态人工验收。
- 未运行生产 EXE、未安装 MSI/NSIS、未连接真实用户数据库；这些不属于本 Phase 2 开发门禁。
