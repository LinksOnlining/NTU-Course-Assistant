# 项目状态

- 最后更新：2026-09-09
- 当前阶段：Phase 2 PASS（Phase 2.1–2.4 全部验收完成）。
- 阶段门禁：停止等待用户确认，不进入 Phase 3。
- 已完成：Phase 0；Phase 1 全部；Phase 2 的统一校验、添加/编辑/删除、SQLite migration、持久化、异常恢复与总验收。
- 核心规则：严格 HH:mm；课程 top/height 只由实际时间及 pxPerMinute 决定；07:00–22:00 轴保留真实空闲比例；重叠链由纯布局函数分配横向 lane；星期列始终为周一至周日。
- 验证 PASS：严格 typecheck、64 项 TypeScript 单元测试、28 项架构测试、9 项 Rust 数据库测试、9 组窗口/缩放矩阵中的 201 项 UI 测试（6 项按既有条件跳过）、clippy、oxlint、Prettier、npm run build、npm run verify。
- Desktop PASS：从数据库完全不存在开始，真实 Tauri WebView 与 AppData SQLite 完成四轮启动。首次自动创建 schema 1 且用户课程为空；添加后重启存在；编辑为“机械原理”后同一 ID、周四 09:00 的 120px 偏移和 90px 高度跨重启保留；删除后再次重启仍不存在。页面/控制台无错误，原数据库已恢复。
- 测试配置：src/config/timetable.ts 中 TEST_TIMETABLE 明确 purpose=test-only，测试轴为 07:00–22:00、当前周为第 3 周、每分钟 1px；src/fixtures/courses.ts 全部为测试数据，不代表正式南通大学课表或作息。
- 架构：core 只依赖同层逻辑及共享纯类型，不访问 DOM/React/Tauri/系统 IO；组件只消费 core 返回的分钟几何数据。
- UI 状态：Windows 11 风格的系统字体和轻量视觉层级；45 分钟短课只显示课程名和时间，完整信息保留在 aria-label/title；重叠 lane 使用少量固定色差；大块空闲以小时/半小时网格呈现，不压缩时间。
- 窗口配置：默认 1280×800，最小尺寸配置 720×520；单一 `.timetable-scroll` 负责纵横滚动，不存在页面级双滚动条。
- Phase 2 状态：数据库由 `app_local_data_dir()` 自动创建，schema `user_version=1`；fixture 只在开发模式显示且从未写入数据库。损坏行逐条跳过并提示，不自动修改或删除；未来 schema 被拒绝且原数据不变；busy/write failure 不造成 UI/数据库分叉。
- 尚未实现：PDF/教务导入、提醒、自启动、托盘、安装包。
- 已知非阻断项：Rust 的 linker_messages 创建库/对象输出警告仍存在，编译和运行正常。没有忽略失败测试。
- PDF：已有真实样本检查，15 条固定安排和 3 条非固定实践课程；原件不入 Git，实际钟点和学期起点仍需用户确认。
- 下一步：用户确认后才进入 Phase 3，本轮停止。
- 验证详情：docs/phase-1-verification.md、docs/phase-2-verification.md。
- Git：验证通过后本地提交 feat: complete phase 2 course persistence；具体提交号见 git log -1，不推送远端。

继续前阅读 CODEX.md、DESIGN.md 和验证记录；保留 Phase 1.1 的 Vite watcher 忽略规则。
