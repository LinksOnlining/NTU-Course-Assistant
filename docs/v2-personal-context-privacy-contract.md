# Links Workplace v2.0 — Phase 3 Personal Context 隐私与领域契约

状态：Phase 3.0 合同基线。此文件定义 Phase 3.1–3.6 实现边界；不是功能完成声明。

## 1. 隐私总原则

| 模块 | 数据位置 | 外部网络 | 日志/遥测 | Context 可见内容 |
| --- | --- | --- | --- | --- |
| Diary | 本机 SQLite | 禁止 | 禁止正文 | 仅 `hasDiaryToday` |
| Inbox | 本机 SQLite | 禁止 | 禁止 raw text / parse 正文 | 仅待处理数量 |
| Local Search | 本机内存读取 | 禁止 | 不记录 query，不持久化历史 | 仅展示本地结果 |
| Context Engine | 纯确定性投影 | 禁止 | 不含私密正文 | 仅允许契约定义的摘要字段 |
| Weather | 用户设备缓存 | 仅用户主动选择城市后的天气服务 | 不记录其他工作区数据 | 仅天气摘要 |
| Routine | 本机 SQLite | 禁止 | 不记录个人标题到远端 | 建议只含必要摘要 |

- Phase 3 中 Weather 是唯一允许主动访问外部网络的模块。Diary、Inbox、Search、Context、Routine、Academic 和 Planner 不得为了本阶段功能发起外部请求。
- Diary 正文和 Inbox raw text 只能在本地数据库、本地 UI 与本地 Search 中流转；不得进入 console、Rust stdout、错误遥测、远端分析、Weather 或 AI。
- Weather provider 仅可收到用户明确选择城市所必需的城市搜索文本，或该城市级坐标，以及天气查询参数。不得附带 Course、Task、PlannerEvent、Diary、Inbox、Routine 标题或 Search query。不得访问设备精确位置、浏览器 geolocation、IP 地理推断或后台定位。
- 天气默认关闭；关闭时不得请求天气或城市搜索服务。地点搜索只在用户启用天气并主动提交搜索时发生。
- Context Engine 不联网、不访问数据库、不调用 Tauri、不调用 AI；仅将上层已经读取的数据投影为确定结果。不得包含 Diary 正文/片段、Inbox raw text 或完整 Task description。
- Search 完全本地；不使用远程索引、搜索服务、query logging 或 query history。空查询不得加载全库内容。
- Routine 是软目标，只产出建议；不得自动创建 Task、Event 或 TimeBlock。只有用户在 Planner Event 编辑器最终保存后才可产生 Event。
- Phase 3 不实现 AI。未来 AI 的权限必须是独立、明确、可撤销的 permission gate；普通 AI 开关不得隐含 Diary 正文读取权限。本阶段不创建或推断此授权。
- Diary 使用本机 SQLite，不做 SQLCipher/全库静态加密；禁止声称“已加密存储”。如未来需要 encryption-at-rest，须作为独立阶段设计。

## 2. 分层与现状审计

- SQLite schema 当前为 6。`src-tauri/src/db.rs` 的 `CourseDatabase::migrate` 是现有唯一迁移框架，已有迁移前 `VACUUM INTO` 备份、备份重开/版本/integrity 校验、事务迁移、失败回滚与 future schema 拒绝；Phase 3.1 必须在此框架中新增且仅新增 `6 → 7`。
- Debug 数据路径由 `src-tauri/src/lib.rs` 隔离到 `<app_local_data_dir>/dev-v2/courses.sqlite3`；Release 路径保持 `<app_local_data_dir>/courses.sqlite3`。不得修改 identifier、数据库文件名或生产目录。真实用户数据库不得用于开发/测试。
- `CourseState` 保存路径而非全局 SQLite connection；每个 command 使用 `spawn_blocking` 和短生命周期 `CourseDatabase::connect`。新 Repository 命令遵循同样边界，不把 SQLite 访问写进 Presentation。
- 前端既有 `src/application/academic/`、`src/application/planner/`、`src/application/timeline/`、`src/application/workspace/` 与 service adapters。新模块遵循 Presentation → Application → service/Tauri adapter → Rust Repository/SQLite，不绕过 Academic canonical read boundary。
- `AppRoute` 已有 workspace/diary、workspace/inbox，`ObjectRef` 已有 `diaryEntry`、`inboxItem`；当前 diary/inbox 仍显示未开放状态，`workspace/search` 尚未建成。Search 结果应复用 typed ObjectRef/NavigationTarget，不在结果组件散写 route 字符串。
- Settings 已有“工作台 → 天气”占位页；现有 `connect-src` 仅允许本地 Tauri IPC。天气阶段若确认 WebView fetch 可安全使用，只能加入 provider 所需的精确 HTTPS 域名，不得使用 `connect-src *`。
- Phase 2 已有 buffer-aware `computeFreeTimeIntervals`、PlannerEvent Application API 与 Workspace Schedule/Application boundaries；Context/Routine 应复用这些纯逻辑与 API，不复制课程解析、冲突或空闲算法。
- 当前没有统一 Local Search 实现或 Weather provider 调用。本文件后续明确的功能仍待各自阶段实现和验证。

