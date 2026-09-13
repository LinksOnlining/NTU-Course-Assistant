# 基础设计（Phase 0 提议）

实施状态（2026-09-10）：Phase 1、Phase 2、Phase 2.5–2.7 和 Phase 3 已通过验收。课程、用户作息和正式 PDF 导入通过 Rust `rusqlite` 持久化；连续时间轴按真实分钟显示节次、实际时间和课程位置。真实 PDF 检查见 docs/pdf-sample-review.md；PDF 本身没有可靠实际钟点，导入前仍必须使用用户确认的作息配置。

## 技术方案

采用 Tauri 2 + React + TypeScript + Rust，Vite 构建前端、npm 管理前端依赖。选择基于 Windows 11、时间轴 UI 开发效率和本地系统集成需要。采用系统 WebView2，安装包与内存优势是选型预期，具体体积、CPU、内存必须由实际构建测量，不承诺数字。

Rust 仅负责桌面宿主及必要系统 IO；不引入服务器、全局状态库、UI 大组件库或 ORM。相比 Electron，该选择符合复用系统 WebView 的方向；相比切换 C#/WinUI，保留用户优先评估的 Web UI 技术栈，避免同时改变语言和 UI 开发方式。代价是维护 TypeScript/Rust 两套工具链。

Phase 2.3/2.6 使用 rusqlite 0.40.2 的 bundled SQLite，Rust 存储边界提供课程 CRUD 以及 `load_period_times`、`save_period_times` 两个作息 command；React 通过 `src/services/course-storage.ts` 调用，不接触 SQL。数据库路径由 Tauri `app_local_data_dir()` 解析，实际文件为该目录下 `courses.sqlite3`，不依赖安装目录、源码目录或当前工作目录。

schema 4 包含 `courses`、`period_times`、`app_settings` 和最小 `handled_reminders` 表：id 为文本主键，教师、教室和节次允许 null，星期及节次含 CHECK 约束，时间固定存 HH:mm 文本，weeks 存排序去重数字数组的 JSON 文本；`period_times` 以 period 为主键保存严格校验后的作息。`app_settings` 仅保存 `term_config` 与 `reminder_settings` JSON。`handled_reminders` 只记录 occurrence key 和实际 handled 时间，用于跨重启去重，不构成通知历史。`PRAGMA user_version` 记录 schema 版本；0→1 建课程表、1→2 创建作息表、2→3 创建应用设置表、3→4 创建 handled 状态表，遇到高于程序支持的版本时拒绝打开且不修改数据库。数据库使用 3 秒 busy timeout、WAL 和外键检查，不引入 ORM。

Rust 在命令写入前再次校验 Course，读取时逐行解析 JSON 和校验字段。损坏记录被跳过、记录内部错误并向 UI 返回不含数据库细节的提示；原行不会修改或删除。初始化失败时应用仍打开并禁用添加入口，CRUD 失败时 UI 保留原状态。格式合法但超出当前 UI 时间轴的记录由启动加载边界跳过并提示，避免破坏布局，数据库内容同样保持不变。

Phase 2.4/2.6 用独立数据库验证了首次建库、迁移、连接关闭后重开、合法记录与 JSON/星期/时间/字段类型坏记录混合加载、未来版本拒绝、3 秒 busy timeout 及失败写入不损坏原数据。作息、学期和提醒设置先在 Rust 边界完成完整校验，再以单一事务写入；失败时保留上一份设置。未来 schema 会显示可操作的升级提示；其他初始化错误显示概括提示，SQLite 细节只写入 Rust 日志。React 只在 Rust 写入成功后提交状态，因此课程和设置写入失败均不会制造伪成功。

Phase 3.1 使用 PDF.js 6 的文字型 PDF 提取能力，并在构建前从受锁定依赖生成被忽略的 CMap 静态资源，以支持中文字体映射。`src/services/pdf-import.ts` 是唯一的 PDF/Tauri 文件适配器：Tauri 使用 Dialog 选择 `.pdf` 并通过受作用域限制的 FS API 读取；浏览器开发测试使用原生临时 file input。解析器懒加载，不增加主界面首次加载的 PDF.js 代码。它返回 `PdfExtraction`（文件名、页码、页面宽高及保留文本/x/y/宽高的 `PdfTextItem`），结果只在 React 内存中存在。学校规则、Course 和 SQLite 不属于此层。扫描件、加密件、损坏件或非 PDF 明确失败，不假装识别成功。

