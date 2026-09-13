# 变更记录

## 1.1.0 Release Candidate — 2026-09-14

### Added

- 支持修改某节作息时间时自动联动后续节次，并保留后续节次的时长和课间。
- 增加教学周前后切换、回到本周，以及 5 天 / 7 天课表视图。
- 增加当前星期高亮、当前时间线和首次打开课表时的当前时间定位。
- 增加完全离线的扫描 PDF OCR 回退，识别资源随应用安装，不上传 PDF。
- 作息编辑器可将 20–120 分钟的统一单节时长应用到当前草稿，并保留节间间隔。

### Changed

- 首页副标题更新为“本周课表已上线，早七点五十人的苦难开启🔛”。
- 移除首页“已使用自定义作息。”提示。

### Fixed

- 区分无文字层的 PDF 与已读取文字但课表结构无法识别的 PDF，避免错误提示为扫描版。
- 作息、小组件及其他设置采用写入后回读；小组件使用字段级 patch，避免延迟的窗口几何写入覆盖较新的开关、模式或锁定状态。用户已确认设置保存恢复正常。
- 修复真实三页课表中课程元数据里的“训练”字样被误判成独立实践课程的问题；实践候选现在同时要求实践语义和“（共 N 周）”结构标记。该样本稳定得到 17 条固定安排和 3 条非固定实践候选。

## 1.0.0 Release Candidate — 2026-09-13

- **Phase 10 PASS**：统一 `1.0.0` 版本、正式产品名称和 Windows bundle metadata；生产界面不再展示 fixture、原型或测试数据。新增正式 README、MIT LICENSE、发布清理与 RC 验证记录；完成 EXE、MSI、NSIS 构建和卸载/重装烟雾验收。
- **Phase 9 PASS**：移除正式课程卡片的“用户添加”来源标记；课程内容随可用空间缩小字体；课程表主体上移。实际课表 PDF 的文字层导入复核通过。

- **Phase 8 PASS**：使用 `assets/branding/app-icon-source.png` 生成正式应用图标、包含 16/24/32/48/64/128/256 图层的 `.ico` 与同品牌简化 Tray 图标；release EXE、MSI、NSIS 和 Start Menu 快捷方式均使用正式资源。
- 新增官方 Tauri Tray：主窗口 × 改为隐藏，Tray 可恢复主窗口、显示/隐藏唯一桌面小组件，且“退出程序”才结束应用。单实例、单 scheduler、schema 4 与 autostart 保持不变。
- 设置新增不修改任何课程或计划的“发送测试提醒”，真实 Windows Toast 已人工确认。完成 107 项 TypeScript 单元、44 项架构、327 项 UI（15 项条件 skip）、33 项 Rust、verify、fmt、clippy 和 NSIS 安装态启动验证。

- **Phase 7 PASS / Phase 7.4 PASS**：完成 Windows 人工验收。Widget 正常显示，普通及最大化窗口能够遮挡，Alt+Tab 不出现，创建不抢焦点，drag/resize/lock、设置保存与重启恢复、single-instance 均通过。Win+D 时 Widget 隐藏，恢复应用后仍按底层窗口规则被普通窗口遮挡；该实际行为作为 V1 可接受限制记录。真实双显示器移除与 DPI 切换未单独执行，由 existing physical-geometry fallback 自动覆盖并作为 documented limitation 保留。
- 修复设置保存可能永久显示“保存中…”的问题：作息表单在所有结束路径恢复可操作状态；小组件边界只在原生移动或缩放后保存，避免设置事件触发的重复写入。补齐 widget 的事件监听与拖拽权限，数据库锁在 SQL 结束后释放再执行窗口操作。Widget 改为从自由标题区域显式调用原生拖动；“打开课程表”会恢复并聚焦最小化的主窗口。

- **Phase 7.3 PASS**：桌面课程小组件默认关闭，并可持久化启用、Today/Week、锁定、位置与尺寸；应用启动仅在 enabled 时无焦点恢复。复用 schema 4 的 `app_settings`，没有 migration、Course、scheduler 或通知变更。
- 主设置和 Widget 控制均通过成功写入后的轻量事件同步；move/resize 使用 500ms debounce，保存失败不伪成功且不影响当前窗口继续使用。

