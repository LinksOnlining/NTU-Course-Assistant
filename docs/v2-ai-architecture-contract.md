# Links Workplace v2.0 — Phase 4.0 AI Operation Layer Architecture Foundation

状态：**Phase 4.0–4.7-P COMPLETE；Phase 4.8 Core COMPLETE；Phase 4.8.1 Daily Summary DE-SCOPED / REMOVED；Phase 4.8.2 Weather COMPLETE（用户确认 Live 与 Windows Manual PASS）；Phase 4.8 Overall COMPLETE；schema=8，当前 migration=0。Phase 4.9 AI Final Acceptance：Implementation / Hardening COMPLETE、Automated PASS；DeepSeek Live 与 Windows Manual PENDING，Overall PENDING；Phase 5 NOT STARTED。** Phase 4.2 建立默认拒绝的读取权限、请求级敏感授权与最小化 Context Builder；Phase 4.3 建立有限轮次 Tool Runtime；Phase 4.4 建立 Planner Proposal Review；Phase 4.5 增加一次性 Today Assistant；Phase 4.6 扩展本地可信 Planner 路由与未来日期提案；Phase 4.7 增加单条 Diary / Inbox 的 Consent-gated 工作流；Phase 4.8 保留有界、只读的 Daily Brief 核心。Daily Summary 不再属于产品运行时；schema 8 的 legacy table 为 dormant / unused，仅保留迁移兼容性。无 AI Apply Tool、聊天历史或持久化 AI 状态。

## 1. 产品定位

AI 是可选辅助层，不是业务数据来源。Academic、Planner、Diary、Inbox、Weather、Routine 与 Search 保持各自的数据所有权；Phase 4.5 只通过工作台一次性助手调用已完成的 AI 能力，不开放独立 AI 一级导航或通用聊天模块。

## 2. 安全与依赖边界

```text
显式请求 + 已授权的模块读取
       ↓
各模块公开 Application Query
       ↓
AiPermissionGate → AiContextProjector
       ↓
预算 / 脱敏 → AiContextBundle
       ↓
未来由调用方显式触发的 AIProvider
       ↓
不可信 Provider 输出 / 未来 Proposal
       ↓
Preview → Revalidation → 用户确认
       ↓
模块 Application UseCase
       ↓
Repository / SQLite
```

- AI Application 不依赖 Repository、SQLite、Tauri DB command、Rust 业务或网络 SDK。
- 模型输入、Provider 输出和 Proposal payload 均是不可信数据；结构化输出经调用方 `AiValueSchema.parse` 校验。
- AI 不拥有业务事实；不得直接创建或修改 Course、CourseOverride、Exam deadline、Task、Event、TimeBlock、Diary 或 Inbox 数据。
- 缺少明确授权时默认拒绝。Planner 提案仅通过 `planner.propose` 与本地 workflow Tool allowlist 生成；任何业务写入都只能在用户明确确认后经既有 Application UseCase 发起，不提供 AI 可调用的 Apply、Mutation 或 Write Tool。
- `workspace.read` 仅允许有限工作台汇总，不是跨模块超级权限；Academic、Planner、Routine、Weather 分别授权。Diary 正文与 Inbox 原文使用独立的一次性请求授权。
- AI Context 只能从调用方显式指定的 scope、时间窗口和对象引用，以及已授权模块公开的 Application Query 构造；不得自行扫描数据库。Provider 只接收已完成权限筛选、投影和预算处理的 `AiContextBundle`。

## 3. Provider 架构

`AIProvider` 是可替换接口，定义 `generateText`、经 schema 校验的 `generateStructured`、Provider-neutral `generateToolTurn` 和 `checkAvailability`。`AiProviderId` 当前为 `mock | deepseek`；Mock 保持离线确定性行为，DeepSeek 实现为该接口的 production adapter。Phase 4.1 不引入 OpenAI SDK 或其他未实现 Provider。

Mock 支持确定性成功、请求失败和不可用三种模式，用于验证消费者不依赖某个真实 Provider。

## 4. Capability 与 Registry

`WorkplaceModuleRegistry` 暴露只读 `aiCapabilities` 与 `aiTools` 静态 contribution。Phase 4.3 的六项只读 Tool 与 Phase 4.4 的三个 Planner Proposal Tool 均由所属模块声明；运行时 `AIToolRegistry` 按稳定 ID 绑定 Application adapter，不建立第二套模块系统。注册检查 ID / Provider 名称唯一性、名称格式、模块归属、effect 与 permission 的对应关系、JSON Schema，并冻结元数据。

