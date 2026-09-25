# Links Workplace v2.0 — Module Extension Contract

状态：Phase 3.M 基础契约；Phase 4.0 仅扩展静态 AI capability 元数据。仍为编译期内部模块扩展，不改变产品版本、SQLite schema 或模块业务事实。

## 目的与非目标

通过稳定的 Module ID 和统一 contributions，让内置模块逐步接入 Route、Navigation、Settings、Search、Context、权限与 AI capability 元数据。Academic / Planner 继续沿用已稳定的页面与 Application API；Diary、Inbox、Weather、Routine、Search 通过轻量注册适配器接入，不要求一次性全面插件化。

本契约只支持源码编译时注册的内部模块。它不支持第三方运行时插件、DLL、远程代码、JS eval、插件安装包、插件商店或运行时增删模块；也不实现 AI runtime、工具执行、权限 UI、任意 Dashboard 卡片或 Timeline 插件。

## ModuleRegistry 与声明

- `src/modules/contracts.ts` 定义稳定 `ModuleId`、模块描述和最小 contribution 类型；显示名称不能充当 ID，ID 不是用户设置。
- 稳定 Module ID、路由、对象引用、搜索类别与 Context 输入/字段仍可保持精确类型；未来内置模块通过编译期 TypeScript 声明合并扩展 `ModuleIdMap`、`AppRouteMap`、`ObjectRefMap`、`WorkspaceSearchCategoryMap`、`WorkspaceContextProviderInputMap` 与 `WorkspaceContextFragmentMap`，不把导航类型降级为任意字符串。
- `src/modules/built-in-modules.ts` 是内置模块声明清单，`src/modules/registry.ts` 在应用启动导入时建立只读 `workplaceModuleRegistry`。
- Registry 只聚合声明、发现 capability、验证并排序 contribution；不访问 SQLite、不保存业务数据，也不充当 Repository 或 Application Service。
- Registry 检查模块、Route、Navigation、Settings、Search、Context、Permission、AI capability 与 AI Tool ID 的重复项；Typed Route 重复、跨模块错误归属、无效权限引用或 capability 实现不匹配均明确失败，不静默覆盖。
- 所有有序 contribution 以 `order` 后接稳定 ID 排序，不依赖文件导入顺序。注册数据在建立后冻结。
- 模块状态区分 `registered`、`available` 和 `enabled`。Weather 已注册且可用，但默认不启用；AI 已注册但当前不可用。用户启用状态仍由各自设置来源决定。

## 扩展点

| 扩展点 | 当前消费方式 | 边界 |
| --- | --- | --- |
| Route | 以 `AppRoute` 注册；Shell 查询统一 registry。现有路由由兼容组合层渲染，新模块可提供编译期 renderer。 | 导航仍使用 `NavigationTarget` / `ObjectRef`；不接受字符串拼接路由或不受约束的动态加载。 |
| Navigation | Shell 按 `placement`、`order` 和注册 metadata 生成产品模式、课表子导航及 Header 操作。 | 入口必须指向本模块已注册的 typed route；无模块名分支表。 |
| Settings | 设置分组和页面顺序由 `SettingsContribution` 生成；可选静态页面 renderer 由统一设置呈现边界消费。 | 新页面以自身 contribution 注册；既有作息、提醒等稳定设置继续使用当前实现，不进行大规模迁移。 |
| Search | 每个实际提供搜索能力的模块通过自己的 Application SearchProvider 读取数据；Search Core 只并行调用 provider、隔离失败、合并索引并做确定性排序。 | Search Core 不读取模块 SQLite 表、不依赖模块 Repository；TimeBlock 不单独重复搜索。Diary / Inbox 正文只用于本机匹配与短摘要。搜索类别可由新模块声明扩展。 |
| Context | `WorkspaceContextProvider` 按 provider ID 绑定，只有其自己的结构化输入；片段字段可由模块声明扩展，单个 provider 异常被隔离。 | Diary 仅 `hasDiaryToday`；Inbox 仅待整理数量；Weather 只拿天气快照，不拿个人模块输入；Routine provider 复用既有建议用例。不得传入日记正文、Inbox 原文或跨模块个人内容。 |
| Permission | `PermissionDefinition` 只定义稳定的 `module.action` 元数据，当前用于架构扩展准备。 | 目前没有权限 UI、授权持久化或执行 Gate；Diary 权限域始终独立，不存在覆盖它的 `workspace.read`。 |
| AI Capability | Phase 4.0 的 AI 能力描述以静态 `AICapabilityContribution` 接入现有 Registry，并验证所需权限引用。 | 只描述摘要、规划、建议和分类能力；不启用 AI 模块，不新增导航或页面，不绑定 Provider 或执行逻辑。 |
| Future AI Tool | `AIToolContribution` 只描述工具 ID、所属模块和所需权限。 | `aiTools` 当前仍为空；不调用 LLM、不执行工具。继续复用本 Registry 与 `module.action` 权限元数据，不创建第二套 Module Registry / scope；执行路径必须经 AITool Registry → Permission Gate → Application UseCase → Repository，绝不直达 SQLite。安全、Proposal、Provider 与 schema 8 边界见 `docs/v2-ai-operation-contract.md`。 |

## 依赖与隐私规则

- `src/modules` 只依赖稳定共享类型；不依赖 Application、服务、数据库或 Presentation。
- 模块只通过自己的公开 Application API 暴露数据与操作；模块之间不得导入彼此内部 Repository。Workspace/Shell 是编译期组合边界，不把模块私有存储接口暴露给 Search Core。
- 数据库连接、schema 版本、migration 与事务仍由中央 DB infrastructure 管理；模块不自行执行 startup migration。
- Dashboard 仍由产品控制；当前 Timeline sources 仍限于 AcademicOccurrence、PlannerEvent、TimeBlock。不存在任意模块插卡或新增 Timeline source 的入口。
- optional Search / Context provider 单独失败不能使整个搜索、Context 或工作台崩溃；Weather Context 故障保留其他安全摘要和默认值。Provider 输入按 ID 隔离，不共享含多个模块数据的宽泛输入对象。

## 模块接入约定

新增内部模块应先声明稳定 ID、可用状态和明确的 metadata，再仅贡献当前实际具备的扩展点。Provider 实现必须经 ModuleRegistry 声明绑定，重复、缺失、额外或错属实现都应在开发/测试时失败。新增模块不得要求对 Shell、Search Core、Context Core 或 AI Core 添加按模块 ID 分支；如某个扩展点尚无实际消费者，不创建空接口或空 Registry。

本契约是后续内部模块逐步接入的边界，不构成第三方插件 API 或运行时兼容承诺。
