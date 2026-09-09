# 项目状态

- 最后更新：2026-09-09
- 当前阶段：Phase 1 PASS（桌面课程表基础完成）。
- 阶段门禁：停止等待用户确认，不进入 Phase 2。
- 已完成：Phase 0；Phase 1.1 桌面空壳；Phase 1.2 最小模型与纯时间计算；Phase 1.3 七天时间轴 UI；Phase 1.4 桌面实机检查、第一轮 UI 优化与 Phase 1 总验收。
- 核心规则：严格 HH:mm；课程 top/height 只由实际时间及 pxPerMinute 决定；07:00–22:00 轴保留真实空闲比例；重叠链由纯布局函数分配横向 lane；星期列始终为周一至周日。
- 验证 PASS：严格 typecheck、39 项单元测试、23 项架构测试、9 组窗口/缩放矩阵中的 75 项 UI 测试（6 项只在非 900 宽度按条件跳过）、oxlint、Prettier、npm run build、npm run verify。
- Desktop PASS：npm run tauri dev 完成 Rust dev 编译并运行项目 exe；精确定位类名 `Tauri Window`、标题“大学课程表”的真实窗口。宿主 DPI 192（200%）下客户区 1280×800、1000×700、900×600 均实测通过，最大化/恢复、最小化/恢复和正常 WM_CLOSE 通过；真实 Tauri WebView 的纵横滚动及 sticky 几何通过，未出现 EBUSY。
- 测试配置：src/config/timetable.ts 中 TEST_TIMETABLE 明确 purpose=test-only，测试轴为 07:00–22:00、当前周为第 3 周、每分钟 1px；src/fixtures/courses.ts 全部为测试数据，不代表正式南通大学课表或作息。
- 架构：core 只依赖同层逻辑及共享纯类型，不访问 DOM/React/Tauri/系统 IO；组件只消费 core 返回的分钟几何数据。
- UI 状态：Windows 11 风格的系统字体和轻量视觉层级；45 分钟短课只显示课程名和时间，完整信息保留在 aria-label/title；重叠 lane 使用少量固定色差；大块空闲以小时/半小时网格呈现，不压缩时间。
- 窗口配置：默认 1280×800，最小尺寸配置 720×520；单一 `.timetable-scroll` 负责纵横滚动，不存在页面级双滚动条。
- 尚未实现：真实课程数据接入、手动录入和完整外部 Course 校验、存储、PDF/教务导入、提醒、自启动、托盘、安装包。
- 已知非阻断项：Rust 的 linker_messages 创建库/对象输出警告仍存在，编译和运行正常。没有忽略失败测试。
- PDF：已有真实样本检查，15 条固定安排和 3 条非固定实践课程；原件不入 Git，实际钟点和学期起点仍需用户确认。
- 下一步：用户确认后才进入 Phase 2，本轮停止。
- 验证详情：docs/phase-1-verification.md。
- Git：验证通过后本地提交 feat: complete phase 1 timetable foundation；具体提交号见 git log -1，不推送远端。

继续前阅读 CODEX.md、DESIGN.md 和验证记录；保留 Phase 1.1 的 Vite watcher 忽略规则。
