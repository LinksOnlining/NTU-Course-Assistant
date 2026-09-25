# Links Workplace v2.0 — Phase 4.0 AI Operation Layer Architecture Foundation

状态：**Phase 4.0 COMPLETE**。本文件记录静态架构基础，不代表 AI runtime、真实 Provider、界面或数据库持久化已经实现。Phase 4.1 尚未开始。

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

`AIProvider` 是可替换接口，定义 `generateText`、经 schema 校验的 `generateStructured` 和 `checkAvailability`。`AiProviderId` 预留 `openai` 标识，但本阶段只实现离线 `MockAIProvider`；没有 OpenAI SDK、网络请求、API Key 或供应商配置。

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

## 8. 数据库与阶段边界

SQLite schema 保持 **7**，migration **0**，数据库 **未修改**。本阶段不创建 AI 表，不访问 Release 用户数据库，不修改 Rust、Tauri 配置或产品 UI。

Phase 4.1 尚未开始。任何真实 Provider、安全凭据存储、权限授权 UI、Tool 执行、Proposal 应用或 schema 7→8 工作，均须按后续阶段单独授权和验证。
