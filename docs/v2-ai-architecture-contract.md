# Links Workplace v2.0 — Phase 4.0 AI Operation Layer Architecture Foundation

状态：**Phase 4.0、Phase 4.1、Phase 4.2 与 Phase 4.3 均 COMPLETE。** Phase 4.2 建立了默认拒绝的运行时读取权限、请求级敏感授权契约与最小化 Context Builder；Phase 4.3 增加了基于模块贡献的瞬态只读 Tool Runtime。Proposal 应用及业务写入仍未实现。DeepSeek `POST /responses` 的真实文本、结构化与 Tool Calling 尚未执行，待首次正式 AI 工作流进行 smoke test。

## 1. 产品定位

AI 是可选辅助层，不是业务数据来源。Academic、Planner、Diary、Inbox、Weather、Routine 与 Search 保持各自的数据所有权；AI capability metadata 只说明未来可能的能力，不启用 AI 模块。

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
- 缺少明确授权时默认拒绝。`propose` / `apply` 权限即使已授权，也始终要求独立用户确认。
- `workspace.read` 仅允许有限工作台汇总，不是跨模块超级权限；Academic、Planner、Routine、Weather 分别授权。Diary 正文与 Inbox 原文使用独立的一次性请求授权。
- AI Context 只能从调用方显式指定的 scope、时间窗口和对象引用，以及已授权模块公开的 Application Query 构造；不得自行扫描数据库。Provider 只接收已完成权限筛选、投影和预算处理的 `AiContextBundle`。

## 3. Provider 架构

`AIProvider` 是可替换接口，定义 `generateText`、经 schema 校验的 `generateStructured`、Provider-neutral `generateToolTurn` 和 `checkAvailability`。`AiProviderId` 当前为 `mock | deepseek`；Mock 保持离线确定性行为，DeepSeek 实现为该接口的 production adapter。Phase 4.1 不引入 OpenAI SDK 或其他未实现 Provider。

Mock 支持确定性成功、请求失败和不可用三种模式，用于验证消费者不依赖某个真实 Provider。

## 4. Capability 与 Registry

`WorkplaceModuleRegistry` 暴露只读 `aiCapabilities` 与 `aiTools` 静态 contribution。Phase 4.3 的六项 Tool contribution 由所属模块声明；运行时 `AIToolRegistry` 仅按稳定 ID 将它们绑定到 Application read adapter，不建立第二套模块系统。注册检查 ID / Provider 名称唯一性、名称格式、模块归属、只读权限和 JSON Schema，并冻结元数据。

Planner 增加 `planner.propose` 描述性权限。能力只声明所需权限，不构成授权或执行 Gate。AI 模块仍 `available=false`，不新增页面或导航；模块 Tool contribution 只声明能力，执行器仅在 Application 层按稳定 ID 绑定。

## 5. Permission 模型

AI 权限使用来源模块的 `module.action` 稳定标识。运行时 `AiPermissionGate` 默认拒绝未知、未授予、空及不受支持的权限。长期读取白名单为 `workspace.read`、`academic.read`、`planner.read`、`routine.read`、`weather.read`，均在 Settings → AI → 数据访问中默认关闭；只保存稳定 ID，不保存显示文案。损坏或被篡改的设置会规范化为允许列表，敏感权限不能进入持久设置。

Diary 正文 `diary.body.read` 与 Inbox 原文 `inbox.raw.read` 只能使用受信任 Application orchestration 在用户针对特定对象明确同意后签发的一次性 grant；grant 绑定单个 request ID 与对象、只在内存中消费一次，不存在“以后都允许”开关。当前没有对应 AI 工作流/同意弹窗，因此并未授权任何实际敏感数据请求。

`propose` / `apply` 权限及所有 mutation 请求在 Phase 4.2 仍为 inactive / DENY；本阶段不启用 Tool、Proposal 执行或业务写入。旧的宽泛 `diary.read` / `inbox.read` 元数据不会授权 Diary body / Inbox raw。

## 6. Context Boundary

`AiContextRequest` 明确包含 request ID、intent、requested scopes、selected items、上游本地时间上下文、可选日期范围、受信任的一次性 grant 与 budget。缺省范围为本地日期起 7 天；无效的对象引用、日期、scope 与超量输入会被拒绝、限制或记录为 omission。