Planner 增加 `planner.propose` 描述性权限。能力只声明所需权限，不构成授权或执行 Gate。AI 模块仍 `available=false`，不新增页面或导航；模块 Tool contribution 只声明能力，执行器仅在 Application 层按稳定 ID 绑定。

## 5. Permission 模型

AI 权限使用来源模块的 `module.action` 稳定标识。运行时 `AiPermissionGate` 默认拒绝未知、未授予、空及不受支持的权限。长期读取白名单为 `workspace.read`、`academic.read`、`planner.read`、`routine.read`、`weather.read`，均在 Settings → AI → 数据访问中默认关闭；只保存稳定 ID，不保存显示文案。损坏或被篡改的设置会规范化为允许列表，敏感权限不能进入持久设置。

Diary 正文 `diary.body.read` 与 Inbox 原文 `inbox.raw.read` 只能在对应对象的本地同意弹窗中由用户选择“仅本次允许”后进入当前请求。一次性 grant 绑定单个 request ID、权限和所选对象，Gate 只在内存中消费一次；取消、Esc、背景关闭、失败或重试均不会复用授权，不存在“以后都允许”开关。当前工作流为 `diary.reflectSelected` 与 `inbox.interpretSelected`，均只处理一个显式选择的对象。

敏感正文以带 `sourceType`、`sourceId` 和 `trust: untrusted-user-content` 的结构化 envelope 作为用户数据传入；外层 envelope 标记字符在序列化文本中转义，固定 system instructions 由 native intent 映射提供。解释工作流不开放 Proposal Tool；Inbox Proposal 只有在用户看到识别结果后再次主动选择“生成任务建议”或“生成活动建议”时才开始，并分别只开放一个本地 allowlist Tool。原文不进入 Proposal；确认仍走既有 Preview、Revalidate、用户确认和 Application UseCase。Diary 全只读；没有自动写入、全量读取、后台处理或持久化敏感结果。

`planner.propose` 是 Planner 模块级 Proposal authorization，不等同于业务写入。Phase 4.2 初始 Runtime Gate 尚未开放 Proposal；Phase 4.4 在每次 orchestration 中另行接收本地 workflow grant 与 proposal-tool allowlist。旧的宽泛 `diary.read` / `inbox.read` 元数据不会授权 Diary body / Inbox raw。

## 6. Context Boundary

`AiContextRequest` 明确包含 request ID、intent、requested scopes、selected items、上游本地时间上下文、可选日期范围、受信任的一次性 grant 与 budget。缺省范围为本地日期起 7 天；无效的对象引用、日期、scope 与超量输入会被拒绝、限制或记录为 omission。

`buildAiContext` 先运行 Permission Gate，只为明确请求且通过授权的模块调用各自 source；各 source 仅接收自身模块的时间范围和对象引用。之后固定 allowlist projector 将安全 Snapshot 投影为只读 Context DTO，再执行预算、脱敏和稳定序列化。Snapshot source 是模块公开 Application Query / UseCase 的注入端口；Context Builder 不访问 Repository、SQLite、Tauri DB command 或 Provider。

Workspace 仅包含本地日期/时间、安排与任务计数、下一空闲时段、当日日记存在状态及 Inbox pending 数等摘要。Academic 仅包含 occurrence、考试、截止事项的必要字段；Planner 仅包含任务、事件、时间块及已计算的 buffer 占用范围；Routine 仅含当前规划需要的简化目标信息；Weather 仅含已选择地点标签、当前天气和当日小时摘要，不含坐标/定位历史。Diary body 与 Inbox raw 只允许来自本次用户选择对象并且有对应 request grant 的投影。字段采用固定 allowlist，额外 Domain Entity 字段不会被序列化。

## 7. Proposal 与 Tool Contract

`AiProposal` 是纯应用层建议，不是业务对象或数据库记录。类型包括 Text、Task、Event、TimeBlock、Inbox 和 DiarySuggestion；Planner Proposal 的 `requiresConfirmation` 固定为 `true`。

状态模型：

```text
draft → reviewRequired → approved → applied
  └──────────────→ rejected / failed
reviewRequired ───→ rejected / failed / stale
approved ─────────→ failed / stale
```