Phase 3.2 的 `src/importers/ntu-pdf/parse.ts` 独立消费 `PdfExtraction`，只产出允许缺字段的 `ImportCandidate[]` 与结构化 `ImportIssue[]`；它不依赖 React、Tauri 或存储。解析器要求至少三个唯一星期表头形成明确坐标证据，再自动选择 x 或 y 星期轴；证据不足时返回未知星期，经确认的首页面布局可供续页使用。星期归属使用表头相对位置，课程分组使用节次锚点、来源顺序和按文本高度推导的容差，不硬编码页面尺寸、绝对坐标或课程名称。

固定安排从节次锚点相邻的连续标题块、字段标记和坐标簇提取课程名、教师、教室、节次与周数。没有节次且包含通用实践结构的独立文本块会先从星期桶分离，按原始来源顺序生成候选；可识别名称和周数保留，星期、节次和时间保持 null 并带 blocking issue。候选 ID 由来源派生且可重复生成，固定安排按页码、星期、节次、来源位置排序，实践按原始出现顺序排列。issues 以 code+field 去重并携带 severity。只有用户确认的 PeriodTime 才能生成 resolvedTime；test-only 作息只产生 blocking issue。候选保留来源页、文本块和边界，只有后续确认流程才能调用统一 Course 校验。

Phase 3.3 的 `src/core/import-proposal.ts` 接收原始候选加用户覆盖值、当前 PeriodTime 和现有课程，动态推导 ready/warning/blocking，不把状态作为第二份业务真相存储。`prepareCourseProposal` 只在作息已确认且必填字段完整时映射实际时间，并强制调用 `validateCourseInput`；返回的 CourseProposal 只有 candidateId 和不含 id 的课程数据，正式 UUID 延后到确认写入。候选编辑只修改内存覆盖层，取消单条编辑或整批预览不会改变 parser 结果、课程状态或 SQLite。

重复判断要求名称、星期、实际开始/结束时间和周数完全相同；同名但时段或周数不同保持独立。时间冲突复用既有 `coursesOverlap`，覆盖现有课程与候选间冲突，均为可审查 warning，不自动合并、删除或拒绝。首版要求所有候选没有 blocking 才能进入最终摘要；warning 可以继续。保存用户作息会基于同一批原始候选立即重算，不重新读取 PDF。

Phase 3.4 的 `prepareImportPlan` 在任何正式 ID 产生前，以稳定输入顺序决定待写入项、现有/批内精确重复及时间冲突。只有待写入提案在最终确认阶段调用 `crypto.randomUUID()`，并再次通过统一 `validateCourseInput`；失败重试复用同一次确认生成的 ID，返回修改后才丢弃该批正式对象。确认页打开后所有写入控件在请求期间禁用，失败保留计划和修改，成功或取消才清空 PDF 会话。

前端只调用一次 `importStoredCourses`。Tauri `import_courses` command 把完整 `Vec<Course>` 交给 Rust，Rust 逐条执行与普通 CRUD 相同的 Course 校验，再在一个 SQLite transaction 中插入所有记录；空批明确拒绝，任一 JSON、约束或写入错误使整个事务回滚。成功返回实际写入的 `Course[]`，React 此后才合并状态。纯重复计划可在前端以零写入成功结束。

## 职责和数据流

React UI → 纯课程/时间轴逻辑；需要外部能力时通过 adapters → Tauri Rust → 本地存储/系统功能。

导入流程：PDFImporter / NTUImporter → ImportCandidate[] + 字段异常 → 预览及修正 → CourseProposal[] + 统一校验 → ImportPlan 重复/冲突决策 → 用户最终确认 → Course[] + UUID → Rust/SQLite 单事务写入。该流程已在 Phase 3 完整实现。