- **Phase 7.2 PASS**：Widget 新增默认“今日”和可切换“本周”课程展示，复用 TermConfig、教学周核心和 CourseOccurrence；Today 按开始时间排序并省略空教室，学期外、未配置学期和无课均有明确状态。主窗口成功写入后只发送 refresh 事件，widget 经既有 service 重读数据；每分钟刷新 Shanghai 时间，不增加 scheduler、通知、SQLite schema 或 Widget 状态持久化。

- **Phase 7.1 PASS**：新增同一 Tauri 应用内唯一的底层小组件原型窗口。官方 `WebviewWindowBuilder` 以无装饰、跳过任务栏、固定大小、`always_on_bottom(true)` 与 `focused(false)` 创建；重复打开只显示已有窗口且不抢焦点，关闭请求隐藏小组件并保留主窗口。原型只显示静态文本，不读课程/SQLite/提醒，也没有托盘、今日/本周、窗口状态持久化或第二进程。
- 新增窗口 service、静态原型入口、架构与 UI 回归。真实 Windows 开发窗口验证主窗口与普通窗口覆盖小组件、重复触发保持单一小组件和单一进程、关闭小组件不退出主应用。

- **Phase 6 PASS**：使用官方 Tauri autostart plugin 实现当前用户登录后的自动启动。设置中的独立“启动设置”默认关闭，打开/返回设置时查询系统实际状态，启用或关闭后立即复读；失败与状态不一致不会显示伪成功。未修改 SQLite schema（仍为 4），未添加后台服务、托盘或隐藏窗口。
- 为防止自动启动和手动启动并发产生重复提醒，新增官方 single-instance plugin；后续启动显示并聚焦现有主窗口。新增浏览器 adapter UI 回归，覆盖 enable/disable 成功、两类失败以及复读不一致。
- 本机 Windows 安装态验证：NSIS 包成功安装；开关真实创建并清除当前用户启动项；重复启动仍只有一个应用进程。验收后自动启动恢复为关闭，测试安装已卸载；未强制注销或重启开发机。

- **Phase 5 PASS / Phase 5.4 PASS**：提醒计划会在启动、数据变化和窗口恢复时由 TypeScript core 重建。新增 schema 3→4 migration 的最小 `handled_reminders` 表，在 notification delivery attempt 后记录 occurrence key 与时间，跨重启排除已处理提醒；写入失败不会使 scheduler 停止，当前 session 仍保持去重。scheduler 每分钟复核绝对 wall-clock，覆盖应用存活期间的休眠恢复和明显系统时间跳变。
- 0→4、1→4、2→4、3→4 迁移链、未来版本拒绝、handled 保留清理、restart/catch-up/already-started、same-trigger 和持久状态失败均有回归覆盖。Phase 5 总验收通过：105 项 TypeScript 单元、39 项架构、282/297 UI（15 条既有条件 skip）、28 项 Rust、typecheck、lint、format、build、verify、fmt 与 clippy 均 PASS。
- **Phase 4 CANCELLED BY USER**：不再继续教务系统导入或相关调查。
- **Phase 5.1 PASS**：新增学期配置、提醒提前量和纯逻辑课程实例/提醒时刻计算；SQLite schema 迁移至 3，`app_settings` 与作息使用同一事务保存。当前不发送系统通知，不进入 Phase 5.2。
- **Phase 5.2 PASS**：Rust 单实例调度器接收 TypeScript 提供的 occurrence key、绝对 UTC epoch 毫秒 trigger 和课程开始时刻；channel refresh 会替换旧等待，同一 trigger 会批量 due，当前会话按 key 去重。真实 Tauri 进程已验证两条短时未来计划按顺序各触发一次。当前仍未发送 Windows 系统通知。
- **Phase 5.3 PASS**：接入官方 Tauri notification plugin。最小计划 payload 包含课程名、开始时间和可选教室；Rust notification adapter 在 due 时发送“课程即将开始”。同一时刻的每条 due 各自发送，失败只记录日志且不会停止后续提醒。
- **Version 1.0 路线更新**：新增 Phase 7 桌面课程小组件。该阶段将以同一 Tauri 应用的底层多窗口展示今日或本周课程，复用既有领域模型；不使用置顶窗口、壁纸注入或第二套课程数据模型。