`applied` 仅表示用户明确确认后，既有 Planner Application UseCase 成功完成。Proposal 本身仅存于内存，默认 15 分钟过期；不持久化为业务记录。见 Phase 4.4 的双层授权与 workflow allowlist 约束。Provider 不能直接触发 Apply、Mutation 或 Write Tool。

## 8. Phase 4.1 Provider 基础

- DeepSeek 只通过 Native Rust `reqwest` 访问固定 HTTPS endpoint `https://api.deepseek.com`；Tauri 命令专用于 DeepSeek，不提供通用 HTTP 或任意 URL 代理，关闭自动 redirect。WebView CSP 不开放 DeepSeek；连接测试只在用户点击后请求 `GET /models`，不发送 prompt 或 Workspace 数据。
- `POST /responses` 用于文本与 JSON Schema 结构化输出；Rust 收敛最终 assistant `output_text` 为内部 DTO，不向应用层暴露 reasoning 内容或原始 Provider JSON。结构化 JSON 在 Rust 解析后仍由调用方 `AiValueSchema.parse` 再校验。没有工具参数或工具执行。
- API Key 仅经专用 Tauri credential 命令写入 Windows Credential Manager，稳定 namespace 为 `links-workplace.ai` / `deepseek.default`。前端只读取 configured 状态；输入保存完成后清空。凭据服务不可用时 fail closed，不回退明文存储。非敏感 provider/model/reasoning/timeout 设置复用设备本地设置存储，不进入 SQLite。
- AI 设置位于通用设置页。Provider 固定 DeepSeek；默认 `deepseek-flash`，仅允许 `deepseek-v4-pro` 作为当前第二个内建选项。连接测试/模型刷新均由用户主动触发；默认 reasoning 为关闭，超时范围为 5–120 秒。
- Phase 4.1 不使用 AI Context、Permission Gate、Proposal Apply、Tool Runtime 或对任何业务数据的读写。请求仅发送调用者显式提供的 prompt；不保存会话或 reasoning 内容。
- Native 请求设置有限 timeout；本阶段没有 request registry 或 `cancel_ai_request` 命令。显式取消基础按阶段任务允许延期，标记为 **DEFERRED TO PHASE 4.5**，不得视为已实现。

## 9. 数据库与阶段边界

SQLite schema 保持 **7**，migration **0**；Phase 4.1 未增加或读取任何 AI 数据库表，也未访问 Release 用户数据库。非敏感 AI provider settings 使用本地浏览器设置存储；API Key 仅在 Windows Credential Manager。

Ethan 已在 Windows 11 完成真实 `GET /models`、Credential Manager 持久化与删除、断网处理验收；并确认 Phase 4.5 的 `POST /responses` 文本与结构化输出、真实 Workspace Context 分析、授权数据约束及无合法业务对象时不虚构 Proposal 均 PASS。`planner_propose_time_block`、Proposal Review 与 Confirm → Revalidate → Application Write live 未执行，延期至后续正式 Planner AI workflow，不构成 Phase 4.5 blocker。Phase 4.2–4.5 没有 schema 变更、持久化 Tool 状态或 Proposal 记录。

## 10. Phase 4.2 运行时实施边界

- 数据访问记录只持久化五个稳定、非敏感读取 scope，默认全部关闭；API Key 配置状态与数据读取授权彼此独立。
- Context Builder 只通过注入的模块 source 取得 Snapshot；source 错误按模块隔离，不暴露异常正文、凭据或本机路径。
- 总预算默认 32 KiB UTF-8、每模块 8 KiB、每字符串 512 字符、每模块最多 50 项、最多 20 个所选对象。超限会确定性裁剪，并在 budget 元数据中报告已用字节、省略数与受截断模块。
- Windows 绝对路径和常见 secret/token 形态在投影中替换为安全占位符；Context 序列化前完成处理。
- 关闭全部读取授权时，Builder 不调用模块 sources，且不改变 Phase 4.1 Provider 的既有行为。
- 完整实现及验证结果记录于 [`v2-phase-4-2-verification.md`](v2-phase-4-2-verification.md)。

## 11. Phase 4.3 Tool Runtime

