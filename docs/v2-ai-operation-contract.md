# Links Workplace v2 — AI Operation 安全与权限契约

状态：Phase 4.0 安全与权限契约；Phase 4.1 Provider 基础与 Phase 4.2 读取权限 / Context Runtime 已完成。SQLite schema 仍为 7。AI Tool 执行、Proposal 应用、AI 对话与 schema 8 均未实现。

## 1. 目标与依赖边界

AI 是可选能力，默认关闭、未配置。AI 不属于启动依赖，不能影响 Academic、Planner、Task、Diary、Inbox、Weather、Reminder、Search 或离线工作。

数据读取方向：

```text
显式请求 → AiPermissionGate → 已授权模块 Application Query
          → 固定 Context Projector → 脱敏 / 预算 → AiContextBundle
          → 未来由用户显式触发的 AIProvider
```

AI 与 Provider 永远不得直接访问 SQLite、raw SQL、Tauri 数据库命令或 Repository 实现。Phase 4.2 的 Context Builder 只消费由模块公开 Application Query / UseCase 提供的 Snapshot，且只将处理完成的 Bundle 交给 Provider。业务写入仍只能通过模块公开 Application UseCase；本阶段没有写入路径。复用 `WorkplaceModuleRegistry` 与 `PermissionDefinition`，不另建 Module Registry 或 Provider-defined permission scope。模块注册层只描述和校验静态 contribution，不持有用户授权或业务状态。

## 2. Tool 类型与注册

每个 Tool 只能是 `read` 或 `proposal`，不存在 `directWrite`。

- **read**：在每次调用时验证输入、模块可用状态和所需权限，只通过对应模块公开的 Application read API 返回最小必要数据；不得产生副作用。
- **proposal**：验证输入并生成结构化 `AIProposal`，不得执行任何业务写入。Tool 返回成功不表示 Proposal 已确认或已应用。

Tool contribution 的实现契约至少要能明确表达稳定 ID（`module.action`）、`moduleId`、kind、用途、所需 permission IDs、输入/输出 schema、受校验的 handler 或 proposal builder，以及独立于权限判断的 `riskLevel`。Phase 4.0 在 `src/application/ai/tool.ts` 建立无执行器的类型契约，并在现有 Registry 增加静态 AI capability 元数据；Registry 的 `aiTools` 仍为空，不执行工具。

注册必须拒绝重复 Tool ID、未知模块、未知权限、跨模块错属、无效 schema / contribution 或静默覆盖。Tool ID 稳定且有序；Provider 不能自行声明或注入注册表外的 Tool。

## 3. Runtime PermissionGate（Phase 4.2）

权限沿用稳定 `module.action` ID，不接受 Provider 自定义 scope。运行时 Gate 默认拒绝未知 scope、空 scope、未授权 scope、敏感 scope 无有效 request grant，以及所有尚未启用的 mutation scope。

持久读取白名单为 `workspace.read`、`academic.read`、`planner.read`、`routine.read`、`weather.read`；Settings → AI → 数据访问中均默认关闭。`workspace.read` 仅给有限聚合摘要，不含 Diary 正文、Inbox raw、Task/Event 隐藏备注或任意完整模块实体。各模块 scope 独立，不存在超级权限。

`diary.body.read` 与 `inbox.raw.read` 只允许由可信 Application orchestration 在当前请求明确选择具体对象、显示相应隐私说明并征得用户同意后发放一次性 grant。grant 绑定 request ID 和一个对象，只在内存中使用一次；不能写入 settings、localStorage 或其他持久化。当前没有 Diary AI / Inbox AI 工作流，所以尚未实现真正 consent dialog，也不会产生实际敏感读取请求。旧的 `diary.read` / `inbox.read` 兼容定义不授权正文或原文。

Mutation / proposal / apply scope 保留为契约，但在 Phase 4.2 不活动并一律 DENY。Phase 4.3+ 的 Tool 调用或 Proposal 确认仍须在执行时重新检查授权；本节不代表那些运行时已经存在。

## 4. 数据能力边界

| 数据 / 操作 | AI 能力边界 |
| --- | --- |
| Academic Course / CourseOverride | 有 `academic.read` 时只读；禁止创建、更新、删除课程及写 CourseOverride。 |
| Exam | 有对应读取权限时只读；禁止修改考试或截止日期。 |
| PersonalTask | 可按权限读取；允许生成 Task 创建/截止日期修改 Proposal，必须展示旧值与新值；禁止直接写入。 |
| PlannerEvent / TimeBlock | 只能依据已授权的 Planner Application API 读取；任何创建或修改只能生成 Proposal，不得直接写入。 |
| Diary | 普通摘要仅允许 `workspace.read` 的 `hasDiaryToday` / 日期状态；正文 `diary.body.read` 必须是当前请求、当前对象的一次性授权。Phase 4.2 不提供 Diary AI 工作流或写入。 |
| Inbox | 普通摘要仅允许 `workspace.read` 的 pending 数量；原文 `inbox.raw.read` 必须是当前请求、当前对象的一次性授权。Phase 4.2 不提供 Inbox AI 工作流或写入。 |
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

Phase 4.0 的历史交付范围包括 AI Application 类型契约、可替换 Provider 接口、确定性 Mock、静态权限策略、Proposal 状态模型、无执行器 Tool 合约与 Registry 元数据。当前 Phase 4.1 Provider 基础和 Phase 4.2 runtime read permissions / Context Builder 已另行完成；SQLite schema 仍为 7。未来如评审并实施 schema migration，仍须使用隔离测试数据库，并保留备份、事务、验证、回滚与 future-schema 拒绝门禁，禁止触碰真实 Release 用户数据库。

## 10. Phase 4.2 Runtime Read / Context

Context permission 使用 `workspace.read`、`academic.read`、`planner.read`、`routine.read`、`weather.read` 五个默认关闭的持久读取项。受限范围、敏感字段和 one-shot grant 以 `docs/v2-ai-architecture-contract.md` 及 `docs/v2-phase-4-2-verification.md` 为准。Gate → module source → allowlist projection → budget/redaction → Bundle 的流水线完成后，未来才可由明确调用者把 Bundle 传给 Provider；Phase 4.2 本身不触发 Provider 网络。

`diary.body.read` / `inbox.raw.read` grant 只能通过不从公开 AI barrel 导出的内部 Application grant issuer 创建，并由 WeakSet 一次性校验；grant 本身不进入 settings。所有写操作、Tool Runtime、Proposal Apply 仍未启用。Context source 失败被单独隔离并只记安全类别，不影响应用其它模块。