`buildAiContext` 先运行 Permission Gate，只为明确请求且通过授权的模块调用各自 source；各 source 仅接收自身模块的时间范围和对象引用。之后固定 allowlist projector 将安全 Snapshot 投影为只读 Context DTO，再执行预算、脱敏和稳定序列化。Snapshot source 是模块公开 Application Query / UseCase 的注入端口；Context Builder 不访问 Repository、SQLite、Tauri DB command 或 Provider。

Workspace 仅包含本地日期/时间、安排与任务计数、下一空闲时段、当日日记存在状态及 Inbox pending 数等摘要。Academic 仅包含 occurrence、考试、截止事项的必要字段；Planner 仅包含任务、事件、时间块及已计算的 buffer 占用范围；Routine 仅含当前规划需要的简化目标信息；Weather 仅含已选择地点标签、当前天气和当日小时摘要，不含坐标/定位历史。Diary body 与 Inbox raw 只允许来自本次用户选择对象并且有对应 request grant 的投影。字段采用固定 allowlist，额外 Domain Entity 字段不会被序列化。

## 7. Proposal 与 Tool Contract

`AiProposal` 是纯应用层建议，不是业务对象或数据库记录。类型包括 Text、Task、Event、TimeBlock、Inbox 和 DiarySuggestion；每个 Proposal 的 `requiresConfirmation` 固定为 `true`。

状态模型：

```text
draft → reviewRequired → approved → applied
  └──────────────→ rejected / failed
reviewRequired ───→ rejected / failed / stale
approved ─────────→ failed / stale
```

`applied` 只能表示未来模块 Application UseCase 成功后的状态；当前没有应用、写入或持久化 Proposal 的代码。Phase 4.0 的 `AiTool` 仍是无执行器的描述性契约；Phase 4.3 的独立 `AiToolDefinition` 才将只读贡献绑定至 Application read adapter。Runtime 仅暴露 `effect=read`，所有 proposal、mutation、write 工具都不发送给 Provider，也不执行。

## 8. Phase 4.1 Provider 基础

- DeepSeek 只通过 Native Rust `reqwest` 访问固定 HTTPS endpoint `https://api.deepseek.com`；Tauri 命令专用于 DeepSeek，不提供通用 HTTP 或任意 URL 代理，关闭自动 redirect。WebView CSP 不开放 DeepSeek；连接测试只在用户点击后请求 `GET /models`，不发送 prompt 或 Workspace 数据。
- `POST /responses` 用于文本与 JSON Schema 结构化输出；Rust 收敛最终 assistant `output_text` 为内部 DTO，不向应用层暴露 reasoning 内容或原始 Provider JSON。结构化 JSON 在 Rust 解析后仍由调用方 `AiValueSchema.parse` 再校验。没有工具参数或工具执行。
- API Key 仅经专用 Tauri credential 命令写入 Windows Credential Manager，稳定 namespace 为 `links-workplace.ai` / `deepseek.default`。前端只读取 configured 状态；输入保存完成后清空。凭据服务不可用时 fail closed，不回退明文存储。非敏感 provider/model/reasoning/timeout 设置复用设备本地设置存储，不进入 SQLite。
- AI 设置位于通用设置页。Provider 固定 DeepSeek；默认 `deepseek-flash`，仅允许 `deepseek-v4-pro` 作为当前第二个内建选项。连接测试/模型刷新均由用户主动触发；默认 reasoning 为关闭，超时范围为 5–120 秒。
- Phase 4.1 不使用 AI Context、Permission Gate、Proposal Apply、Tool Runtime 或对任何业务数据的读写。请求仅发送调用者显式提供的 prompt；不保存会话或 reasoning 内容。
- Native 请求设置有限 timeout；本阶段没有 request registry 或 `cancel_ai_request` 命令。显式取消基础按阶段任务允许延期，标记为 **DEFERRED TO PHASE 4.5**，不得视为已实现。

## 9. 数据库与阶段边界