- 唯一 source 是 `WorkplaceModuleRegistry.aiTools`。Phase 4.3 将六项内建只读工具按稳定 module contribution 顺序绑定至 Application Query；每个工具均限定到所属模块的一个 `*.read` 权限。
- 每次请求重新读取权限设置。未授权只读工具在发送给 Provider 前被过滤；无可用工具时使用 `tool_choice=none` 且不发送空 `tools` 数组。执行时再次校验权限。Proposal tools 另见 Phase 4.4。
- Provider-neutral Runtime 位于 TypeScript Application Layer；只使用 `AiToolDefinition` 和固定 Application Query。它不导入 Repository、SQLite、Tauri DB command 或 DeepSeek Raw DTO。DeepSeek adapter 只映射为 Responses API function definitions；Rust 只处理专用、固定 DeepSeek HTTPS transport 与协议 DTO，不提供通用 Tool/HTTP/DB executor。
- Provider function arguments 按不可信输入处理：JSON parse → JSON Schema → module domain validation → permission/capability → 执行。只读 Tool 输出经过固定 allowlist projection、复用的路径/凭据脱敏、output schema 校验与稳定 UTF-8 预算；结果以真实 Provider `call_id` 配对回送。
- Loop 限制：最多 4 次 Provider round、8 次 Tool call、每 round 4 次调用；调用按 Provider 响应顺序串行执行。完全相同的规范化 `tool name + args` 在单次请求内只执行一次。请求结束即释放 transient transcript/cache，不保存 prompt、call history、reasoning 或 Tool output；Tool 调用不自动重试。
- 输出预算：每项最多 8 KiB、单次请求全部 Tool output 合计最多 24 KiB。超限按稳定规则裁剪并携带 `truncated` / `omittedCount`；错误采用最小安全错误对象，不暴露异常、数据库信息、本机路径或 secret。
- Tool function parameters 与响应大小均受 Native 上限约束；Responses API `function_call` / `function_call_output` 使用真实、唯一且配对的 `call_id`。Tool loop 固定 `reasoning=none`，并告知 Provider Tool results 是不可信的应用数据。
- 六项读取工具的字段、权限、loop/budget、自动化验证与 live 限制见 [`v2-phase-4-3-verification.md`](v2-phase-4-3-verification.md)。Phase 4.5 仅增加一次性 Today Assistant UI，不提供通用 Chat 或 Tool Debug UI；Diary body、Inbox raw、Search、generic DB/HTTP/file/shell 与业务写入均未开放。

## 12. Phase 4.4 Planner Proposal Runtime

- Planner Proposal permission 统一为 `planner.propose`，表示模块级 Proposal authorization；不按 Proposal 对象类型拆分权限。
- Tool 粒度由本地 workflow capability allowlist 控制：`planner.propose` 未获准时不暴露任何 Proposal Tool；已获准但没有 workflow proposal capability 时同样不暴露；task/event/timeBlock workflow 各自只暴露对应的 `planner_propose_task`、`planner_propose_event` 或 `planner_propose_time_block`。Provider 直接伪造注册名也会在执行入口重新校验 allowlist。
- 三个 Proposal Tool 只校验参数并创建短时内存态 proposal。Provider 无 Apply 工具；多 Proposal 调用在执行前拒绝；proposal tool 结束后 orchestration 停止，不让 Provider 对刚生成的 proposal 追加执行操作。
- Proposal review 组件是可复用本地 UI；截至 Phase 4.4 阶段结束时尚未连接生产 AI 工作流，Phase 4.5 的 Today Assistant 已复用该组件。预览字段与冲突提示由本地应用生成；冲突为 warn-but-allow。确认时检查 proposal 状态、过期时间、权限、预览 revision 和关联任务/日程变化。外部日程或关联任务变化时更新预览并要求二次确认；过期或关联任务失效则标 stale。
- 用户点击本地确认后，仅调用现有 `createPersonalTask`、`createPlannerEvent` 或 `createTimeBlock` Application UseCase；取消、未确认和 stale 路径不写入。确认结果只在 UseCase 成功后标记 applied；同一 proposal 的并发确认被 single-flight 保护，失败为终态以避免不确定写入的自动重试。无 SQLite schema/migration 变化，proposal 不持久化。
- 单元及 Mock UI E2E 覆盖权限与 allowlist、Provider 伪造调用、创建/预览/取消/确认、重校验、冲突刷新、过期/失败及幂等行为。DeepSeek 真实 `POST /responses` Tool Calling 未执行；未启用正式用户 workflow。
- 验证记录：[`v2-phase-4-4-verification.md`](v2-phase-4-4-verification.md)。