- **Phase 3 PASS / Phase 3.4 PASS**：新增正式导入确认页，逐条展示课程字段与普通、警告、重复、冲突统计；返回修改保留候选修正，整批取消零写入，blocking 禁止确认，warning 和真实时间冲突允许保留。
- 新增纯 `prepareImportPlan`：按名称、星期、实际时间和周数跳过现有及批内精确重复，同名不同安排继续写入；只为最终待写入项生成一次 UUID，并再次通过统一课程校验。
- Rust 新增单次 `import_courses` command 和 SQLite transaction。批量写入前逐条复校 Course，任一非法记录或唯一约束失败均回滚全批；返回实际写入的 Course[] 后 React 才更新，失败留在确认页并可用同一批 ID 重试。
- 自动验证新增计划确定性、重复/冲突、最终 ID、失败重试、控件锁定、成功/重复提示和批量事务测试。98 项单元、37 项架构、288 个 UI 场景（274 通过、14 项条件跳过）、17 项 Rust 测试以及 typecheck、lint、format、build、verify、fmt、clippy 全部通过。
- 真实 Tauri 独立窗口完成 0→18 原子导入、立即显示、正常关闭重启恢复和第二次重复 18/写入 0；数据库始终保持 schema 2 和 12 条作息。验收前备份并在结束后恢复原数据库，临时脚本、备份、截图和样本副本均已清理。
- **Phase 3.3 PASS**：将开发候选列表升级为正式 PDF 预览，提供 18 条真实候选的固定/实践及 ready/warning/blocking 动态统计、筛选、详情、来源位置、单条修正、整批取消和无写入的最终提案摘要。
- 新增纯 `prepareCourseProposal` / `evaluateImportCandidates` 边界：只有已确认作息才能把节次映射为时间，所有提案继续经过 `validateCourseInput`；CourseProposal 不含正式 Course ID。候选修改以覆盖层保存，不修改 parser 原始结果；保存作息后立即重新计算，无需重新选择 PDF。
- 实现精确重复和时间冲突提示。只有名称、星期、实际时间和周数完全相同才标记重复；同名不同时间/周数不视为重复；已有课程及候选之间的重叠只产生 warning，不自动合并或拒绝。
- 新增提案、test-only 作息、实践补齐、空教室警告、编辑取消、重复/冲突、确定性、零存储依赖和真实 PDF 预览交互测试。94 项单元、36 项架构、288 个 UI 场景（274 通过、14 项条件跳过）、12 项 Rust 测试以及 typecheck、lint、format、build、verify 全部通过。
- 真实 Tauri 独立窗口完成 18 条候选预览、编辑取消、实践修正和整批取消。SQLite 前后均为 0 门课程、12 条相同用户作息、schema 2。按 Phase 3 规则未提交 Git，未进入 Phase 3.4 或正式写入。
- **Phase 3.2 PASS**：完成 NTU PDF → ImportCandidate[] 纯解析边界。解析器从星期表头相对坐标自动判断 x/y 列轴，证据不足时不猜测；固定课程按节次锚点和相邻标题块聚类，实践文本按独立来源块及分隔结构保留为阻断候选，不使用课程名白名单或目标数量硬切。
- 真实两页样本逐字段核对为 15 条固定安排、3 条非固定实践，共 18 条候选；固定安排的课程名、星期、节次、周数、教室和页码与人工基准一致，教师字段从明确的教师/职称边界提取。连续、单双和离散周数以及未排地点均已覆盖。
- ImportCandidate 使用来源派生的稳定 ID 与确定性顺序；ImportIssue 具有 code、field、severity 和稳定去重。test-only PeriodTime 不生成正式时间，所有固定安排继续提示确认作息；实践候选不伪造星期、节次或时间。
- 新增去隐私坐标 fixture、axis x/y/证据不足、实践拆分、字段解析、确定性和 issue 测试。85 项单元、33 项架构、279 个 UI 场景（273 通过、6 项既有条件跳过）、12 项 Rust 测试以及 typecheck、lint、format、build、verify 全部通过。
- 真实 Tauri 桌面窗口显示 18 条候选且课程表未修改；解析前后 SQLite 均为 0 门课程、12 条用户作息、schema 2。按 Phase 3 规则未提交 Git，未进入预览确认、Course 创建或 SQLite 导入。
- **Phase 3.1 PASS**：新增只读 PDF 基础提取。Tauri 文件对话框只允许 `.pdf`；PDF.js 提取每页尺寸及原始文本块的页码、x/y、宽高。结果只显示文件名、页数和文本块数，开发模式可查看少量坐标预览；未创建 Course、未写 SQLite、未实现学校课程规则。
- 按用户确认，PDF 中无语义的黑色 `■/▲/◆` 标记在文本规范化时移除，并在单元测试中覆盖；不参与后续课程识别。
- 增加中文 CMap 构建资源、文字型/损坏/非 PDF/无文本层的测试，以及真实两页样本验证。真实 Windows Tauri 窗口已通过系统文件选择完成只读提取，确认 2 页、238 个文本块且用户课程仍为 0。样本和全文始终不进 Git；等待用户确认，不进入 Phase 3.2。
- **Phase 2.7 PASS**：优化 Windows 桌面课程表的时间轴与课程对应关系。左侧以节次和完整时间段分层显示，30 分钟的第一节也把时间段置于节次下方；课程区移除了内部网格、节次引导线和列分隔线，课间、午休和连续分钟比例保持不变。
- 页面背景改为低饱和薄荷、暖灰和米色的柔和渐变；课程表、表头和时间轴使用同一套浅色层次，避免大面积纯色。第一节的开始和结束时间也改为与其他节次一致的上下两行。
- 课程卡片改为宽松的桌面内边距、低饱和稳定配色和更清晰的信息层级。短课与重叠卡片根据高度及可用宽度自适应缩小字号，不再隐藏教室或教师，也不使用文本省略号；课程高度没有改变。
- 新增 UI 回归，覆盖节次块与精确课程的 top/height 对齐、作息修改后课程时间不变、无内部网格、舒适日列宽度及 45 分钟卡片完整字段。
- 73 项 TypeScript 单元、29 项架构、261 个 UI 场景（255 通过、6 项条件跳过）、12 项 Rust 测试及 typecheck、clippy、lint、format、build、verify 全部通过。真实 Tauri Windows 200% DPI 窗口确认纵横滚动、sticky、节次/课程分钟对齐和短卡片文本可读。
- 本阶段没有进入 PDF、教务导入、提醒、自启动、托盘或 Phase 3。