ImportCandidate 可以缺字段，携带原文、来源位置和问题列表；Course 是已通过校验的正式记录。取消预览不写库，存在阻断异常的行不得静默写入。首版拟只允许全部待导入行通过后确认；部分导入需用户显式选择有效行。

统一是数据契约统一，不是把不同来源强行写成同一种解析器；不建设通用插件框架。

## 最小 Course 模型

契约已实现于 src/types/course.ts（实际字段只读，继承 TimeRange，weeks 为只读数组）。以下简写展示数据内容：

```ts
interface Course {
  id: string;
  name: string;
  teacher: string | null;
  classroom: string | null;
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  startPeriod: number | null;
  endPeriod: number | null;
  startTime: string; // HH:mm，当地墙上时间
  endTime: string;   // HH:mm
  weeks: number[];  // 明确周数，例如 [1, 3, 5]
}
```

一条 Course 表示同名课程的一个固定上课安排。同一课程星期、时段或教室不同则分成多条，不增加课程目录/教学班等实体。单双周归一化为明确周数。

Phase 2.1 已实现共享 `validateCourseInput` 边界：名称 trim 后必填并限制 80 字符；星期限 1–7；时间复用严格 HH:mm 逻辑且开始必须早于结束；周数支持范围、离散和混合写法，归一化为 1–30 内的排序去重数组；教师和教室 trim 后为空时转为 null。当前表单还会明确阻止超出测试时间轴 07:00–22:00 的课程，不做裁切。ID 由浏览器标准 `crypto.randomUUID()` 生成，不增加依赖。

普通用户只填写真实时间。因为尚无经确认的南通大学节次映射，手动新增记录的 `startPeriod`/`endPeriod` 为 null；fixture 可继续携带测试节次。统一校验成功前 UI 不产生 Course，未来导入器应复用同一边界，而不是自行构造正式记录。

Phase 2.2 复用同一个 `CourseForm`：传入已有 Course 时预填字段，周数压缩为可编辑范围文本，保存仍调用 `validateCourseInput` 并沿用原 ID。React 内存数组按 ID 更新或删除；取消不触发状态写入。fixture ID 不进入用户 ID 集合，因此卡片不渲染编辑入口，正常 UI 无法修改或删除 fixture。删除确认后重新执行既有纯布局函数，剩余重叠课程自然恢复 lane 宽度。

Phase 2.3 将状态提交顺序改为“SQLite 成功后更新 React”。插入、更新或删除失败时表单保持打开并显示明确错误，内存状态不提前变化。开发服务器且不在 Tauri 运行时使用进程内测试 adapter 维持 Playwright fixture 能力；正式生产构建不显示 fixture，Tauri 运行始终使用 SQLite。

独立配置：TermConfig（第一教学周周一日期、总周数、时区 Asia/Shanghai），PeriodTime[]（节次、HH:mm 开始/结束）。尚未核实的学校作息绝不作为官方默认值。Phase 1 仅明确标注的测试配置和测试教学周。

Phase 2.5 实现 `PeriodTime` 配置边界和 `periodToTime`、`periodRangeToTimeRange`、`timeRangeToPeriods` 纯函数。配置要求正整数且严格递增的唯一节次、严格 HH:mm、开始早于结束、相邻节次不重叠；正常课间保留。反向映射只有开始和结束均精确命中配置、且中间节次连续时才返回节次范围，否则返回 null，不做近似猜测。

Phase 2.6 将 `PeriodTime[]` 作为用户可配置的作息：设置对话框复用同一份核心校验，允许编辑时间、添加下一节和删除最后一节，最多 30 节且必须从第 1 节连续编号。保存通过 Tauri `save_period_times` 事务完成；首次运行或未保存时使用 test-only fallback，保存后的配置由 `load_period_times` 恢复。`getTimelineBounds` 会将测试轴与作息覆盖范围合并并向整点扩展，TimeAxis 仍是连续分钟轴；课程的 `startTime/endTime` 永不因作息修改而改变，只有精确命中当前配置的原有节次才显示节次标签，不匹配时仅显示实际时间。