## 13. Phase 4.5 Today Assistant 工作流

- Workspace Rail 内联显示一次性 Composer、结果及 Proposal Review，无需点击第二层弹窗；只有用户发送内容或点击快捷操作后才调用 provider。启动、进入工作台、改权限均不会自动请求。支持发送按钮与 Ctrl/Cmd+Enter，Enter 保留换行；没有聊天、会话、AI 历史或数据库持久化。
- Workflow 定义是本地可信配置，固定为 `today.analyze` 与 `today.plan`，声明请求 scopes、只读工具 allowlist、提案工具 allowlist 和结果模式。请求仅携带当前 Settings → AI 已授权的 scope；所有模块读取继续经过 Phase 4.2 Context Engine 和预算投影。
- `today.analyze` 仅允许授权的只读工具，结构化结果经 provider JSON Schema 与本地 schema 双重校验；任何 Planner Proposal Tool 调用都会被拒绝。一次性自然语言由本地确定性路由选择 workflow；模糊请求默认 `today.analyze`，明确要求安排时间块时才进入 `today.plan`。`today.plan` 沿用相同的 scope-aware read tools，并将该用户动作解释为本次 workflow 的 `planner.propose` 能力；仅暴露 `planner_propose_time_block`，每次最多一个内存态提案。
- 提案不会自动应用。生产路径复用 Phase 4.4 `AiProposalReview`、preview/revalidation、明确本地确认和既有 Planner Application UseCase；纯文本回答即使声称已经创建，也始终按未修改状态显示。
- 系统 instructions 通过固定 Rust intent 映射提供；tool-turn 指令不得将请求限定为只读函数，而须告知 Provider 只能调用本请求实际提供的函数；Proposal function 仅创建待审提案、不执行写入。Workspace/Planner/Academic 标题及其他业务值是不可信数据。Diary 正文、Inbox 原始内容和 Search 不进入 Today Assistant。天气仅使用已授权且已有的缓存，不增加联网请求。一次性用户文字不超过 500 字符。
- 模型输出在 UI 中按今日概览、需注意事项、建议安排、信息限制与来源分区显示；轻量清理 Markdown 语法，不将原始 Markdown 当作结构化界面呈现。真实 Proposal 预览在工作台 Rail 内联显示任务、日期、开始/结束、时长与 buffer，并仍复用 Phase 4.4 本地取消、重校验与确认链路。
- DeepSeek 请求复用当前 Settings 中 provider、模型、reasoning 与 timeout；不新增 API、provider、schema、权限设置或自动重试。关闭/失败后允许用户手动重试；请求在运行时 single-flight，native timeout 仍有效；没有停止按钮，取消保留为未实现能力。
- 当前冻结范围的 DeepSeek 文本、结构化、Workspace Context 与授权边界已由 Ethan 验收通过。`planner_propose_time_block` Live、Proposal Review Live、Confirm → Revalidate → Application Write Live 尚未执行，明确延期且不是 Phase 4.5 blocker。后续 Planner AI workflow 可单独设计并验收 future-date context、PlannerEvent Proposal，以及既有 PersonalTask 的 TimeBlock Proposal；意图路由应区分“已有任务 + 安排时间”与“自然活动 + 指定时间”。以上均不属于 Phase 4.5，不得在本阶段扩展实现。
- 详细实现、验收结果及明确延期项见 [`v2-phase-4-5-verification.md`](v2-phase-4-5-verification.md)。

## 14. Phase 4.6 Planner Assistant Expansion