## 3. Diary 契约

### 3.1 领域

`DiaryEntry` 为简单每日长文本，不是 Notes/PKM、Markdown 编辑器、知识库或附件系统；不添加 folders、tags、backlinks、attachments、rich blocks、templates、mood score、AI summary 或 review score。

字段：`id`、`entryDate`、`body`、`createdAt`、`updatedAt`。同一个本地日期最多一条记录。正文是纯文本，按日期查看，不作为 Timeline 占用。

### 3.2 UI 与保存

- 路由：`workspace/diary`；中文导航为“工作台 > 日记”。桌面布局提供日期导航与纯文本编辑器；支持前一天、后一天、今天，并提示近期有内容的日期。不一次加载全部历史正文。
- 输入后自动保存，建议约 500 ms debounce。快速连续输入、慢写入和旧请求晚回必须保证 latest-write-wins；可采用单飞队列或 revision，而不堆叠无序写入。
- 日期切换、离开路由、编辑器 blur 时尽量 flush。若安全可行，可在正常窗口关闭前 flush；不得破坏既有窗口、Widget 或应用生命周期语义。
- 状态明确显示“正在保存 / 已保存 / 保存失败”。失败时保留正文、允许继续编辑与重试，不得假显示成功。
- Dashboard 卡只显示“今天已记录 / 今天还没有记录”，不得展示正文 snippet。

### 3.3 数据访问

Repository 最少支持按日期读取与 upsert，必要时删除。SQLite `entry_date` 唯一约束确保每个本地日期至多一条。迁移/测试日志禁止记录 `body`。

## 4. Inbox 契约

### 4.1 Capture 与 parser

- Inbox 仅限应用内纯文本输入；不支持图像、文件、OCR、邮件同步、后台剪贴板监听、全局快捷键或 Tray capture。
- 用户提交后先持久化 raw text；只有 raw 保存成功才运行本地确定性 parser。Parser 不联网、不使用 AI/NLP 模型、不覆盖 raw；raw 直到用户明确删除 InboxItem 才删除。
- 支持明确 `任务：` / `待办：`、`日程：` / `安排：` 前缀；日期支持今天、明天、后天、`YYYY-MM-DD`、`M月D日`；时间支持明确 `HH:mm` 和 `HH:mm-HH:mm` / `HH:mm 至 HH:mm`；Task 截止可识别“截止”/“DDL”。
- 解析结果表达 intent（task/event/unknown）、已识别标题/字段、issues 与 missingFields；禁止伪造 confidence 百分比。未知意图交由用户在预览中选择。
- 模糊时间必须保持未解决。例如“明天下午去图书馆”可识别日期，但不得猜测 14:00 或任何时长；Event 缺少明确日期、开始或结束时不能确认。

### 4.2 预览、确认与保留

- Preview 显示所有拟创建字段，并允许修改标题、日期、时间、截止和对象类型。Task 标题明确即可确认，截止可选；Event 的日期、开始和结束都明确才可确认。
- 确认 Task 只创建 PersonalTask，不创建 AcademicTask。确认 Event 只创建 PlannerEvent，不修改 Academic Course。
- 创建目标对象和将 InboxItem 更新为 confirmed/target reference 必须在一个事务/等价原子 Use Case 中完成。重复确认返回既有目标，不重复创建。
- 确认后保留 raw，并显示已转换目标与导航入口。Dismiss 只标记 dismissed，不创建对象。删除 InboxItem 需确认，且绝不删除已创建的 Task/Event。
- 错误日志只包含 item ID 与错误类别，不含 raw text、解析正文或敏感字段值。

