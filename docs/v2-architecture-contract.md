# Links Workplace v2.0 — Architecture Contract

**状态：** v2 架构与依赖方向契约；不是实现清单。需求 SSOT 为 [`PROJECT_BRIEF.md`](../PROJECT_BRIEF.md)。v1.3.1 保持当前稳定产品；本文件描述未来渐进演进的边界，不表示未来模块已经实现。

## 7.1 Architecture Strategy

采用 **Modular Monolith + Incremental Rebase**。Stable Academic Core 留在现有位置；新 Workspace 能力围绕它增长。原则是旧代码少动、新代码写对；不为品牌迁移重写 Academic。

## 7.2 Target Logical Layers

目标逻辑层为 Presentation、Application、Domain、Infrastructure。期望依赖为 Presentation → Application API/UseCase → Domain，Infrastructure 为 Repository/平台端口提供实现。此方向是未来契约，不要求当前阶段移动现有文件或伪造已完成边界。

## 7.3 Module Boundaries

未来逻辑模块：Core、Academic、Workspace Shell、Planner、Tasks、Inbox、Diary、Weather、Context、Routine、AI、Search、Notification。Academic 内部数据不得被 Workspace 直接读 DB；所有跨模块使用 Application API / UseCase。

## 7.4 Application API Contract

正常调用方向：`Presentation → Application API / UseCase → Domain → Repository / Tauri adapter`（具体端口由后续设计落地）。禁止 UI 直接访问 SQLite、Workspace 绕过 Application 读取 Academic 内部表、AI 直接访问 Repository/DB。

## 7.5 Academic Adapter Strategy

Phase 1.0 审计发现的候选 seam：`resolveCourseOccurrences`、`getTodayDashboard`、`loadSemesters`、`loadAcademicTasks`、`loadExams`、`loadCourseOverrides`、`buildUnifiedReminderPlans`。Phase 1.3 已在 `src/application/academic/` 建立首阶段读取边界：`loadAcademicScheduleData`、`loadAcademicHubData` 与 `resolveAcademicOccurrences`。App 和 AcademicHub 的 Academic 读取经此 API 组合既有 storage service；occurrence 解析直接委托稳定的 `resolveCourseOccurrences`。Academic 写入仍由既有组件调用 storage service，Widget 与 Reminder 消费者尚未迁移，均为刻意保留的增量边界，不表示持久化层已重写。

## 7.6 Navigation Contract

未来建立统一 typed navigation contract，概念路由为 `WorkspaceHome`、`WorkspaceSchedule`、`WorkspaceTasks`、`WorkspaceDiary`、`WorkspaceInbox`、`WorkspaceAI`、`AcademicSchedule`、`AcademicChanges`、`AcademicExams`、`AcademicSemesters`、`Settings`。导航对象可携带 route、selected object ID、optional date。Notification、AI、Search、Ctrl+K 共用该契约，不各造跳转机制。Phase 1.1 不决定是否使用 React Router；第一目标是导航契约。

Phase 1.2 已在 `src/navigation/types.ts` 建立 `AppRoute`、`ObjectRef`、`NavigationTarget`，纯辅助函数位于 `src/navigation/navigation.ts`。Phase 1.5 的公共 Shell 位于 `src/shell/`，消费既有 `AppRoute`；主窗口默认为 `workspace/home`，Academic 子页面由统一二级导航切换，最近 Academic route 仅保存在运行时 React state。现有 AcademicTask 以临时 `academic/tasks-legacy` 路由及“学业事项”入口保留。未实现路由显示明确状态，不再静默回退到 Today；不引入 React Router。

## 7.7 Timeline Contract

Unified Timeline 是 Presentation/Application projection，不是数据库实体或新的万能 Domain model。未来 TimelineItem 的概念字段至少含 `id`、`sourceType`、`sourceId`、`start`、`end`、可选 `location`、`title`、`draggable`、`resizable`、`status`、`warnings`。来源包括 AcademicOccurrence、PlannerEvent、TimeBlock、AIProposal。Task 本身不因 Deadline 进入时间轴；Exam 是否出现由具体 presentation policy 决定，不强制视为 occupancy。

## 7.8 Time Semantics