- `planner.route` 是一次性本地 Application 路由入口；日期、相对日期、星期/周末范围、daypart、精确时间、时长、Task/Activity 意图和目标时区均由本地代码解析，不让 Provider 决定意图或计算日期。范围最多 31 天；daypart 统一为 morning 06:00–12:00、afternoon 12:00–18:00、evening 18:00–22:00、late 22:00–24:00。
- 本地路由区分只读分析、独立 PlannerEvent、唯一精确匹配的已有 PersonalTask TimeBlock、明确创建 PersonalTask 和澄清。无对话历史/数据库记忆；缺失关键信息时澄清，不模糊猜 Task，不自动串联“创建 Task + 安排 TimeBlock”。
- Future Context 复用 Phase 4.2 Context Engine、Academic Application 查询和 Planner Application 查询。Academic 使用 canonical effective occurrences；查询限定目标日期区间，最多 50 项并对截断上下文拒绝生成安全候选。Weather 仅使用已授权且已缓存的数据，不触发位置或天气网络请求。Diary body、Inbox raw、Search 与任意数据库访问仍未开放。
- 日程候选仅由本地调用现有 Timeline `computeFreeTimeIntervals` / `effectiveOccupancy` 计算，包含 PlannerEvent/TimeBlock buffers、有效课程、考试和取消状态；今天跳过已经过去的分钟。固定明确时间可保留 warn-but-allow 冲突并在预览标注；普通范围选择首个确定性合法候选，且候选长度精确等于请求时长。
- `PlannerCandidateSlot` 携带由本地日期与起止钟点确定性生成的 `candidateId`、本地 `date/startTime/endTime`、同一注入时区派生的 ISO `start/end`、`durationMinutes`、warnings 和 source window。Event/TimeBlock Tool 只接收本请求的 `candidateId`；运行时对 ID 与单次 proposal constraint 做严格匹配，Adapter 只使用不发给 Provider 的可信本地 `canonicalPayload`。缺失/伪造 ID、额外 provider start/end 都拒绝；Provider 不生成时间事实。
- 时间业务契约仍为 Planner 本地日期与钟点，不把 ISO UTC 文本与本地时间字符串直接比较。Event Preview 展示活动、日期、时间段和时长；确认前不写入，确认后继续走 Phase 4.4 的过期/冲突/关联对象重校验与现有 Application UseCase。TimeBlock 表示计划执行时间，PersonalTask deadline 表示最晚完成时间；安排 TimeBlock 不得修改 Deadline。未来若用户明确要求修改 Deadline，必须通过独立的 Old Deadline → New Deadline Proposal、Preview、User Confirm、Revalidate 与 Application UseCase；不得与 TimeBlock Proposal 捆绑静默修改。
- Proposal gate 保持 `planner.propose`（Planner 模块级授权）加 workflow-specific 单一 Proposal Tool allowlist。每次最多一个 Proposal；禁止 AI Apply/Write。只有用户本地确认后，既有 Proposal Runtime 才重校验并调用现有 Application UseCase。
- 自动化验证、Production Build、SQLite schema=7/migration=0 及 Ethan 确认的 Windows/DeepSeek Live 验收结果见 [`v2-phase-4-6-verification.md`](v2-phase-4-6-verification.md)。Phase 4.6 Overall：COMPLETE；Phase 4.7 状态见本契约第 15 节。

## 15. Phase 4.7 Selected Sensitive Workflows

