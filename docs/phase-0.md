# Phase 0 检查与开发路线

检查日期：2026-09-08。

## 项目检查

- AI_Project_Template 存在；已阅读根目录规则、README、DESIGN、PROJECT_STATUS、CHANGELOG、历史 CHANGE_PLAN、ADR、package.json，并检查源码职责和 Git。
- 模板 Git HEAD：5996c5b。两个带中文说明后缀的新规则文件未跟踪；保持原样。
- 指定旧项目 NTU-Course-Assistant 在本次初始化前不存在。旁边 campusplan 目录为空，没有可复用旧课程表模块。
- 模板是库 + CLI 骨架，核心只回传配置和输入，没有桌面、课程、PDF 或提醒业务。
- 值得复用：纯 core 边界、types/config/adapters 职责、针对性测试与统一 verify、精确依赖锁定、EditorConfig、Git/文档习惯。
- 不直接复制 CLI、identity 兼容 API、旧测试、历史变更计划或模板 Git 历史。后续按桌面业务重写构建配置与边界测试。
- 文档遗留：DESIGN/PROJECT_STATUS 保留 TestProject 名称；状态文件含复制说明和代码围栏；package 版本 0.1.0 与 CHANGELOG 0.2.0 不一致；README 仍写多人协作；模板规则样例的 Phase 编号不符合本产品路线。新项目使用用户本轮路线。
- Node v24.19.0、npm 11.17.0、Git 可用；PATH 未发现 cargo/rustc，用户默认 cargo 路径也不存在；标准位置未发现 vswhere。不能认定所有自定义安装位置都没有工具。Phase 1 先检查/补齐 Rust MSVC、C++ Build Tools 和 WebView2；本轮不安装。
- 模板历史测试成绩没有在本轮复跑，不能算本项目 PASS。

结论：在 `<workspace-root>/NTU-Course-Assistant` 新建项目，选择性沿用模板规范，独立 Git。当前仅创建文档和基础文本配置，不实现 Phase 1。

## 开发顺序与阶段边界

| 阶段 | 小步顺序 | 阶段验收 |
| --- | --- | --- |
| Phase 1 最小课程表 | 1.1 工具链和桌面空壳 → 1.2 模型及分钟计算 → 1.3 七天时间轴和卡片 → 1.4 实机检查修复 | 测试数据真实时间布局，构建与桌面运行通过 |
| Phase 2 数据管理 | 校验及添加 → 编辑/删除 → SQLite 事务保存 → 重启恢复 | CRUD、损坏/写入失败不丢原数据、关闭重开恢复 |
| Phase 3 PDF | 真实样本和文字提取 → NTU 规则 → 异常预览/修正 → 确认事务导入 | 内容核对、异常可见、取消零写入、重复导入可控 |
| Phase 4 教务导入 | 官方入口调研 → 合法数据取得验证 → 确定方案 → 预览导入 | 来源有证据、不绕认证、不存密码、复用统一模型 |
| Phase 5 提醒 | 学期/作息配置 → 15 分钟计算 → Rust 驻留调度 → 安装态通知 | 周数及日期正确、重启去重、休眠恢复、不报已结束课程 |
| Phase 6 自启动 | 状态检测 → 启用/关闭 → 重启程序及登录验证 | 默认关闭、系统真实状态一致、用户登录可启动 |
| Phase 7 UI 优化 | 字体/卡片/间距 → 窗口缩放 → 深色模式 → 综合回归 | 不改变时间比例、易读、无溢出、基础功能不退化 |

每个小阶段验证失败自动修复后重测；每个大阶段更新文档并本地提交，然后停止。PDF 样本和正式作息只在进入相关阶段时取得，不阻塞测试课程的 Phase 1。

## Phase 1 准备创建/修改的文件

下面均为计划，不代表文件已经存在。

| 文件 | 职责 |
| --- | --- |
| package.json、package-lock.json | React/Vite/Tauri 开发依赖和 verify/build/dev 命令 |
| tsconfig.json、tsconfig.node.json、vite.config.ts | 严格类型和前端构建 |
| eslint.config.js | 风格、React 与 core 依赖边界 |
| index.html、src/main.tsx、src/App.tsx | 入口和课程表页面编排 |
| src/types/course.ts | Course 最小契约 |
| src/core/time.ts、src/core/timetable-layout.ts | 分钟转换、周过滤、卡片位置及冲突布局 |
| src/config/timetable.ts | 轴范围、缩放和显式测试教学周 |
| src/fixtures/courses.ts | 明确标注的虚构课程，包括冲突、长名称和空闲时段 |
| src/components/Timetable.tsx、src/components/CourseCard.tsx、src/styles.css | 七日列、小时刻度、卡片、滚动和可访问性 |
| src-tauri/Cargo.toml、Cargo.lock、build.rs | 最小 Rust/Tauri 宿主构建 |
| src-tauri/src/main.rs、src-tauri/src/lib.rs | 桌面启动，不注册未来功能插件 |
| src-tauri/tauri.conf.json、capabilities/default.json、icons/ | 窗口、最小权限和打包资源 |
| tests/unit/time.test.ts、timetable-layout.test.ts | 真实时间差、周过滤、相接与冲突布局 |
| tests/architecture/core-boundaries.test.ts | core 不访问 UI 或系统 IO |
| tests/ui/timetable.spec.ts、playwright.config.ts | 浏览器布局断言，不能替代桌面实测 |
| README.md、DESIGN.md、PROJECT_STATUS.md、CHANGELOG.md | 实际命令、验证结果、已知限制 |

纯逻辑测试优先 Node 内置 node:test，UI 几何验证使用 Playwright 开发依赖；不使用快照冒充布局验证。Phase 1 不创建存储、导入、提醒、自启动模块。

## Phase 1 测试方案

1. 分钟计算：轴起点 07:00、比例 1 px/min 时，08:00 top=60；08:00–08:45 height=45；10:00 结束至 14:00 开始空白=240。不同缩放下保持同一时间比例。
2. 同日边界相接不冲突，真实重叠并排且无文字遮挡；不同星期或无共同周数不算冲突。测试嵌套重叠和链式重叠。
3. 周一/周日、上午/下午/晚间、空日、长中文名、短课程和无效时间输入。超出默认轴范围应扩展可视范围或明确提示，不静默裁掉课程。
4. 浏览器读取元素矩形断言 top/height/空白，容许像素舍入误差；验证实际 CSS 几何与计算一致。
5. Windows 桌面启动、缩放、滚动和键盘焦点；1280×800、900×600，以及 Windows 125%/150% 缩放下查看文字和卡片。无法执行的检查明确记录，不宣布完整 PASS。
6. typecheck、lint、format、单元/架构/UI 测试、前端 build、Rust fmt/check/clippy、Tauri build 与桌面启动均实际验证。记录时间和结果；UI 浏览器 PASS 不等于 Tauri 运行 PASS。

## Phase 0 验收范围

只核对目录事实、文档完整性、相对链接、模型/路线/测试计划、无业务源码和独立 Git。编译、应用运行、功能测试为 N/A（尚无应用代码）。不声称模板测试、本机桌面构建环境或未来功能已通过。