- PERIOD_BASED Course：成对 `startPeriod/endPeriod` 是权威事实；实际钟点由当前确认的 PeriodTime 解析，旧 `startTime/endTime` 快照不可作 runtime fallback。
- FIXED_TIME Course：明确的 `startTime/endTime` 为权威时间。
- Task Deadline ≠ PlannerEvent/TimeBlock 的 scheduled time；Deadline 本身不占 Timeline。
- 明确调课的钟点是 override 时间；只改教室的 override 继续随基础 occurrence 时间解析。
- Diary 日期不等于 Timeline occupancy；AI proposal 不等于业务事实。

## 7.9 Database Evolution

当前 SQLite schema 为 5。未来 Workspace tables 与 Academic 共用同一个 DB，不另建 Links Workplace DB。已知当前代码没有 migration 前自动备份。任何正式 schema > 5 的 migration 前必须定义并验证备份、事务迁移、迁后校验及失败恢复；这是 schema bump gate。UI 不直连 DB。

## 7.10 Technical Identity

**CRITICAL — KEEP:** Tauri identifier `com.ntu-course-assistant.desktop`。当前 AppData 数据路径依赖该 identifier，DB 文件名为 `courses.sqlite3`。不得因产品改名而变更。任何未来迁移必须先完成数据迁移设计、Windows installer E2E、old→new updater E2E、DB persistence、Start Menu、uninstall entry、tray、notification 的 Windows 10/11 兼容验收，并获 Ethan 明确批准。

## 7.11 Brand Strategy

区分 user-facing brand 与 technical identity。用户可见品牌目标为 Links Workplace；为兼容允许继续保留 NTU 技术命名。不要为了“名字干净”破坏升级或 AppData 兼容。productName、EXE/installer branding 在独立 Brand Compatibility Phase 处理；初始 v2 开发保持 GitHub repo 与 updater source 不变。

Phase 1.5 已将 Links Workplace 用于 React 主窗口公共 Header 与纯 UI About 展示；Tauri `productName`、系统窗口标题、Tray、安装器、identifier、GitHub repo 与 updater source 均未迁移。Weather slot 仍无数据，不展示天气占位或假数据。

## 7.12 Design System Contract

新增 UI 先通过语义 Design Tokens 消费，不复制现有颜色 literal。历史 Academic Accent 事实：primary `#2f7b68`、border `#266b5a`、hover `#286b5b`、selected `#2e7d6e`、current-time `#5a9d8a`。目标 tokens 包括 `accent-primary`、`accent-hover`、`accent-pressed`、`accent-subtle`、`focus-ring`、`current-time`、`surface`、`border`、`text-primary`、`text-secondary`、`success`、`warning`、`danger`。Phase 1.1 不实现 token 系统。

## 7.13 Offline / Failure Contract

Academic、Planner、Tasks、Diary、Inbox、Timeline、Reminder 和本地 Search 等核心功能不依赖 OpenAI 或天气网络服务。Weather 失败不得破坏 Workspace；AI 失败不得破坏 Workspace；Context 尽量确定性、离线本地运行。

## 7.14 AI Boundary

禁止 AI 直接改 DB、Course、任何 Deadline 或 Diary 正文。写入方向必须为 `AI → AIToolRegistry → PermissionGate → Application UseCase`。Proposal 必须 Preview、Revalidate、User Confirm，再由 Application UseCase 执行。Diary 读取需独立权限，不能由全局 AI permission 隐含授权。

## 7.15 Test Strategy

未来验证层包括 Unit、Architecture、UI、Rust、Integration、Windows 10 manual/install；v2 当前主要人工环境为 Windows 11 Pro。Architecture tests 至少保护：Workspace Presentation 不接 raw SQLite/Academic persistence；AI 不接 Repository/DB，只经 ToolRegistry/PermissionGate/Application UseCase；Academic stable core 不被复制；Application API 依赖单向；Timeline 仅为 projection；Course period-time authority 有 regression coverage；每次 schema migration 有单元/Rust 测试。installer、updater、identity、AppData 变更不能只凭 unit/UI 宣告 PASS，需实际 Windows 验收。

## 7.16 Windows Development / Acceptance Baseline

