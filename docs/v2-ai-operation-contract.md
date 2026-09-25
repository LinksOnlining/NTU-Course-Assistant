# Links Workplace v2 — AI Operation 安全与权限契约

状态：Phase 4.0 安全与权限契约。当前 SQLite schema 为 7；Phase 4.0 已落地类型契约、Mock Provider 与静态 Registry 元数据，但不代表真实 Provider 调用、AI 界面或 schema 8 已实现。

## 1. 目标与依赖边界

AI 是可选能力，默认关闭、未配置。AI 不属于启动依赖，不能影响 Academic、Planner、Task、Diary、Inbox、Weather、Reminder、Search 或离线工作。

唯一允许的执行方向：

```text
Presentation → AI Application → AIProvider / AIToolRegistry
                                      ↓
                               PermissionGate
                                      ↓
                               Application UseCase
                                      ↓
                               Repository / SQLite
```

AI 及 Provider 永远不得直接访问 SQLite、raw SQL、Tauri 数据库命令或 Repository 实现。业务写入只能通过已有模块公开的 Application UseCase 完成。复用 `WorkplaceModuleRegistry`、`AIToolContribution` 与 `PermissionDefinition`；不得另建第二套 Module Registry 或权限 scope 字符串体系。模块注册层只描述和校验静态 contribution，不持有用户授权或业务状态。

## 2. Tool 类型与注册

每个 Tool 只能是 `read` 或 `proposal`，不存在 `directWrite`。

- **read**：在每次调用时验证输入、模块可用状态和所需权限，只通过对应模块公开的 Application read API 返回最小必要数据；不得产生副作用。
- **proposal**：验证输入并生成结构化 `AIProposal`，不得执行任何业务写入。Tool 返回成功不表示 Proposal 已确认或已应用。

Tool contribution 的实现契约至少要能明确表达稳定 ID（`module.action`）、`moduleId`、kind、用途、所需 permission IDs、输入/输出 schema、受校验的 handler 或 proposal builder，以及独立于权限判断的 `riskLevel`。Phase 4.0 在 `src/application/ai/tool.ts` 建立无执行器的类型契约，并在现有 Registry 增加静态 AI capability 元数据；Registry 的 `aiTools` 仍为空，不执行工具。

注册必须拒绝重复 Tool ID、未知模块、未知权限、跨模块错属、无效 schema / contribution 或静默覆盖。Tool ID 稳定且有序；Provider 不能自行声明或注入注册表外的 Tool。

## 3. PermissionGate

权限标识沿用已有 `module.action`，不使用 Provider 自定义的 scope。新权限默认 DENY；只有用户在应用真实 UI 中主动授予后才可读取。每次 Tool 调用以及 Proposal 确认时都必须重新检查授权，撤销后立即生效。

- 不存在 `workspace.read` 一键读取全部模块的授权。
- `diary.read` 与 `inbox.read` 分别授权，默认关闭；任何通用授权都不能隐含授权这两项。授权 Diary 读取时必须显示额外隐私说明。
- `search.read` 不能越过来源模块权限；未获 `diary.read` 时不得通过 Search 返回日记内容，Inbox 同理。
- `context.read` 仅能取得 Phase 3 已定义的非敏感结构化 Context；不得加入 Diary 正文、Inbox 原文、精确 GPS 或宽泛跨模块个人资料。
- `riskLevel` 用于确认 UI 和风险提示，不能替代 permission check，也不能提升授权。

## 4. 数据能力边界

| 数据 / 操作 | AI 能力边界 |
| --- | --- |
| Academic Course / CourseOverride | 有 `academic.read` 时只读；禁止创建、更新、删除课程及写 CourseOverride。 |
| Exam | 有对应读取权限时只读；禁止修改考试或截止日期。 |
| PersonalTask | 可按权限读取；允许生成 Task 创建/截止日期修改 Proposal，必须展示旧值与新值；禁止直接写入。 |
| PlannerEvent / TimeBlock | 只能依据已授权的 Planner Application API 读取；任何创建或修改只能生成 Proposal，不得直接写入。 |
| Diary | `diary.read` 独立授权后才可读；Phase 4 不提供 Diary 写 Tool。聊天建议文本不自动写回日记。 |
| Inbox | `inbox.read` 独立授权后才可读；Phase 4 不开放 Inbox 写入，尤其不得修改 rawText。 |
| Weather / Routine | 仅通过各自授权的公开 Application API 读取有限结果；不扩展精确位置或其他个人数据。后续确需变更时仍走 Proposal。 |
| Workspace Context / Search | 只提供用户已授权且当前请求必要的最小结果；不能成为模块权限旁路。 |

Course、CourseOverride、Exam deadline、Task deadline、Diary body、Inbox raw text 均不得被静默修改。

## 5. Proposal 生命周期与确认

Phase 4.0 的状态模型为 `draft → reviewRequired → approved → applied`，并允许 `rejected`、`failed` 与 `stale` 终态。状态转移由应用层管理；这些状态不表示当前已经有 Proposal 持久化或执行能力。Proposal 只是待审建议，不是事实，也不是授权。

任何写操作必须按以下顺序：

```text
Proposal → 高可见 Preview → Revalidate → 用户明确确认 → Application UseCase
```