Phase 2.7 只调整桌面表现。TimeAxis 的每个节次块把节次、开始和结束时间分层显示；即使是 30 分钟的第一节，完整时间段也置于节次下方。课程与对应节次继续使用同一分钟计算，课程区不绘制小时、半小时、节次或列分隔网格。课程卡片始终由 `courseTiming` 提供 top/height，不使用离散 grid 行；普通卡片采用 10–12px 内边距和低饱和稳定色，短课和重叠 lane 会依据可用高度/宽度缩小文字，但不隐藏课程名称、时间、教室或教师，也不以省略号替代字段。

`TEST_PERIOD_TIMES` 明确为 test-only，共 1–11 节，只用于当前原型和自动测试，不代表南通大学正式作息。TimeAxis 接收 `PeriodTime[]` 并按 `(startTime - axis.startTime) × pxPerMinute` 定位，每个标记高度也来自真实持续分钟。时间轴保持 07:00–22:00 连续分钟空间，但不依赖背景网格表达时间。手动课程继续只填写时间并保存 null 节次；课程卡片仅在记录已有非 null 节次时显示节次。

节次仅作为来源信息；展示和提醒使用已确认的实际时间。仅有节次时通过已确认作息映射；来源同时给出节次与时间而冲突时提示用户核对，不静默覆盖。修改作息不暗中改动已有课程时间，后续需要显式预览受影响课程。

## 时间轴布局

七列对应周一至周日，垂直轴连续按分钟计算。top = (开始分钟 - 轴起点分钟) × 每分钟像素；height = (结束分钟 - 开始分钟) × 每分钟像素。课间、午休不压缩、不折叠。

同一天且教学周交集非空、时间区间重叠才算冲突；边界相接不是冲突。重叠安排在对应时段并排显示并提示，避免遮挡。短课不通过提高卡片最小高度破坏比例，完整信息可通过聚焦/点击查看。

优先课程名和时间，其次教室、教师。采用基础 CSS、系统字体、克制的色彩、清晰边界和键盘焦点。小窗口允许日列横向滚动和时间轴纵向滚动，不能挤到文字不可读。

## 后续系统功能约束（仅设计）

Phase 5.1 落地纯逻辑时间模型：`TermConfig` 保存第 1 教学周星期一、总周数和固定 `Asia/Shanghai`；`ReminderSettings` 保存开关和 0–180 分钟提前量，默认关闭、15 分钟。核心根据 Course 的 weeks、weekday 和真实 HH:mm 生成稳定课程实例 key、提醒时刻，并只返回 future/catch-up/none 决策。Phase 5.2 将这些结果转换为 `{ occurrenceKey, triggerAtMilliseconds, courseStartMilliseconds }`：其中时刻是明确的 UTC epoch 毫秒。Phase 5.3 在同一计划附加最小展示 payload（课程名、开始时间、可选教室）。React 在启动、正式数据变化和窗口恢复时从 TypeScript core 重建计划，先排除 SQLite 已 handled key，再经 Tauri 刷新 Rust 单实例 scheduler；Rust 不读 Course、不重算教学周或日期，只以 channel 等待、替换计划、批量报告相同 trigger，并在会话中按 key 去重。due 后由独立 `WindowsNotificationAdapter` 经官方 Tauri plugin 发送系统通知；无论通知尝试成功或失败，scheduler 都会记录 handled，保持 at-most-once delivery attempt。若 handled 写入失败，当前运行仍去重并记录内部错误，下一次重启存在重复风险。scheduler 每分钟复核绝对 wall-clock，补足休眠和明显系统时间跳变；窗口恢复事件也会请求 TypeScript 重新计算。handled 记录在写入时清理超过 400 天的数据，因为已处理 occurrence 不会再成为未来课程。

Windows 通知必须在实际安装的应用中验收；开发态不能代表正式身份及图标。Phase 6 使用官方 `tauri-plugin-autostart`：React 仅经 `src/services/autostart.ts` 调用 `isEnabled`、`enable`、`disable`，设置弹窗打开和重新聚焦时读取系统实际状态，用户切换后立即复读。它不写 SQLite、不增加 migration，默认关闭；系统 API 失败或复读状态与请求不一致时 UI 保留实际已知状态并显示错误。能力仅授予 `autostart:default`（读取、启用、关闭），按当前用户启动，不创建 Windows Service。官方 `tauri-plugin-single-instance` 注册在应用初始化最前面；第二次启动会显示并聚焦已有 `main` 窗口，因此不会创建第二个 reminder scheduler。

