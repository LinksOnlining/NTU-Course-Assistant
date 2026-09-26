# Links Workplace v2.0 — Phase 4.0 AI Operation Layer Architecture Foundation

状态：**Phase 4.0 COMPLETE；Phase 4.1 实现、自动验证及 Windows Live Manual 均 COMPLETE / PASS。** `POST /responses` 真实文本与结构化生成尚未执行，待首次正式 AI 工作流进行 smoke test。本文件不表示权限 Runtime、AI 工具或业务数据操作已经实现。

## 1. 产品定位

AI 是可选辅助层，不是业务数据来源。Academic、Planner、Diary、Inbox、Weather、Routine 与 Search 保持各自的数据所有权；AI capability metadata 只说明未来可能的能力，不启用 AI 模块。

## 2. 安全与依赖边界

```text
显式选择与授权
       ↓
AiContextProvider
       ↓
AIProvider
       ↓
AiProposal / 已校验结果
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
- 不存在 `workspace.read`；Diary 与 Inbox 使用各自独立的权限。AI Context 只能来自调用方显式选择的对象、模块、时间与 permission scope，不得自行扫描数据库。

## 3. Provider 架构

`AIProvider` 是可替换接口，定义 `generateText`、经 schema 校验的 `generateStructured` 和 `checkAvailability`。`AiProviderId` 当前为 `mock | deepseek`；Mock 保持离线确定性行为，DeepSeek 实现为该接口的 production adapter。Phase 4.1 不引入 OpenAI SDK 或其他未实现 Provider。

Mock 支持确定性成功、请求失败和不可用三种模式，用于验证消费者不依赖某个真实 Provider。

## 4. Capability 与 Registry

`WorkplaceModuleRegistry` 新增只读 `aiCapabilities` 静态 contribution，包含摘要、规划、建议和分类能力。注册时检查 capability ID 唯一性、模块归属及所需 `module.action` 权限引用，并冻结元数据。

Planner 增加 `planner.propose` 描述性权限。能力只声明所需权限，不构成授权或执行 Gate。AI 模块仍 `available=false`，不新增页面或导航；`aiTools` 仍为空。

## 5. Permission 模型

AI 权限使用来源模块的 `module.action` 标识。当前模型支持 `read`、`propose`、`apply`：未提供明确 grant 时 `allowed=false`；所有非 `read` action 的 `requiresConfirmation=true`。本阶段不存储 grants、不提供权限 UI，也不把纯策略模型作为真实运行时安全 Gate。

Planner 的任务、日程和时间块提案共用当前真实模块 `planner` 的权限域；不虚构尚未存在的 `task`、`event` 或 `timeBlock` module ID。Diary / Inbox 仍须独立授权。未来 apply 权限只作为类型边界，不代表当前存在 apply action 或工具。

## 6. Context Boundary

`AiContextRequest` 要求显式传入 `selectedItems`、`requestedModules`、`permissionScope` 与可选时间上下文；`AiContextBundle` 只承载 workspace 摘要、所选对象引用和按模块隔离的结构化 JSON context。Context provider 不得自行扫描、打开数据库或读取未授权模块；未来实现只能调用相应模块公开的 Application API，并只返回当前请求所需的最小数据。

Diary 正文、Inbox 原文及其他个人内容不得由通用 workspace scope 隐式携带。任何敏感模块上下文都必须与其独立 permission 对应。调用者负责在构造请求前确认授权及数据最小化。

## 7. Proposal 与 Tool Contract

`AiProposal` 是纯应用层建议，不是业务对象或数据库记录。类型包括 Text、Task、Event、TimeBlock、Inbox 和 DiarySuggestion；每个 Proposal 的 `requiresConfirmation` 固定为 `true`。

状态模型：

```text
draft → reviewRequired → approved → applied
  └──────────────→ rejected / failed
reviewRequired ───→ rejected / failed / stale
approved ─────────→ failed / stale
```

`applied` 只能表示未来模块 Application UseCase 成功后的状态；本阶段没有应用、写入或持久化 Proposal 的代码。`AiTool` 仅声明 ID、模块、类型、所需权限、输入/输出 schema 与 risk level，不包含 handler 或 `execute`。

## 8. Phase 4.1 Provider 基础

- DeepSeek 只通过 Native Rust `reqwest` 访问固定 HTTPS endpoint `https://api.deepseek.com`；Tauri 命令专用于 DeepSeek，不提供通用 HTTP 或任意 URL 代理，关闭自动 redirect。WebView CSP 不开放 DeepSeek；连接测试只在用户点击后请求 `GET /models`，不发送 prompt 或 Workspace 数据。
- `POST /responses` 用于文本与 JSON Schema 结构化输出；Rust 收敛最终 assistant `output_text` 为内部 DTO，不向应用层暴露 reasoning 内容或原始 Provider JSON。结构化 JSON 在 Rust 解析后仍由调用方 `AiValueSchema.parse` 再校验。没有工具参数或工具执行。
- API Key 仅经专用 Tauri credential 命令写入 Windows Credential Manager，稳定 namespace 为 `links-workplace.ai` / `deepseek.default`。前端只读取 configured 状态；输入保存完成后清空。凭据服务不可用时 fail closed，不回退明文存储。非敏感 provider/model/reasoning/timeout 设置复用设备本地设置存储，不进入 SQLite。
- AI 设置位于通用设置页。Provider 固定 DeepSeek；默认 `deepseek-flash`，仅允许 `deepseek-v4-pro` 作为当前第二个内建选项。连接测试/模型刷新均由用户主动触发；默认 reasoning 为关闭，超时范围为 5–120 秒。
- Phase 4.1 不使用 AI Context、Permission Gate、Proposal Apply、Tool Runtime 或对任何业务数据的读写。请求仅发送调用者显式提供的 prompt；不保存会话或 reasoning 内容。
- Native 请求设置有限 timeout；本阶段没有 request registry 或 `cancel_ai_request` 命令。显式取消基础按阶段任务允许延期，标记为 **DEFERRED TO PHASE 4.5**，不得视为已实现。

## 9. 数据库与阶段边界

SQLite schema 保持 **7**，migration **0**；Phase 4.1 未增加或读取任何 AI 数据库表，也未访问 Release 用户数据库。非敏感 AI provider settings 使用本地浏览器设置存储；API Key 仅在 Windows Credential Manager。

Ethan 已在 Windows 11 完成真实 `GET /models`、Credential Manager 持久化与删除、断网处理验收。真实 `POST /responses` 文本与结构化生成尚未执行，待首次正式 AI 工作流验收。Phase 4.2 仍未开始；任何 Context Runtime、权限授权 Runtime、Tool 执行、Proposal 应用或 schema 7→8 工作均须单独授权与验证。