- **Phase 2.6 PASS**：新增比例节次时间轴和用户可配置作息。左侧节次块按真实分钟计算 top/height，课间、午休和课程真实时间保持不变；时间轴会按作息覆盖范围自动扩展到整点。
- 新增“设置”作息对话框，可编辑时间、添加下一节、删除最后一节，严格校验第 1 节起连续编号、HH:mm、开始早于结束、最多 30 节和节间不重叠；没有作息时明确使用 test-only fallback，不宣称为南通大学正式作息。
- SQLite schema 由 1 安全迁移到 2，新增 `period_times` 表和 `load_period_times`/`save_period_times` command；作息替换使用事务，失败保留上一份配置，已有 Course 的实际 startTime/endTime 不被改写。只有精确匹配当前作息的课程显示节次。
- 73 项 TypeScript 单元、29 项架构、252 个 UI 场景（246 通过、6 项条件跳过）、12 项 Rust 测试及 typecheck、clippy、lint、format、build、verify 全部通过。真实 Tauri Windows 窗口完成设置保存、关闭重启恢复、比例几何和 0 门用户课程验收。
- 本阶段没有进入 PDF、教务导入、提醒、自启动、托盘或 Phase 3。

- **Phase 2.5 PASS**：新增 1–11 节 test-only 作息配置，左侧连续时间轴显示“第 N 节”和对应开始/结束时间；所有节次位置及高度均由真实分钟决定，课间与午休不压缩。
- 新增纯 `PeriodTime` 校验及 period→time、period range→time range、精确 time range→period range 映射；拒绝非法/重复/乱序/重叠配置，不对手动课程猜测节次。
- 课程卡片只在已有 `startPeriod/endPeriod` 时显示节次；清理与测试时间不一致的旧 fixture 节次字段，课程时间和几何保持不变。
- 72 项 TypeScript 单元、29 项架构、225 项 UI 场景（219 通过、6 项条件跳过）、9 项 Rust 测试及 typecheck、clippy、lint、format、build、verify 全部通过。真实 Tauri 200% DPI 窗口验证节次可读、5/20 分钟课间、sticky 与滚动正常。