## 5. Weather 契约

- `工作台 → 天气` 是真实设置：启用、地点、温度单位、手动刷新。默认为关闭；关闭时无网络访问，也不显示虚假天气。
- 手动地点搜索只在用户提交搜索时将搜索文字发送给 Photon / OpenStreetMap；支持区县、街镇、道路与地点，且不保存搜索历史。只有用户选中的地点及其坐标/层级元数据会保存在天气设置中；天气预报请求将该选中地点自己的坐标发送给 Open-Meteo。
- “使用当前位置”仅在应用内说明确认及系统定位授权后读取一次；接受系统估算精度不差于 10 公里的坐标，并在发送给 Photon 逆向解析与 Open-Meteo 前四舍五入到三位小数。只保存当前选择，不记录定位历史；解析失败时不猜测地名。
- Presentation 不直接散落 provider fetch；通过 `searchLocation`、`fetchForecast` 等单一 adapter 返回内部 `current/hourly/daily` 模型，不让 UI 绑定 provider 原始 JSON。
- Header 仅显示温度与简短状态；点击打开轻量 popover，显示当前、未来数小时、七日预报、地点与更新时间。
- 缓存用 `links-workplace.weather.*` 命名空间，不进入 schema 7。≤30 分钟为 fresh，≤24 小时 stale-but-usable；过期视为不可用。网络失败时可显示 stale cache 并明确标注缓存状态/更新时间；无缓存显示天气暂不可用。
- App 启动或天气实际需要展示时，只在 cache stale 后刷新；地点改变或手动刷新时刷新；禁止分钟级轮询。Weather 错误不得导致 Error Boundary、启动或任何离线核心功能失败。
- Provider 需无用户 API key、HTTPS、有官方文档，支持城市搜索及 current/hourly/daily。优先 WebView 原生 fetch + 精确 CSP allowlist；只有经证据证明 CORS/CSP/platform 不可行时才增加最小官方 Tauri network capability。不得抓网页、使用代理或提交密钥。
- 所有 provider 请求只含天气所需地点/参数；不得附带个人工作区内容。Tests 使用 mock/fixtures，不依赖第三方实时 API。

## 6. Deterministic Context Engine

- Context 是无表、无 IO、无网络、无 AI 的纯函数投影；当前时间必须作为显式输入。相同输入产生相同输出。
- 输入只来自现有 Application boundaries：Unified Timeline、Tasks、Weather snapshot、Diary 状态、Inbox pending count、显式 local date/time、Routine 与 Free Time。
- 输出至少包含 `currentItem`、`nextItem`、`nextFreeSlot`、逾期/今日任务数、可选天气摘要、`hasDiaryToday`、`pendingInboxCount` 和可选 Routine suggestion。
- `WorkspaceContext` 禁止 `diaryBody`、`diaryText`、`diarySnippet`、`inboxRaw`、`inboxText`、完整任务 description 或任何外部 prompt。
- 计算只消费已加载数据，不读 SQLite、不 fetch、不 invoke Tauri；Dashboard 逐步消费该投影，不重写 Phase 1/2 Dashboard。

## 7. Routine 契约

- Routine 是软目标/软偏好，不是 Task，也不是 recurring Event。字段：`id`、`title`、`targetDurationMinutes`、`weekdaysMask`、可选 preferred start/end、`enabled`、`lastScheduledDate`、创建/更新时间。
- 首版时长 5–720 分钟；至少选一天；偏好时间窗口要么两端均为空，要么开始早于结束且在单日内。不实现 RRULE、月度 recurrence、目标次数、连续天数、完成率、Focus score 或 analytics。
- 纯逻辑引擎显式接收日期、当前时间、Routine 和 buffer-aware Free Time。仅当启用、当天适用、未在当日安排且存在足够长的未来空闲时段时生成建议；偏好窗口必须满足。多候选时取最早合适时段，多个 Routine 用稳定顺序，不随机。
- Dashboard Time Context 最多展示一条轻量建议，不加大型 Routine 卡片。用户“安排”后打开可编辑 PlannerEvent editor 并预填；打开/取消不写入、不创建 Event，也不更新 `lastScheduledDate`。
- 只有最终保存时，用原子 Use Case 创建 PlannerEvent 并更新 Routine 的 `lastScheduledDate`。绝不创建 PersonalTask/TimeBlock；删除 Routine 不删除已确认 Event。

