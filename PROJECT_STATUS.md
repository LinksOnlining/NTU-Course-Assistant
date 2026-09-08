# 项目状态

- 最后更新：2026-09-09
- 当前阶段：Phase 1.3 PASS（七天课程表时间轴 UI）；Phase 1 整体尚未完成。
- 阶段门禁：停止等待用户确认，不进入 Phase 1.4。
- 已完成：Phase 0；Phase 1.1 桌面空壳；Phase 1.2 最小模型与纯时间计算；Phase 1.3 测试周过滤、七天固定列、分钟比例布局、相邻/重叠课程布局、单容器滚动及响应式课程表。
- 核心规则：严格 HH:mm；课程 top/height 只由实际时间及 pxPerMinute 决定；07:00–22:00 轴保留真实空闲比例；重叠链由纯布局函数分配横向 lane；星期列始终为周一至周日。
- 验证 PASS：严格 typecheck、39 项单元测试、23 项架构测试、三组缩放/视口下 16 项 UI 测试（2 项按视口跳过）、oxlint、Prettier、npm run build、npm run verify。
- Desktop PASS：npm run tauri dev 完成 Rust dev 编译并运行项目 exe；独立 Windows 窗口标题“大学课程表”、非零 MainWindowHandle、Responding=True。两次临时文本变更均在同一开发会话收到 Vite HMR，恢复后源文件无临时文字；未出现 EBUSY。
- 测试配置：src/config/timetable.ts 中 TEST_TIMETABLE 明确 purpose=test-only，测试轴为 07:00–22:00、当前周为第 3 周、每分钟 1px；src/fixtures/courses.ts 全部为测试数据，不代表正式南通大学课表或作息。
- 架构：core 只依赖同层逻辑及共享纯类型，不访问 DOM/React/Tauri/系统 IO；组件只消费 core 返回的分钟几何数据。
- 尚未实现：真实课程数据接入、手动录入和完整外部 Course 校验、存储、PDF/教务导入、提醒、自启动、托盘、安装包。
- 已知非阻断项：Rust 的 linker_messages 创建库/对象输出警告仍存在，编译和运行正常。没有忽略失败测试。
- PDF：已有真实样本检查，15 条固定安排和 3 条非固定实践课程；原件不入 Git，实际钟点和学期起点仍需用户确认。
- 下一步：用户确认后才进入 Phase 1.4，本轮停止。
- 验证详情：docs/phase-1-verification.md。
- Git：验证通过后本地提交 feat: implement timetable time-axis UI；具体提交号见 git log -1，不推送远端。

继续前阅读 CODEX.md、DESIGN.md 和验证记录；保留 Phase 1.1 的 Vite watcher 忽略规则。