- `diary.reflectSelected` 只读取当前选中的单篇 Diary Entry，返回受本地 schema 限制的摘要、主题、观察、建议与限制；只读、不创建 Proposal、不写回。`inbox.interpretSelected` 只读取当前选中的单条 Inbox raw text，生成有界结构化识别结果；模糊日期/时间由本地确定性解析约束，不猜测。
- `diary.body.read` / `inbox.raw.read` 不是持久权限。用户每次需要在对象范围清晰的 Consent dialog 中作出“仅本次允许”；grant 绑定 permission、request ID、object type/ID，单次消费。Retry、切换对象、重新挂载、取消、Esc 或背景关闭不能保留 grant。Settings 不提供永久授权开关。
- 敏感预算：Diary 正文最多 16 KiB UTF-8，Inbox 原文最多 8 KiB UTF-8，单个模块 envelope 最多 18 KiB，Context 最多 32 KiB；截断保留 `truncated` 与省略字节数，并在结果限制中展示。返回 schema 对未知字段、无效日期/时间及超长文本拒绝。
- Diary / Inbox 正文、完整 prompt、模型输出、Proposal payload 和 API Key 不进入应用日志或持久存储。请求与结果只存在本次运行内存；无 history、memory、RAG、vector DB、后台扫描或自动请求。
- Inbox 解释不会自动产生 Proposal。用户必须在识别结果后第二次点击任务/活动 CTA；task 与 event 分别只暴露自身 Proposal Tool，不开放 TimeBlock Tool，也不向 Proposal/Preview 传递完整 raw。Proposal 仍须本地预览、重校验、用户确认后调用 Inbox Application UseCase；重复确认服从既有 idempotency。
- Phase 4.7-P 的 Inbox 识别草稿只存在当前 UI 会话内，用户可本地编辑标题、描述及对应 Task/Event 字段；原始 Inbox 内容保持只读，不把编辑结果写回 raw 或 parse payload。生成 Proposal 时仅传当前选择的类型级 Tool，Proposal payload 采用经过本地校验的编辑草稿；确认仍要求既有 Review、Revalidate 与用户明确确认。
- Inbox 语义归一化把模型返回视作不可信候选：本地校验标题、提取可确定的日期/时间/地点/时长并拆出补充说明；原文 passthrough 会回退为本地拆分并提示人工检查，模糊时间不猜测。Proposal 仍只使用当前可编辑 Draft，不从 rawText 重建。
- Inbox AI 确认可原子转换 `pending` 且无 parse kind 的原始捕获，或 `needs_review/unknown` 项目；此路径只在本地 AI Proposal 确认后调用，不修改原始文本或解析结果。现有 `ready` 项仍必须与目标类型匹配，忽略项仍拒绝转换；SQLite schema/migration 不变。已知后端状态错误只映射为白名单用户提示，未知存储异常不回显数据库路径或内部细节。
- Phase 4.7 与 4.7-P 的实现、自动门禁和 Ethan 确认的 Windows / DeepSeek 人工验收见 [`v2-phase-4-7-verification.md`](v2-phase-4-7-verification.md)。Phase 4.7 Overall：COMPLETE；Phase 4.7-P Overall：COMPLETE；Phase 4.8 当前状态见第 16 节。

## 16. Phase 4.8 Daily Brief（当前运行时）

- `dailyBrief.generate` 是单独的只读结构化工作流；只请求已授权的 `academic.read`、`planner.read`、`routine.read`、`weather.read`，不包含 read/proposal tools，不提供写入或 Apply 能力。Context 经既有 Context Engine 固定投影与预算约束；不读取 Diary 正文、Inbox raw、AI 历史或未授权模块。
- Academic 与 Planner 快照仅投影今日安排及有限近期截止事项；逾期事项按最近逾期优先并有界截断，无有效截止日期的事项不当作近期任务。Weather 仅使用位置匹配的本地缓存；Routine 仅使用当天启用项。无授权数据时不查询凭据、不调用 Provider；Provider 故障保留本机 fallback。
- AI 结果使用结构化 JSON Schema 与本地 parser 双重校验；任务 ID / 空闲候选 ID 必须来自当前有限本地上下文。Daily Brief 工作流本身只生成建议。用户主动点击安排建议后才进入现有 `planner.route`，重新计算本地候选并经过既有 Proposal Review、重校验与用户确认。
- 自动简报默认关闭，按 Asia/Shanghai 日期最多自动展示一次；只在重要日展示完整弹窗，空白日显示紧凑本地提示且不自动请求 AI。设置打开时不在后方弹出简报。手动入口可随时重试，不改变自动展示 gate。偏好只包含非敏感 UI 状态。
- Daily Brief 只读取本次运行所需、已授权且有界的当前业务事实；不读取 DailySummary / 近期总结、Diary 正文、Inbox raw 或 AI 历史。Daily Brief 不包含历史 Carry-over、AI Memory 或持久化对话能力。
- Daily Summary 已由产品决策从 v2 移除。`daily_summaries` 表随 schema 8 保留为 dormant / unused legacy schema；应用运行时不查询、不写入该表，不暴露 UI、workflow、设置或 context。既有 schema 迁移完整性校验继续保留；本轮不删表、不降级、不新增 migration。
- Phase 4.8 与 Phase 4.8.2 用户验收状态见 [`v2-phase-4-8-verification.md`](v2-phase-4-8-verification.md) 和 [`v2-phase-4-8-2-weather-location-verification.md`](v2-phase-4-8-2-weather-location-verification.md)。Daily Summary 移除的历史实现记录见 [`v2-phase-4-8-daily-summary-verification.md`](v2-phase-4-8-daily-summary-verification.md)。Phase 4.9 自动、Live 与 Windows Manual 状态见 [`v2-phase-4-9-final-ai-acceptance.md`](v2-phase-4-9-final-ai-acceptance.md)。
