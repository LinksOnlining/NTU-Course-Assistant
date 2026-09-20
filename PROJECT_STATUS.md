# 项目状态

- 最后更新：2026-09-20
- 当前阶段：**v1.2.0 Release Candidate 收口中**。稳定性提交 `e4d38bb`（Settings / Schedule / Widget）和 `d106720`（Widget drag area）均经人工验收 PASS，除真实回归外保持冻结；已修复同步 settings-save 在 SQLite 等待时挤占 Tauri 命令运行时、连带阻塞 PDF 原生文件选择器的问题。后续白屏回归确认由 Widget 数据读取后台化与窗口元数据短暂不可用保护解决，用户已实机验证连续保存、作息保存和 PDF 选择器均正常；尚未创建 v1.2.0 tag 或发布 Release。
- v1.2.0 RC：Updater 使用 Tauri 官方签名、GitHub Releases HTTPS endpoint 和 Windows passive installer；启动后台检查、关于页手动检查、更新弹窗、进度、失败重试与 Release 回退均已实现。JSON 备份/恢复在单一 SQLite transaction 中处理课程、作息、学期、提醒、小组件逻辑设置和 5/7 天偏好，恢复后立即刷新 runtime、scheduler 与 widget；不备份 PDF、日志、处理历史、机器几何或 Autostart OS 状态。PDF 导入完成后显示基于实际 ImportPlan 的结果统计。正式签名 NSIS/MSI 及 `.sig` 本地产物已确认；最终 Windows 安装态人工验收与真实 GitHub Release updater E2E 待 RC 接受后完成。
- 阶段门禁：Phase 7.4 离屏恢复、保存回归修复、自动验证、开发态/安装态启动和 Windows 人工验收均已完成。双显示器移除与 DPI 切换未单独执行，保留为已有 physical geometry fallback 自动覆盖的 documented limitation，不阻断 V1。
- 已完成：Phase 0；Phase 1 全部；Phase 2 全部；Phase 2.5 节次显示；Phase 2.6 用户可配置作息；Phase 2.7 桌面时间轴与自适应课程文字。
- 核心规则：严格 HH:mm；课程 top/height 只由实际时间及 pxPerMinute 决定；07:00–22:00 轴保留真实空闲比例；重叠链由纯布局函数分配横向 lane；星期列始终为周一至周日。
- 验证 PASS：严格 typecheck、107 项 TypeScript 单元测试、44 项架构测试、33 项 Rust 测试、342 个 UI 场景（327 通过、15 项按设备/私有样本条件跳过）、clippy、oxlint、Prettier、npm run build、npm run verify 与 `npm run tauri build`。
- Desktop PASS：真实 Tauri 独立窗口完成 schema 3→4、due 后 handled 持久化、关闭重启后的去重和未来计划恢复；标题为“大学课程表”且进程响应正常。
- 测试配置：src/config/timetable.ts 中 TEST_TIMETABLE 明确 purpose=test-only，测试轴为 07:00–22:00、当前周为第 3 周、每分钟 1px；src/fixtures/courses.ts 全部为测试数据，不代表正式南通大学课表或作息。
- 架构：core 只依赖同层逻辑及共享纯类型，不访问 DOM/React/Tauri/系统 IO；组件只消费 core 返回的分钟几何数据。
- UI 状态：Windows 11 风格的系统字体和轻量视觉层级；页面、课程表、表头和时间轴使用低饱和薄荷、暖灰和米色的渐变层次，避免大面积纯色。左侧节次块分开展示节次、开始和结束时间，30 分钟的第一节也将开始/结束时间按上下两行置于节次下方；课程区移除内部网格和列分隔线，仅保留外框及课程卡片边界。课程卡片使用稳定低饱和色系，45 分钟短课仍显示名称、时间、教室和教师，并按高度/重叠宽度自适应缩小字号。大块空闲按真实比例保留。
- 窗口配置：默认 1280×800，最小尺寸配置 720×520；单一 `.timetable-scroll` 负责纵横滚动，不存在页面级双滚动条。
- Phase 2 状态：数据库由 `app_local_data_dir()` 自动创建，schema `user_version=4`；fixture 只在开发模式显示且从未写入数据库。损坏行逐条跳过并提示，不自动修改或删除；未来 schema 被拒绝且原数据不变；busy/write failure 不造成 UI/数据库分叉。`period_times` 在 1→2 migration、`app_settings` 在 2→3 migration、`handled_reminders` 在 3→4 migration 中安全创建。
- Phase 2.5–2.7 状态：`PeriodTime` 配置与 UI 解耦；作息要求第 1 节起连续编号、严格 HH:mm、节间不重叠且最多 30 节。test-only 作息可在设置中添加、修改和删除最后一节，并持久化到 SQLite；左轴按真实分钟显示节次与时间，时间轴自动按整点扩展，课间和午休不压缩。节次和课程 top 共享分钟计算，但课程区不绘制内部网格；只有精确匹配作息的 Course 才显示节次，修改作息不会改写已有课程时间。
- Phase 4：**CANCELLED BY USER**。教务系统导入及其后续调查不再是项目计划。
- Phase 5.1–5.4：TypeScript 以 `Asia/Shanghai` 生成稳定 occurrence key、UTC epoch 毫秒提醒计划及最小通知展示 payload；启动、数据变化与窗口恢复均会重建计划。Rust 单线程调度器只等待绝对时刻、通过 channel 刷新或取消旧计划、同一时刻批量处理并在当前会话去重；每分钟复核 wall-clock 处理 sleep/time-jump。`handled_reminders` 在通知尝试后跨重启去重，通知或持久化失败都只记录内部错误且不会令 scheduler 崩溃。官方 Tauri 通知适配器在 due 时发送“课程即将开始”，正文显示课程、时间和可选教室；它不读 Course、不重算教学周或课程日期。
- Phase 6：设置中的“启动设置”默认关闭，读取官方 autostart plugin 的系统实际状态；用户修改后立刻重新读取，失败或状态不一致不会显示伪成功。未增加 SQLite 字段、migration 或后台服务，schema 保持 4。官方 single-instance plugin 会将重复启动请求带回主窗口，避免重复 reminder scheduler。
- Phase 7.1：同一 Tauri 应用可创建唯一 label 为 `widget` 的独立小组件原型窗口。Rust 使用官方 `WebviewWindowBuilder` 的 `always_on_bottom(true)`，窗口无系统装饰、不进任务栏、不可缩放/最大化/最小化、创建时 `focused(false)`；重复请求仅 `show()` 已有窗口且不聚焦。关闭请求会隐藏小组件，不退出主应用。React 仅经 `src/services/widget-window.ts` 调用命令，原型不读取 Course、SQLite 或 reminder scheduler；未增加数据库、迁移、托盘、通知或第二进程。
- Phase 7.2：Widget 复用 `getTeachingWeek`、`generateCourseOccurrences` 和 `CourseOccurrence` 建立纯展示 ViewModel。默认“今日”按开始时间显示当前教学周当天课程，“本周”按周一至周日显示实际 occurrence；无教室省略、非教学周和未配置学期均有明确状态。主窗口在成功的课程 CRUD、PDF 批量导入或学期/作息保存后只发送 refresh 事件，widget 自行经现有 service 重读正式数据；每分钟刷新一次上海墙上时间，不创建 scheduler 或 notification。schema 保持 4。
- Phase 7.3：`WidgetSettings` 作为 `app_settings` 的 `widget_settings` JSON 保存，默认禁用、Today、未锁定且没有几何覆盖，schema 仍为 4。主设置可启停、选择模式和锁定；启用后只显示唯一 widget，关闭后隐藏。小组件自身可切换模式、锁定/解锁、打开主窗口或显式关闭。原生 move/resize 用 500ms debounce 保存位置和尺寸；启动仅在 enabled 时以不抢焦点方式恢复。两窗口通过无 payload settings event 各自重读设置，设置变化不影响课程、作息、提醒或 scheduler。
- Phase 7.4：窗口几何统一使用 Tauri physical position/size 保存和恢复，避免 DPI 单位混用；恢复时按当前 monitor work area 判断可见性，完整离屏则回到主屏工作区 40px 偏移。有效双屏位置与第二屏移除 fallback 已由纯 Rust 测试覆盖。保存回归修复确保作息保存无条件结束“保存中”，小组件仅在真实 move/resize 后保存边界，且 widget 获得所需 event 与拖拽权限；数据库锁在 SQL 后释放，窗口 API 不持锁调用。自由标题区域显式调用原生拖动，打开课程表会先恢复最小化主窗口再聚焦。Windows 人工验收确认普通/最大化遮挡、Win+D 实际行为、Alt+Tab、focus、drag/resize/lock、设置重启恢复和 single-instance；双屏移除与 DPI 切换未单独执行，作为不阻断的 documented limitation。**Phase 7.4 PASS / Phase 7 PASS。**
- Phase 8：正式图标源位于 `assets/branding/app-icon-source.png`；应用和安装包使用真实 multi-resolution ICO（16/24/32/48/64/128/256）及同品牌简化 Tray 图标。官方 Tauri tray 提供打开课程表、显示/隐藏 widget 与退出；主窗口 × 只隐藏，单实例、单 scheduler、单 tray 与最多一个 widget 保持不变。设置可发送不会改数据的 Windows 测试提醒，已由真实 Windows 人工观察 PASS。NSIS 安装态成功启动且 Start Menu 快捷方式指向安装态 EXE。**Phase 8 PASS。**
- Phase 9：用户人工体验验收已完成。课程卡片不再显示来源标记，内容按可用空间缩小字体；课程表主体上移；实际文字型课表 PDF 的导入复核通过。**Phase 9 PASS。**
- Phase 10：产品版本、Tauri 和 Cargo metadata 均为 `1.0.0`，schema 保持 `4`。发布版不再显示 fixture、原型或测试数据标签；未确认作息时仅提示用户设置实际作息。README、MIT LICENSE、隐私清理和 `.gitignore` 已完成。`npm run verify`、Rust 33 项测试、fmt、clippy 与 `npm run tauri build` 均通过；EXE、MSI、NSIS RC 已完成卸载、重装与唯一实例启动烟雾验收。**Phase 10 PASS / Version 1.0 Release Candidate ready。**
- Version 1.0 路线：Phase 5 课程提醒 → Phase 6 开机自启动 → Phase 7 桌面课程小组件 → 托盘 / 发布。Phase 7 使用同一 Tauri 应用的多窗口模式，复用 Course、PeriodTime、TermConfig 和 CourseOccurrence；不建立第二套课程模型，不使用置顶窗口或 Explorer/壁纸注入。
- 尚未实现：正式发布。
- 已知非阻断项：Rust 的 linker_messages 创建库/对象输出警告仍存在，编译和运行正常。没有忽略失败测试。
- PDF：已有真实样本检查，15 条固定安排和 3 条非固定实践课程；原件不入 Git，实际钟点和学期起点仍需用户确认。
- Phase 3.1 状态：新增 PDF.js 原始文本层提取与 Tauri Dialog/FS 适配器。提取结果只驻留 React 内存，保留文件名、页码、页面宽高、文本、x/y、文本宽高；不判断星期、课程、教室、周数或节次，不创建 Course，也不调用 SQLite。PDF.js CMap 在本机构建时从依赖复制到被忽略的 `public/pdfjs/cmaps`，用于中文字体映射。
- 真实 PDF 验证：同一两页样本原始提取得到 238 个块；清理两个只含无意义黑色符号的块后保留 236 个有效坐标文本块（第 1 页 150、第 2 页 86）。星期、课程、教师、教室、周数和节次均可提取；临时诊断文件已清理，未保存 PDF 原文或提取全文。
- Phase 3.2 状态：NTU PDF 纯解析器根据至少三个星期表头的相对坐标自动判断 x/y 星期轴，证据不足时不猜测；经确认布局可供后续页面复用。解析结果使用稳定来源 ID 和顺序，issues 带字段、severity、code 并去重。test-only 作息只产生 blocking issue，不生成正式时间。
- Phase 3.2 真实样本：逐字段核对得到 15 条固定安排和 3 条独立非固定实践候选，共 18 条；固定安排的课程名、星期、节次、周数、教室和页码全部与人工基准一致，教师字段 15/15 从明确标记边界提取。三条实践保留名称/周数，星期和节次为 null 并带 blocking issue。
- Phase 3.3 状态：正式 PDF 预览支持总数/固定/实践/ready/warning/blocking 动态统计、状态筛选、单条字段修正、来源定位、整批取消和最终提案摘要。修改值覆盖在不可变解析结果之上；保存作息后无需重新选择 PDF 即可重算。精确重复及已有/候选间时间冲突为 warning，不自动合并或删除。
- CourseProposal 状态：`prepareCourseProposal` 通过已确认 PeriodTime 映射时间并调用统一 `validateCourseInput`；提案只保留 candidateId 和无 id 的课程数据。test-only 作息、缺星期/节次/周数等继续 blocking；教室或教师缺失为 warning，warning 不阻止继续。
- Phase 3.4 状态：纯 `prepareImportPlan` 在生成 ID 前稳定计算写入、现有/批内重复跳过及时间冲突；正式确认时仅为待写入项生成一次 UUID 并再次通过统一校验。Rust `import_courses` 在单个 SQLite transaction 中再次校验并批量插入，任一失败整体回滚；React 只在成功返回后合并课程。
- Phase 3.4 Desktop 验收：备份真实 AppData 数据库后，在 Tauri 独立窗口补齐 3 条实践并将 18 条课程一次写入；`load_courses` 返回 18，当前周立即显示 12 张用户卡片。正常关闭重启后仍恢复 18；再次导入同一 PDF 得到重复 18、写入 0，数据库保持 18。全过程 `period_times=12`、`user_version=2`、integrity=ok，页面/控制台无错误；验收后已恢复原始数据库为 courses=0。
- v1.1.0 RC2：新增作息后续节次联动、教学周切换、5/7 天视图、当前星期高亮、分钟级当前时间线、首次当前时间定位、离线 OCR 和统一单节时长。设置写入采用数据库回读，小组件采用字段级 patch；用户已确认设置保存问题修复。真实三页 PDF 经当前源码及生产前端构建均得到 3 页、260 个文本块、17 条固定安排和 3 条非固定实践，且不再把课程元数据中的“训练”误判为实践。schema 保持 4。
- 下一步：**Version 1.0 开发阶段正式结束；v1.1.0 已发布到 Public GitHub Release，后续 Version 2 等待用户重新启动需求。**
- 验证详情：docs/phase-1-verification.md、docs/phase-2-verification.md、docs/phase-2-5-verification.md、docs/phase-2-6-verification.md、docs/phase-2-7-verification.md、docs/phase-3-1-verification.md、docs/phase-3-2-verification.md、docs/phase-3-3-verification.md、docs/phase-3-4-verification.md、docs/phase-5-1-verification.md、docs/phase-5-2-verification.md、docs/phase-5-3-verification.md、docs/phase-5-4-verification.md、docs/phase-6-verification.md、docs/phase-7-1-verification.md、docs/phase-7-2-verification.md、docs/phase-7-3-verification.md、docs/phase-7-4-verification.md、docs/phase-8-verification.md、docs/phase-9-verification.md、docs/phase-10-verification.md。
- Git：Phase 3.1–3.4 的改动按特别规则合并为一个稳定提交；未创建 tag，未 push。

继续前阅读 CODEX.md、DESIGN.md 和验证记录；保留 Phase 1.1 的 Vite watcher 忽略规则。

- v1.1.1: 修复已安装版 PDF.js 中文 CMap 资源被 CSP 拦截导致的课表识别失败。