## 8. Local Unified Search 契约

- 正式路由：`workspace/search`；Header 有轻量搜索入口，无 Ctrl+K、全局快捷键、云服务、远程索引或持久化搜索历史。
- 搜索个人任务、学业事项、日程、课程、考试、日记与收件箱；TimeBlock 不独立列结果，避免重复任务。Academic 搜索通过现有只读 Application boundary。
- Diary/Inbox 可在本机结果中显示短 snippet，但 snippet 永不发送网络。点击 Diary 定位日期；点击 Inbox 定位条目；其余结果使用 typed ObjectRef/NavigationTarget。
- Query 做 trim、ASCII 大小写无关、Unicode normalize；中文做原样 substring，不依赖分词模型。确定性排序：标题精确、前缀、包含、metadata 包含、正文/raw 包含，再以 active/recent 做稳定 tie-break；不使用 AI relevance。
- 空 query 不加载全库，提示“输入内容开始搜索。”；无结果提示“未找到匹配内容。”；总结果最多 50 条并设合理类别上限。
- Search 不得 fetch、调用 Weather provider、记录远程 query 或持久化 query。除非数据量证实必要，不添加 FTS migration 或搜索框架；Phase 3 禁止 schema 8。

## 9. Schema 7 Proposal

Phase 3 只允许一条生产迁移：`6 → 7`，一次性添加下列三表。不得增加 schema 8；Weather cache 与 Context/Search 不建表。

### `diary_entries`

`id TEXT PRIMARY KEY NOT NULL`、`entry_date TEXT NOT NULL UNIQUE`（严格本地 `YYYY-MM-DD`，应用层校验实际公历日期）、`body TEXT NOT NULL`、`created_at TEXT NOT NULL`、`updated_at TEXT NOT NULL`。唯一日期约束对应本契约的“每天至多一条”。

### `inbox_items`

`id TEXT PRIMARY KEY NOT NULL`、`raw_text TEXT NOT NULL`、`status TEXT NOT NULL`、可空 `parse_kind`、可空 `parse_payload_json`、`parser_version TEXT NOT NULL`、可空 `confirmed_target_type` / `confirmed_target_id`、`created_at TEXT NOT NULL`、`updated_at TEXT NOT NULL`。状态至少包含 pending、needs_review、ready、confirmed、dismissed；受信任的格式与跨字段约束在 Rust/Application 验证。

### `routines`

`id TEXT PRIMARY KEY NOT NULL`、`title TEXT NOT NULL`、`target_duration_minutes INTEGER NOT NULL`、`weekdays_mask INTEGER NOT NULL`、可空 `preferred_start_time` / `preferred_end_time`、`enabled INTEGER NOT NULL`、可空 `last_scheduled_date`、`created_at TEXT NOT NULL`、`updated_at TEXT NOT NULL`。约束时长 5–720、至少一个有效星期、enabled 为布尔值、时间窗口两端同时为空或有效且 start < end。

索引只创建真实查询需要的：Diary 唯一 `entry_date` 索引/约束、Inbox `(status, created_at)`、Routine `enabled`。所有新表必须遵循现有 SQLite/Rust convention 与参数化 SQL。

### 迁移安全

- 在任何写入前以 schema 6 为源做一致性 `VACUUM INTO` 快照；快照必须可独立重开并通过 source `user_version`、`integrity_check` 和 `foreign_key_check`。
- 在单个事务中创建 schema 7 tables/indexes 并更新 `user_version`；提交后验证新 schema 与完整性。任何注入/真实失败必须回滚至完整 schema 6 数据，保留有效可重开的备份且不得遗留半建表。
- 迁移必须验证并保留 Academic 数据、PersonalTask、PlannerEvent、TimeBlock；Debug 测试仅使用隔离临时 DB。Fresh DB 直接创建 schema 7，不创建无意义的迁移备份。
- 复用现有 migration/backup framework；不另造迁移框架、不改生产 DB 路径、不执行用户真实数据库迁移。

## 10. 未来 AI 边界

Phase 3 不实现 AI。以后启用 AI 必须单独设计 provider、存储和 permission gate；Diary permission 独立于一般 AI permission，并须由用户明确授权。不得把 Diary 正文或 Inbox raw 自动放进 prompt、遥测或建议上下文；AI proposal 不等于业务事实，必须预览、重新校验并经用户确认后才能由 Application Use Case 写入。