- **Phase 2 PASS**：完成 Phase 2.4 持久化健壮性、恢复验证与 Phase 2 总验收；没有进入 PDF、教务导入、提醒、自启动或 Phase 3。
- 新增独立 SQLite 测试，覆盖数据库不存在时自动建库、关闭重开、混合坏记录隔离且原行保留、未来 `user_version` 拒绝且数据不变、3 秒 busy timeout 和写失败无数据损坏。
- 数据库初始化失败继续打开应用并禁用写入；未来 schema 向用户显示升级提示，内部错误仅写日志。新增/编辑/删除失败均验证 UI 保留原状态。
- 64 项 TypeScript 单元、28 项架构、9 项 Rust 数据库、207 项 UI 场景（201 通过、6 项条件跳过）及 typecheck、clippy、lint、format、build、verify 全部通过。真实 Tauri 从数据库不存在开始完成四轮启动和添加/编辑/删除重启恢复，原数据库随后恢复。

- **Phase 2.3 PASS**：使用 bundled rusqlite 在 Tauri Rust 边界实现课程加载、新增、更新和删除；数据库由 `app_local_data_dir()` 定位，fixture 不入库。
- 新增单表 schema 与事务化 `user_version` 0→1 migration；weeks 以严格验证的 JSON 保存，null 教师/教室/节次完整往返。损坏记录跳过并提示，不修改原数据；数据库错误不提前改变 UI。
- 添加、编辑和删除均改为 SQLite 成功后更新 React；启动自动加载用户课程。生产构建隐藏 fixture，开发浏览器保留内存测试 adapter。
- 64 项 TypeScript 单元、28 项架构、7 项 Rust 数据库、9 组窗口/缩放矩阵中的 183 项 UI 测试以及 clippy、lint、format、build、verify 全部通过。真实 Tauri AppData 数据库完成添加/编辑/删除及四轮启动恢复验收。
- 本阶段没有进入 Phase 2.4、PDF、教务导入、提醒、自启动或其他后续功能。

- **Phase 2.2 PASS**：同一课程表单支持编辑预填与统一校验，修改名称、星期、时间和周数后按原 ID 更新并立即重排；取消保持原记录不变。
- 用户课程提供键盘可达的编辑入口和应用内删除确认；fixture 不渲染操作入口。取消删除零修改，确认删除按 ID 移除，重叠课程 lane 随即重新计算。
- 64 项单元、26 项架构、9 组窗口/缩放矩阵中的 165 项 UI 测试以及 lint、format、build、verify 全部通过。真实 Tauri WebView 完成指定课程添加、编辑、ID 保留、120px/90px 几何、删除与重启空状态验收。
- 本阶段仍为内存状态，没有实现 SQLite、数据文件或任何 Phase 2.3+ 功能。