Phase 7.1 将小组件限定为同一 Tauri 进程内一个 label 为 `widget` 的独立顶级窗口。创建由 Rust `open_widget` command 负责：已有窗口只调用 `show()`，不调用 `set_focus()`；新窗口加载 `index.html?widget`，使用 `always_on_bottom(true)`、`focused(false)`、无装饰、跳过任务栏和固定 320×180 原型尺寸。窗口可被用户正常点击，但创建与重用不抢主窗口焦点；关闭请求改为隐藏，主窗口生命周期不变。`WidgetPrototype` 只有静态原型文本，不读 Course、SQLite 或 reminder scheduler，也不提供课程内容、今日/本周筛选、设置、位置/尺寸持久化、托盘或通知。这些数据与交互边界留给后续 Phase 7 小阶段。

Phase 4（教务系统导入）已由用户取消，不继续实现相关功能。

## 选型依据（2026-09-08 核查）

- [Tauri Windows 前置条件](https://v2.tauri.app/start/prerequisites/)：Rust、Microsoft C++ 工具与 WebView2。
- [Tauri 通知](https://v2.tauri.app/plugin/notification/)：Windows 安装态限制。
- [Tauri 自启动](https://v2.tauri.app/plugin/autostart/)：启用、关闭、状态查询能力。
- [PDF.js](https://mozilla.github.io/pdf.js/)：PDF 解析与渲染候选。

## Phase 1.2 已实现的时间语义

核心不读取配置，调用方将 TimeRange 轴参数传入 courseTiming，结果仅含分钟偏移与持续量。UI 像素转换留到 Phase 1.3，Course 不携带任何坐标或样式。

时间严格为 HH:mm（00:00–23:59）；非法钟点或结束不晚于开始抛 RangeError。offsetMinutes 可返回轴起点之前的负偏移，courseTiming 则拒绝越界并要求扩展轴；不静默裁剪。idleMinutes 表示按参数顺序的非负空闲量，重叠或逆序时为零；不能用它代替重叠判断。区间采用 [start,end)，相邻课程不重叠。coursesOverlap 还要求同星期及共同教学周。

TEST_TIMETABLE 明确标为测试用，包含测试轴、当前周、像素比例和两条节次样例；Phase 1 UI 只展示同样明确标注的测试课程。它们不代表学校作息。完整课程运行时校验、正式学期和节次设置仍待后续阶段。

开发检查使用 Node 内置 node:test 和 Playwright；oxc-parser 仅用于 AST 架构守卫，oxlint 与 Prettier 负责静态及格式检查。tsconfig.core.json 不提供 DOM 或 Node 全局类型，类型反例测试纳入主 typecheck；所有 core/types/config 禁止 any。
# Version 2.0 预留：日程功能

Version 1.0 不实现日程功能，继续按照当前开发路线完成：

PDF 导入
→ 课程提醒
→ 开机自启动
→ 桌面课程小组件
→ 托盘/发布
→ Version 1.0

Version 2.0 再增加“日程”能力。

预期日程模型与 Course 独立，不把普通日程强行转换为 Course。

未来可能包含：

- 一次性日程
- 重复日程
- 开始/结束时间
- 全天事件
- 地点
- 备注
- 提醒
- 修改单次重复事件
- 删除单次重复事件
- 软删除/归档
- 与课程时间冲突检测
- 在课程表/日历中联合显示

架构原则：

Course
和
ScheduleEvent

属于不同领域实体。

但可以共享：

- TimeRange
- 时间解析
- overlap / conflict 检测
- reminder 基础设施
- SQLite migration 体系
- Windows 通知能力

Version 1.0 期间：

- 不创建 schedules/events 数据库表
- 不增加日程 UI
- 不增加日程 CRUD
- 不提前实现 recurrence
- 不影响当前 Phase 3–6 开发流程

只保留设计扩展点，避免未来架构被 Course 单一模型锁死。
