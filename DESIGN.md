# 基础设计（Phase 0 提议）

实施状态（2026-09-09）：Phase 1、Phase 2、Phase 2.5、Phase 2.6 和 Phase 2.7 已通过验收。课程添加、编辑和删除以及用户作息通过 Rust `rusqlite` 持久化；连续时间轴按真实分钟显示节次、实际时间和课程位置。导入、提醒等后续能力尚未实现。真实 PDF 检查见 docs/pdf-sample-review.md；该文件没有实际钟点，需要经确认的正式作息配置。

## 技术方案

采用 Tauri 2 + React + TypeScript + Rust，Vite 构建前端、npm 管理前端依赖。选择基于 Windows 11、时间轴 UI 开发效率和本地系统集成需要。采用系统 WebView2，安装包与内存优势是选型预期，具体体积、CPU、内存必须由实际构建测量，不承诺数字。

Rust 仅负责桌面宿主及必要系统 IO；不引入服务器、全局状态库、UI 大组件库或 ORM。相比 Electron，该选择符合复用系统 WebView 的方向；相比切换 C#/WinUI，保留用户优先评估的 Web UI 技术栈，避免同时改变语言和 UI 开发方式。代价是维护 TypeScript/Rust 两套工具链。

Phase 2.3/2.6 使用 rusqlite 0.40.2 的 bundled SQLite，Rust 存储边界提供课程 CRUD 以及 `load_period_times`、`save_period_times` 两个作息 command；React 通过 `src/services/course-storage.ts` 调用，不接触 SQL。数据库路径由 Tauri `app_local_data_dir()` 解析，实际文件为该目录下 `courses.sqlite3`，不依赖安装目录、源码目录或当前工作目录。

schema 2 包含 `courses` 和 `period_times` 表：id 为文本主键，教师、教室和节次允许 null，星期及节次含 CHECK 约束，时间固定存 HH:mm 文本，weeks 存排序去重数字数组的 JSON 文本；`period_times` 以 period 为主键保存严格校验后的作息。`PRAGMA user_version` 记录 schema 版本；0→1 建课程表、1→2 在事务中创建作息表并更新版本，遇到高于程序支持的版本时拒绝打开且不修改数据库。数据库使用 3 秒 busy timeout、WAL 和外键检查，不引入 ORM。

Rust 在命令写入前再次校验 Course，读取时逐行解析 JSON 和校验字段。损坏记录被跳过、记录内部错误并向 UI 返回不含数据库细节的提示；原行不会修改或删除。初始化失败时应用仍打开并禁用添加入口，CRUD 失败时 UI 保留原状态。格式合法但超出当前 UI 时间轴的记录由启动加载边界跳过并提示，避免破坏布局，数据库内容同样保持不变。

Phase 2.4/2.6 用独立数据库验证了首次建库和 schema 2、1→2 migration、连接关闭后重开、合法记录与 JSON/星期/时间/字段类型坏记录混合加载、未来版本拒绝、3 秒 busy timeout 及失败写入不损坏原数据。作息保存先在 Rust 边界完成完整校验，再以事务替换 `period_times`；失败时保留上一份作息。未来 schema 会显示可操作的升级提示；其他初始化错误显示概括提示，SQLite 细节只写入 Rust 日志。React 只在 Rust 写入成功后提交状态，因此课程和作息写入失败均不会制造伪成功。

PDF.js 是 Phase 3 文本型 PDF 提取候选，需真实南通大学样本验证；它不等于课程识别器。学校规则单独解析文本和位置。扫描件首版提示暂不支持，不假装识别成功。当前不安装 PDF 依赖。

## 职责和数据流

React UI → 纯课程/时间轴逻辑；需要外部能力时通过 adapters → Tauri Rust → 本地存储/系统功能。

未来导入：PDFImporter / NTUImporter → ImportCandidate[] + 字段异常 → 统一校验 → 预览及修正 → 用户确认 → Course[] → 存储事务。

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

提醒在 Rust 侧调度，不能仅依赖 WebView 计时器；Phase 5 引入必要托盘驻留及单实例，退出程序后不承诺提醒。按学期日期、周数、星期、真实时间计算提前 15 分钟，重启去重，唤醒后重算且不提醒已结束课程。不设计关机唤醒服务。

Windows 通知必须在实际安装的应用中验收；开发态不能代表正式身份及图标。自启动 Phase 6 默认关闭，用户启用后按当前用户登录启动，读取系统实际注册状态；不创建系统服务。

教务系统数据可行性未知；Phase 4 先查公开官方入口和可合法获得的数据，再研究用户已登录页面导出、HTML/JSON。不能假设应用可直接读取任意浏览器 Cookie。

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