历史事实：v1.3.1 Windows 10 安装/人工验收 ALL PASS；不得改写为 Windows 11。v2 当前开发环境与主要人工验收环境：Windows 11 Pro。未来 Dashboard 目标 viewport 为 1920×1080、1600×900、1366×768。Phase 1.1 不执行 UI 验收；安装器、updater、notification、tray、autostart 以 Windows 11 Pro 实机验证为主。

## 7.17 Dashboard Contract

Workspace Home 页面自身无纵向滚动。Phase 1.6.1 起主区域采用 Timeline / Time Context / Workspace Rail 三栏，宽度随视口伸缩，Time Context 在桌面目标宽度约 212–248px。仅 Timeline viewport 可以独立纵向滚动；默认定位当前时间附近并实时显示 current-time indicator。右侧在目标尺寸下不独立滚动；内容过多显示摘要和“查看全部”，不无限扩高卡片。

## 7.18 Dashboard Header Contract

顶部左侧 Links Workplace 与 Daily Quote；右侧 Date、Live Weather、`[工作台] [课表]` 与 Settings。工作台/课表是最高级模式切换，工作台在左且为默认页。Daily Quote 来源只能是经过验证且署名正确的名言库，或明确标注 AI-generated 的文案；不得让 AI 文案伪装成名人原话。

## 7.19 Dashboard Module Interaction

首页模块卡片同时呈现摘要与导航入口：Schedule/Timeline 进入完整日程模块；Task 进入任务管理；Diary 进入 Diary；Inbox 进入 Inbox；AI 进入 AI workspace。不得另加功能选择页或“功能岛”。

## 7.20 Planner Contract

- `PlannerEvent`：有明确 start/end 的个人日程事实。
- `TimeBlock`：为 Task 或活动预留的计划时间。
- `PersonalTask`：描述要做的事；Task 本身不占 Timeline。
- 只有 PlannerEvent、TimeBlock、AcademicCourseOccurrence 等明确有时段占用的事实进入 Unified Timeline。
- 一个 Task 可以关联多个 TimeBlock；禁止用单一 `task.timeBlockId` 强制一对一。

## 7.21 Timeline Editing Contract

AcademicCourseOccurrence 不可在 Timeline 上直接拖动或 resize。停课、调课、换教室、补课通过 Academic CourseOverride flow。PlannerEvent 与 TimeBlock 可拖动/resize。冲突默认是 Warning；除非具体验证/业务约束阻止，否则允许用户选择 Save Anyway。

## 7.22 Buffer Contract

PlannerEvent / TimeBlock 可支持 beforeBuffer/afterBuffer。Buffer 不改变事实 start/end；它影响 Free Time、Conflict、AI planning 与 Context。Timeline 可视觉化表达 buffer，但不得扩张事件的事实时间。

## 7.23 Task Contract

PersonalTask 概念字段：`id`、`title`、optional `dueAt`、`priority`、optional `estimatedDuration`、`note`、`status`、`createdAt`、`updatedAt`。具体 DB schema 留给未来 Planner/Task 阶段，Phase 1.1 不建 migration。Task 可无 Deadline；逾期保持 overdue，不自动移到今天/明天。AcademicTask 与 PersonalTask domain 分离。

## 7.24 Diary Contract

Diary 是 daily personal record，不是 Notes、PKM、Obsidian 或 Notion clone。UI 默认一天一篇主要日记，但 DB 不得用 `unique(date)` 把一天一条硬编码。支持 autosave、local-first、high privacy。DiaryEntry 不进入 Timeline。AI Diary read permission 独立，Search 是否包含 Diary 也应为独立设置。

## 7.25 Inbox Contract

Inbox 仅限应用内；Quick Capture 已删除，不恢复快捷键、浮动捕获或 tray capture。流转为 `Raw Text → Preserve Raw → Local Parse → Preview → User Confirm → Business Object`。本地解析优先，AI 仅作可选辅助；模糊时间禁止静默猜测。首期可转 PersonalTask / PlannerEvent，也可 keep/delete，不直接修改 Academic Course。

## 7.26 Weather Contract

