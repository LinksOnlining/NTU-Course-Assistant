# 项目状态

- 最后更新：2026-09-10
- 当前阶段：**Phase 3 PASS**；Phase 1、Phase 2、Phase 2.5–2.7、Phase 3.1–3.4 均为 PASS。
- 阶段门禁：Phase 3 已完成 PDF 提取、NTU 结构识别、预览修正、最终确认和 SQLite 原子批量写入；本轮停止，不进入 Phase 4 教务系统导入。
- 已完成：Phase 0；Phase 1 全部；Phase 2 全部；Phase 2.5 节次显示；Phase 2.6 用户可配置作息；Phase 2.7 桌面时间轴与自适应课程文字。
- 核心规则：严格 HH:mm；课程 top/height 只由实际时间及 pxPerMinute 决定；07:00–22:00 轴保留真实空闲比例；重叠链由纯布局函数分配横向 lane；星期列始终为周一至周日。
- 验证 PASS：严格 typecheck、98 项 TypeScript 单元测试、37 项架构测试、17 项 Rust 测试、288 个 UI 场景（274 通过、14 项按设备/私有样本条件跳过）、clippy、oxlint、Prettier、npm run build、npm run verify。
- Desktop PASS：真实 Tauri WebView 使用 schema 2 和已保存的 12 节作息；在 Windows 200% DPI 下确认节次块和课程块同按分钟对齐，45 分钟卡片保留名称、时间、教室和教师，页面/控制台无错误。
- 测试配置：src/config/timetable.ts 中 TEST_TIMETABLE 明确 purpose=test-only，测试轴为 07:00–22:00、当前周为第 3 周、每分钟 1px；src/fixtures/courses.ts 全部为测试数据，不代表正式南通大学课表或作息。
- 架构：core 只依赖同层逻辑及共享纯类型，不访问 DOM/React/Tauri/系统 IO；组件只消费 core 返回的分钟几何数据。
- UI 状态：Windows 11 风格的系统字体和轻量视觉层级；页面、课程表、表头和时间轴使用低饱和薄荷、暖灰和米色的渐变层次，避免大面积纯色。左侧节次块分开展示节次、开始和结束时间，30 分钟的第一节也将开始/结束时间按上下两行置于节次下方；课程区移除内部网格和列分隔线，仅保留外框及课程卡片边界。课程卡片使用稳定低饱和色系，45 分钟短课仍显示名称、时间、教室和教师，并按高度/重叠宽度自适应缩小字号。大块空闲按真实比例保留。
- 窗口配置：默认 1280×800，最小尺寸配置 720×520；单一 `.timetable-scroll` 负责纵横滚动，不存在页面级双滚动条。
- Phase 2 状态：数据库由 `app_local_data_dir()` 自动创建，schema `user_version=2`；fixture 只在开发模式显示且从未写入数据库。损坏行逐条跳过并提示，不自动修改或删除；未来 schema 被拒绝且原数据不变；busy/write failure 不造成 UI/数据库分叉。`period_times` 在 1→2 migration 中安全创建，作息保存使用事务。
- Phase 2.5–2.7 状态：`PeriodTime` 配置与 UI 解耦；作息要求第 1 节起连续编号、严格 HH:mm、节间不重叠且最多 30 节。test-only 作息可在设置中添加、修改和删除最后一节，并持久化到 SQLite；左轴按真实分钟显示节次与时间，时间轴自动按整点扩展，课间和午休不压缩。节次和课程 top 共享分钟计算，但课程区不绘制内部网格；只有精确匹配作息的 Course 才显示节次，修改作息不会改写已有课程时间。
- 尚未实现：教务系统导入、提醒、自启动、托盘、安装包。
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
- 下一步：停止等待用户确认；不自行进入 Phase 4（南通大学教务系统导入）。
- 验证详情：docs/phase-1-verification.md、docs/phase-2-verification.md、docs/phase-2-5-verification.md、docs/phase-2-6-verification.md、docs/phase-2-7-verification.md、docs/phase-3-1-verification.md、docs/phase-3-2-verification.md、docs/phase-3-3-verification.md、docs/phase-3-4-verification.md。
- Git：Phase 3.1–3.4 的改动按特别规则合并为一个稳定提交；未创建 tag，未 push。

继续前阅读 CODEX.md、DESIGN.md 和验证记录；保留 Phase 1.1 的 Vite watcher 忽略规则。