只有用户在应用 UI 中主动点击明确的“确认并应用”等操作才构成确认。模型输出、聊天文字、历史确认、Diary / Inbox 内容、Tool 输出都不是用户确认。

确认前重新检查：目标仍存在、目标 revision / `updatedAt`、当前值与 Proposal 旧值、业务校验、时间冲突、权限授权和 Proposal 状态。目标已变化则标记 `stale`，展示新旧差异并要求重新审阅；绝不以旧 payload 覆盖。应用操作必须幂等，同一 Proposal 至多执行一次；重复点击不得重复创建 Task、Event 或 TimeBlock。应用失败保留失败状态和可安全重试/重新生成的明确结果，不伪报成功。

## 6. Provider 与网络

Provider 通过可替换的 `AIProvider` 边界接入，负责 provider configuration、model、规范化 request / Tool-call response、错误映射和取消。业务 Application、Tool Registry、PermissionGate、Proposal 流程不得依赖某家 Provider 的 raw JSON。首个 adapter 可为经官方文档核实后实现的 OpenAI-compatible Provider；Phase 4.0 不实现或调用 Provider，也不猜测 endpoint / payload。

普通配置只保存 `providerId`、endpoint/base URL、model、`keyConfigured` 与有限 timeout 等非秘密字段。API Key 不进入普通配置对象、SQLite、备份、日志、错误详情或前端持久化；后续实现必须使用 Windows 系统安全凭据存储，并仅在需要时取用。密钥或密码不出现在用户聊天、测试快照、诊断输出或 Release artifact。

Provider 请求仅可由用户主动发送 AI 消息或主动点击“测试连接”触发；同一请求内允许有界的 Tool loop。应用启动、定时任务、Dashboard、天气变化或空闲状态不得触发 AI 网络。调用须有 timeout、取消和有限重试策略；远端 endpoint 必须 HTTPS；仅 `localhost` / `127.0.0.1` 的本地开发或本地模型 endpoint 可使用 HTTP。拒绝 `file:`、`javascript:` 和其他危险 scheme。未授权或未被当前请求需要的数据不得附带发送。

Provider 失败应映射为不泄露密钥、原始响应或内部路径的可恢复错误（未配置、权限拒绝、超时/离线、认证/限流、Provider 错误、响应格式错误、取消）。失败仅影响当前 AI 操作，不阻塞应用其他模块。

## 7. 对话与本地持久化提案

Phase 4.0 只提出 schema 8 设计，当前 schema 仍为 7。Phase 4 计划只做一次 `7 → 8` migration，提案表：

- `ai_threads`：`id`、`title`、`created_at`、`updated_at`，可选 `archived_at`。
- `ai_messages`：`id`、`thread_id`、`role`、`content`、`created_at`；role 仅允许 `user`、`assistant` 和确有必要的本地 UI system event。
- `ai_proposals`：`id`、`thread_id`、`source_message_id`、`module_id`、`action`、`payload_json`、`state`、`risk_level`、`created_at`、`reviewed_at`、`applied_at`、`failure_code` 及必要的前置条件/revision 元数据。
- `ai_permission_grants`：`permission_id`（唯一）、`granted`、`updated_at`；无记录等同 DENY。

`thread → messages/proposals` 可在显式删除 thread 时级联删除。保存只在功能启用且用户使用后发生；对话和 Proposal 留在本机。不得持久化 system prompt、API Key 或不必要的完整 Tool raw payload；日志也不得记录这些内容。未来备份可以包含用户对话、Proposal 和 grant，但绝不包含 API Key。该提案不是本阶段对真实数据库的授权或 schema migration。

## 8. 不可信输入与输出

Diary、Inbox、Search result、Task / Planner 描述、Course 内容均是 `Untrusted User Data`，只能作为引用数据交给模型，不能提升为 system instruction 或授予工具权限。模型指令不得覆盖应用安全策略。Provider 响应、Tool call 参数和结构化 JSON 也都是不可信输入；每次调用须重新做 schema、业务输入、模块状态与 permission 校验。不得因模型声称“用户已同意”或数据中包含类似指令而跳过确认。

提示注入无法通过 prompt 文案本身解决；安全边界必须由代码中的 allow-listed Tool、独立 PermissionGate、最小数据输入、输出 schema 校验及用户确认维持。模型没有浏览器、文件上传、OCR、语音、图像、计算机控制、任意代码执行、第三方 runtime plugin、multi-agent、向量库、RAG server 或后台自动化能力。

## 9. Phase 4.0 验收边界

Phase 4.0 交付 AI Application 类型契约、可替换 Provider 接口、确定性 Mock、权限策略模型、显式 Context 边界、Proposal 状态模型、无执行器的 Tool 合约、现有 ModuleRegistry 的静态 AI capability 元数据、架构测试及文档。不做真实 Provider 请求、AI 页面/运行时、Tool 执行器、权限持久化或授权 UI，也不修改 SQLite schema。Phase 4.1 尚未开始；以后如评审并实施 schema 7→8 migration，仍须使用隔离测试数据库，并保留既有 migration 前备份、单事务、校验、回滚和 future-schema 拒绝门禁，禁止触碰真实 Release 用户数据库。