- **Phase 2.1 PASS**：新增课程添加入口和字段级错误表单；合法课程立即按星期和真实分钟几何进入现有时间轴，取消保持零修改。
- 新增共享 `validateCourseInput` 与 `parseWeeks` 纯逻辑，支持 1–30 周范围/离散/混合输入、排序去重、严格时间、星期和文本校验；未知节次、教师、教室不再编造。
- fixture 与用户添加课程具有明确来源标记；界面说明新增课程当前仅保存在内存，重启后按预期消失。未实现编辑、删除、SQLite 或其他 Phase 2.2+ 功能。
- 63 项单元、26 项架构、9 组窗口/缩放矩阵中的 111 项 UI 测试以及 lint、format、build、verify 全部通过。真实 Tauri WebView 完成周三 14:00–15:30 课程录入，偏移 420px、高度 90px，正常重启恢复为空。

- **Phase 1 PASS**：完成 Windows Tauri 桌面基础、最小 Course/时间计算、七天时间轴 UI、真实时间比例、空闲时段保留和重叠课程分栏。
- Phase 1.4 优化顶部信息层级、测试数据提示、星期/时间刻度、半小时网格、滚动条和课程卡片；45 分钟短课按优先级隐藏教室与教师，课程真实高度保持不变。
- 重叠 lane 使用少量固定色差，首末时间刻度保持在轴内；Tauri 最小窗口尺寸配置调整为 720×520，默认 1280×800 不变。
- 39 项单元测试、23 项架构测试、9 组尺寸/缩放下 75 项 UI 测试、lint、format、build、verify 全部通过。真实 Tauri 窗口在 200% DPI 下完成三种客户区尺寸、纵横滚动、sticky、最大化、最小化、恢复和正常关闭验收。
- Phase 1 原型仍只使用测试课程；不具备保存、CRUD、PDF/教务导入、提醒、自启动、托盘或正式安装包。停止等待 Phase 2 确认。

### Phase 1.3 稳定节点（历史）

- Phase 1.3 PASS：实现 07:00–22:00 七天课程表时间轴，课程按实际分钟定位和定高，保留大段空闲，相邻课程不产生负间距，重叠链稳定分栏。
- 新增 Timetable、TimeAxis、DayColumn、CourseCard 组件和明确标注的测试课程；小窗口使用同一滚动容器横向浏览，星期表头与时间轴保持固定。
- 新增 Playwright UI 测试、oxlint、Prettier 与统一 verify；100%/125%/150% 缩放及 1280×800、900×600 视口验证通过，真实 Tauri 独立窗口和 HMR 回归通过。
- 本阶段没有接入真实课表、PDF、SQLite、提醒或其他 Phase 2 功能；停止等待 Phase 1.4 确认。

### Phase 1.2 稳定节点（历史）

- Phase 1.2 PASS：新增最小 Course 类型、严格时间转换、分钟偏移/持续/空闲与重叠判断，配置明确为测试用。
- 新增 36 项单元测试、23 项架构测试、类型契约反例和 npm run verify；build 与重新启动的真实桌面窗口回归通过。
- 本阶段没有接入课程表 UI、PDF 或存储；停止等待 Phase 1.3 确认。

### Phase 1.1 稳定节点（历史）

- Phase 1.1 PASS：修复 Vite 监听 Rust target 导致 Windows DLL 锁定 EBUSY 的问题，前端 src/HMR 保持正常。
- 补齐必需 Windows 应用图标，Rust 编译成功，独立桌面窗口已实际打开并验证 React 热更新及恢复。
- 保存 Cargo.lock 和此前的最小桌面空壳，形成可恢复的 Phase 1.1 节点。
- 未进入 Phase 1.2，无课程表/PDF 导入等业务功能；尚未发布安装包。

## 历史开发记录 — 2026-09-08

- Phase 1.1 进行中：建立 React/Vite/Tauri 空壳，前端构建和浏览器冒烟通过，桌面工具链阻塞。
- 核对真实 PDF：15 条固定安排和 3 条非固定实践课程；记录后续识别验收依据，尚未实现导入。
- 当前改动未达到 Phase 1 PASS，尚未提交或发布。

- 完成 Phase 0 项目检查和基础设计文档。
- 基于 AI_Project_Template 的工程规范建立独立文档工程。
- 记录统一课程模型、时间轴算法、分阶段路线和验收方案。
- 尚未成功构建、运行或发布桌面程序。
