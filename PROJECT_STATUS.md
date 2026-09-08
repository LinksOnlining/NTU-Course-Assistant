# 项目状态

- 最后更新：2026-09-09
- 当前阶段：Phase 1.2 PASS（最小 Course 模型与时间计算）；Phase 1 整体尚未完成。
- 阶段门禁：停止等待用户确认，不进入 Phase 1.3。
- 已完成：Phase 0；Phase 1.1 桌面空壳；Phase 1.2 只读 Course/TimeRange/PeriodTime 类型、纯分钟计算、按星期及周数判断课程重叠、测试时间配置、单元及架构测试。
- 核心规则：严格 HH:mm，非法时间/非正持续时间抛 RangeError；相邻课程零空闲且不重叠；重叠的空闲量为零；超出时间轴明确报错，不裁剪。位置只由实际时间计算，不依赖数组顺序或节次。
- 验证 PASS：严格 typecheck（含类型反例及无 DOM 核心检查）、36 项单元测试、23 项架构测试、npm run build、npm run verify、修改文件 Prettier 检查。
- Desktop PASS：停止旧开发会话后重新执行 npm run tauri dev，Rust 编译成功，独立 Windows 窗口 id 198634，截图及可访问性文本确认原空壳正常显示。不是浏览器替代验证。
- 测试配置：src/config/timetable.ts 中 TEST_TIMETABLE 明确 purpose=test-only，只含测试轴和两条节次样例；不代表正式南通大学作息，未接入 UI。
- 架构：core 只依赖同层逻辑及共享纯类型，不访问 DOM/React/Tauri/系统 IO；测试用 oxc-parser 是新增开发依赖，没有新增生产依赖。
- 尚未实现：正式课程表 UI、手动录入和完整外部 Course 校验、存储、PDF/教务导入、提醒、自启动、托盘、安装包。
- 已知非阻断项：Rust 的 linker_messages 创建库/对象输出警告仍存在，编译和运行正常。没有忽略失败测试。
- PDF：已有真实样本检查，15 条固定安排和 3 条非固定实践课程；原件不入 Git，实际钟点和学期起点仍需用户确认。
- 下一步：用户确认后才进入 Phase 1.3，本轮停止。
- 验证详情：docs/phase-1-verification.md。
- Git：验证通过后本地提交 feat: add course model and time calculations；具体提交号见 git log -1，不推送远端。

继续前阅读 CODEX.md、DESIGN.md 和验证记录；保留 Phase 1.1 的 Vite watcher 忽略规则。