Weather 不是 Workspace Home 的大型卡片。顶部显示实时天气摘要，点击可展开 detail/hourly/7-day；Weather 可提供 Timeline Context（例如户外事件叠加雨警告）。Weather 服务不可用时，Academic、Planner、Tasks、Diary、Inbox 与 Timeline 仍须正常。

## 7.27 Context Engine Contract

Context Engine 是 deterministic，不能由 OpenAI 充当。未来输入包括 Academic、Planner、Tasks、Inbox、适当的 Diary metadata、Weather、Time、Routine 与 FreeTime；输出 INFO、SUGGESTION、WARNING。Context 不成为必须访问的独立大页面，应进入 Timeline、Task、Notification、Morning Brief、AI context、Evening Review 等相关位置。

## 7.28 Routine Contract

Routine 是 soft goal，不是每日 Task generator。它只建议、不自动占时；建议经用户确认后才成为 PlannerEvent / TimeBlock。Routine 设置是低频入口，不在 Workspace 首页添加长期 Routine 大卡。

## 7.29 Morning Brief / Evening Review

Morning Brief 是 Workspace 的 context output，不是新的 Domain fact；可组合今日课程、Tasks、Weather、Free Time 与 warnings。Evening Review 主要进入 Diary flow，不引入 Focus metrics。FocusSession、ActualActivity、Focus timer 和 Planned-vs-Actual 均不恢复。

## 7.30 Notification Contract

未来可逐步将现有 Reminder 演进成统一 NotificationService，支持 dedupe、rate limit、quiet hours、why this reminder；Phase 1.1 不修改 Reminder。通知点击后使用统一 Navigation Contract，不另写第二套导航。

## 7.31 Search / Command Palette Contract

未来 Ctrl+K 属于 Global Search / Command Palette，但不是 Phase 1 优先实现。Search、Notification、AI、Command Palette 共用 typed navigation 和 object reference。Search 可覆盖 Academic、Tasks、Planner、Diary（独立 permission/setting）、Inbox、AI Memory；Phase 1.1 只记录方向。

## 7.32 UI Design Contract

Clean Minimal Desktop Workspace：clean、quiet、high information density、not crowded、low visual fatigue。避免大量渐变、高饱和卡片、AI 紫色发光、大型圆角和复杂动画。新代码经语义 tokens 使用现有 Academic visual DNA，不复制色值 literal。

## 7.33 Theme Contract

目标主题 Light / Dark / System。Phase 1.4 已在 `src/theme/` 建立 `ThemePreference`（`light | dark | system`）与 `ResolvedTheme`。默认保持 `light`；偏好作为 presentation setting 存在 `localStorage`，key 为 `links-workplace.theme-preference`，不改 SQLite/schema。主窗口在 React 首次渲染前应用主题，并在 `system` 模式监听系统色彩方案变化。当前 Widget 不接入主窗口主题系统，保持既有外观。

未来如需将主题偏好迁移到统一 Settings persistence，必须单独设计迁移；不得借主题功能擅自增加数据库 schema。

## 7.34 UI Component Contract

未来按真实复用逐步建立 Button、Card、SegmentedControl、Input、Select、Dialog、Popover、Tooltip、Toast、EmptyState。Phase 1.1 不创建这些组件，不提前造大型 UI framework。

## 7.35 Failure Contract

OpenAI unavailable、Weather API unavailable 或网络断开时，Academic、Planner、Tasks、Diary、Inbox、Timeline、Reminder、Widget、local Search 仍可用。AI 与 Weather 是增强能力，不是核心启动依赖。

## 7.36 Phase 1.6 Workspace Dashboard Implementation

