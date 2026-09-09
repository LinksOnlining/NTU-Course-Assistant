# 项目状态

- 最后更新：2026-09-09
- 当前阶段：Phase 2.1 PASS（课程输入校验与内存添加完成）。
- 阶段门禁：停止等待用户确认，不进入 Phase 2.2 编辑/删除或后续 SQLite。
- 已完成：Phase 0；Phase 1 全部；Phase 2.1 统一课程输入校验、周数解析、添加表单和内存态添加。
- 核心规则：严格 HH:mm；课程 top/height 只由实际时间及 pxPerMinute 决定；07:00–22:00 轴保留真实空闲比例；重叠链由纯布局函数分配横向 lane；星期列始终为周一至周日。
- 验证 PASS：严格 typecheck、63 项单元测试、26 项架构测试、9 组窗口/缩放矩阵中的 111 项 UI 测试（6 项按既有条件跳过）、oxlint、Prettier、npm run build、npm run verify。
- Desktop PASS：npm run tauri dev 完成 Rust dev 编译并运行项目 exe；精确定位类名 `Tauri Window`、标题“大学课程表”的真实窗口。宿主 DPI 192（200%）下在真实 Tauri WebView 添加“机械设计基础”，周三 14:00 偏移实测 420px、高度 90px，无页面错误；正常关闭并重启后内存课程为 0，符合本阶段预期。
- 测试配置：src/config/timetable.ts 中 TEST_TIMETABLE 明确 purpose=test-only，测试轴为 07:00–22:00、当前周为第 3 周、每分钟 1px；src/fixtures/courses.ts 全部为测试数据，不代表正式南通大学课表或作息。
- 架构：core 只依赖同层逻辑及共享纯类型，不访问 DOM/React/Tauri/系统 IO；组件只消费 core 返回的分钟几何数据。
- UI 状态：Windows 11 风格的系统字体和轻量视觉层级；45 分钟短课只显示课程名和时间，完整信息保留在 aria-label/title；重叠 lane 使用少量固定色差；大块空闲以小时/半小时网格呈现，不压缩时间。
- 窗口配置：默认 1280×800，最小尺寸配置 720×520；单一 `.timetable-scroll` 负责纵横滚动，不存在页面级双滚动条。
- Phase 2.1 状态：用户新增课程与 fixture 同时显示但有明确来源标记；新增数据仅在当前运行内存中，关闭即丢失。
- 尚未实现：课程编辑/删除、SQLite 持久化、PDF/教务导入、提醒、自启动、托盘、安装包。
- 已知非阻断项：Rust 的 linker_messages 创建库/对象输出警告仍存在，编译和运行正常。没有忽略失败测试。
- PDF：已有真实样本检查，15 条固定安排和 3 条非固定实践课程；原件不入 Git，实际钟点和学期起点仍需用户确认。
- 下一步：用户确认后才进入 Phase 2.2 编辑与删除，本轮停止。
- 验证详情：docs/phase-1-verification.md、docs/phase-2-verification.md。
- Git：验证通过后本地提交 feat: add validated course creation；具体提交号见 git log -1，不推送远端。

继续前阅读 CODEX.md、DESIGN.md 和验证记录；保留 Phase 1.1 的 Vite watcher 忽略规则。