SQLite schema 保持 **7**，migration **0**；Phase 4.1 未增加或读取任何 AI 数据库表，也未访问 Release 用户数据库。非敏感 AI provider settings 使用本地浏览器设置存储；API Key 仅在 Windows Credential Manager。

Ethan 已在 Windows 11 完成真实 `GET /models`、Credential Manager 持久化与删除、断网处理验收。真实 `POST /responses` 文本、结构化与 Tool Calling 尚未执行，待首次正式 AI 工作流验收。Phase 4.2 / 4.3 没有 schema 变更、持久化 Tool 状态或 Proposal 应用。

## 10. Phase 4.2 运行时实施边界

- 数据访问记录只持久化五个稳定、非敏感读取 scope，默认全部关闭；API Key 配置状态与数据读取授权彼此独立。
- Context Builder 只通过注入的模块 source 取得 Snapshot；source 错误按模块隔离，不暴露异常正文、凭据或本机路径。
- 总预算默认 32 KiB UTF-8、每模块 8 KiB、每字符串 512 字符、每模块最多 50 项、最多 20 个所选对象。超限会确定性裁剪，并在 budget 元数据中报告已用字节、省略数与受截断模块。
- Windows 绝对路径和常见 secret/token 形态在投影中替换为安全占位符；Context 序列化前完成处理。
- 关闭全部读取授权时，Builder 不调用模块 sources，且不改变 Phase 4.1 Provider 的既有行为。
- 完整实现及验证结果记录于 [`v2-phase-4-2-verification.md`](v2-phase-4-2-verification.md)。

## 11. Phase 4.3 只读 Tool Runtime

- 唯一 source 是 `WorkplaceModuleRegistry.aiTools`。Runtime 以稳定 module contribution 顺序绑定六个内建工具：`workspace_get_overview`、`academic_get_upcoming`、`planner_get_open_items`、`planner_get_schedule`、`routine_get_today`、`weather_get_summary`。每个工具均限定到所属模块的一个 `*.read` 权限。
- 每次请求重新读取权限设置。未授权工具在发送给 Provider 前被过滤；无可用工具时使用 `tool_choice=none` 且不发送空 `tools` 数组。执行时再次检查同一 Permission Gate。未注册调用不会模糊匹配；所有非 `read` effect 永不暴露或执行。
- Provider-neutral Runtime 位于 TypeScript Application Layer；只使用 `AiToolDefinition` 和固定 Application Query。它不导入 Repository、SQLite、Tauri DB command 或 DeepSeek Raw DTO。DeepSeek adapter 只映射为 Responses API function definitions；Rust 只处理专用、固定 DeepSeek HTTPS transport 与协议 DTO，不提供通用 Tool/HTTP/DB executor。
- Provider function arguments 按不可信输入处理：JSON parse → JSON Schema → module domain validation → permission → 执行。每项 Tool 输出经过固定 allowlist projection、复用的路径/凭据脱敏、output schema 校验与稳定 UTF-8 预算；结果以真实 Provider `call_id` 配对回送。
- Loop 限制：最多 4 次 Provider round、8 次 Tool call、每 round 4 次调用；调用按 Provider 响应顺序串行执行。完全相同的规范化 `tool name + args` 在单次请求内只执行一次。请求结束即释放 transient transcript/cache，不保存 prompt、call history、reasoning 或 Tool output；Tool 调用不自动重试。
- 输出预算：每项最多 8 KiB、单次请求全部 Tool output 合计最多 24 KiB。超限按稳定规则裁剪并携带 `truncated` / `omittedCount`；错误采用最小安全错误对象，不暴露异常、数据库信息、本机路径或 secret。
- Tool function parameters 与响应大小均受 Native 上限约束；Responses API `function_call` / `function_call_output` 使用真实、唯一且配对的 `call_id`。Tool loop 固定 `reasoning=none`，并告知 Provider Tool results 是不可信的应用数据。
- 六项工具的字段、权限、loop/budget、自动化验证与 live 限制见 [`v2-phase-4-3-verification.md`](v2-phase-4-3-verification.md)。无用户可见 AI Prompt、Chat 或 Tool Debug UI；Diary body、Inbox raw、Search、generic DB/HTTP/file/shell、Proposal 与所有写入均未启用。