- `workspace/home` 使用 `src/workspace/dashboard/WorkspaceDashboard.tsx`；工作台数据由 `src/application/workspace/` 组合既有 Academic application readers 与 canonical occurrence resolver，不在 UI 中直连 storage。
- `TimelineItem` 是只读展示投影，不是数据库实体或新的业务事实。Phase 1.6 的唯一时间轴来源为已解析的 `AcademicCourseOccurrence`；保留其日期、实际起止时间、教室及停课/调课状态，不自行解释 CourseOverride，也不允许课程拖动或调整大小。个人 PlannerEvent、TimeBlock、AI proposal 等来源类型只作为类型边界预留，当前不生成数据。
- AcademicTask 只作为工作台任务摘要显示，不占用时间轴。Diary、Inbox、AI 卡片如目标模块尚未实现，必须显示“尚未开放”，不得伪造内容。
- 单日布局为 1,440 分钟 / 1,440 CSS px，半小时刻度；重叠安排进行稳定分栏。时间无效或超出日边界的条目从布局排除并生成可审查警告；视觉最小高度不得更改事实起止时间。
- 页面进入/返回工作台时读取当天 Academic 数据；本地分钟时钟只重算当前/下一课程摘要和当前位置，不轮询数据库。跨本地午夜后切换日期并重新读取当天数据。时间轴为内部滚动区，初次定位到当前时间附近，不持续抢回用户手动滚动位置。
- Phase 1.6 不改变 Academic core、存储、Tauri、数据库/schema、产品身份、依赖或其他应用模块。

## 7.37 Phase 1.6.1 Workspace Presentation & Settings

- 公共 Header 与 Today Overview 构成连续 Top Canvas；Overview 使用已解析课表投影及现有学业任务生成确定性摘要。背景只允许静态、低对比氛围效果，不显示虚构天气或未实现领域的数据。
- 主工作区为 Timeline / Time Context / Workspace Rail。Time Context 是文字摘要，消费已解析 Timeline 投影，显示当前或下一课程、下一段真实空闲；不得变成第二条时间轴或自行解析 CourseOverride。任务截止日只在任务摘要展示，不占 Timeline。
- Surface 层级为 Canvas、Primary Timeline、Utility Time Context、Flat Tile；交互动画使用语义化 120/180/240ms token，`prefers-reduced-motion` 下取消非必要过渡。浅色/深色共用语义 token。
- 设置使用统一容器与分类侧栏：从工作台进入默认“工作台 / 首页”，从课表进入默认“课表 / 作息”；主题位于“通用 / 外观”，沿用原 `links-workplace.theme-preference`。未实现页仅显示真实说明，不提供虚假开关；现有作息、提醒、Widget、启动与课程数据操作仍使用原保存逻辑。

Phase 1.6.2 将 Time Context 固定为由 Workspace application 层纯投影生成的“当前情境 / 下一事件”两段摘要；只使用已解析 TimelineItem 判断课程与真实空闲，不在 JSX 或存储层重复解析课程时间。Timeline 仍以 1 分钟对应 1px，首尾刻度仅在展示层向画布内对齐。

## 7.38 Phase 2 Planner / Personal Task Implementation Contract

- Phase 2 先完成 `docs/v2-planner-domain-contract.md` 中的 domain/schema contract，再实现一个且仅一个 schema migration：5 → 6。必须先隔离 debug DB，再允许任何运行时迁移；生产 identifier、`courses.sqlite3` 文件名与 LocalAppData 路径保持不变。
- `PersonalTask`、`PlannerEvent`、`TimeBlock` 是不同事实。Task deadline 不占 Timeline；一个 PersonalTask 可关联多个 TimeBlock；TimeBlock 不复制 task title；PlannerEvent 不要求 task 关系。
- Planner 的 AcademicCourseOccurrence 始终只读；课程时间继续只由 canonical Academic resolver 提供。Planner projection 消费解析结果，不直接读 Academic tables、不重新解释 CourseOverride。
- PlannerEvent / TimeBlock 的实际 local wall-clock 起止不含 buffer。buffer 仅用于 conflict 与 Free Time；conflict 是 warning、用户可选择仍保存，不是 DB constraint。Cancelled Academic occurrence 不占用时间。
- Completion 保留 TimeBlock；显式删除 PersonalTask 才通过外键 cascade 删除关联 TimeBlock。单日范围和无 recurrence / cross-midnight 是首版硬限制。
- Presentation → Planner Application use cases → service/Tauri adapter → Rust repository/SQLite。Workspace UI 不直接 `invoke` planner CRUD 或访问 SQL。
- Phase 2.1 已实现 schema 5→6 单次事务迁移；迁移旧 schema 前通过 `VACUUM INTO` 创建并校验数据库备份。Debug 数据库隔离在 app local data 下的 `dev-v2/courses.sqlite3`，Release 生产路径保持不变。
