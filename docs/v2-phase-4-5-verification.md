# Links Workplace v2.0 — Phase 4.5 验证记录

状态：**Implementation COMPLETE；Automated PASS；DeepSeek Live PENDING；Overall PENDING。Phase 4.6 NOT STARTED。** 本阶段未创建 tag、未 push、未发布；待 Ethan 完成本人 DeepSeek 实机验收。

## 1. 基线与范围

- 项目：`D:\AI_Workspace\Projects\NTU-Course-Assistant`
- Branch：`v2/workspace-rebase`
- Phase 4.5 原始实现基线：`e7508043f6b59e73b7f1067027afdf3ec1b94466`；本轮回归修复起始 HEAD：`53eaab5cae21cc8cedc597b2aa18ca8ab7920e81`。
- SQLite schema：**7**；新增 migration：**0**。
- 实现范围：工作台一次性 Today Assistant、两种本地 workflow、授权上下文与工具边界、现有 Proposal Review 集成。
- 不实现聊天/历史/AI memory、Diary AI、Inbox AI、Search、自动化请求、schema 8、AI Apply Tool 或新业务模型。

## 2. Workflows 与调用边界

- `today.analyze`：使用 Context Engine；依据当前授权 scopes 筛选只读 tools；结构化输出经 provider schema 与本地 parser 校验。任何 proposal tool 不可用；伪造的 Planner proposal 调用会被拒绝且不会执行。
- `today.plan`：使用相同的授权只读 tools；“帮我安排今天”的当次用户动作提供 workflow-local `planner.propose` capability；仅 allowlist `planner_propose_time_block`，至多一个待审 proposal。
- 两种 workflow 均使用固定的 `AiWorkflowDefinition`，包含 requested scopes、read/proposal allowlist 和 response mode。只在按钮触发后调用 Provider；每个 orchestrator single-flight，无自动重试。
- 仅应用现有 Settings 中当前选择的 DeepSeek provider/model/reasoning/timeout；生产服务由 `DeepSeekProvider` 与应用注册的 `AIToolRegistry` 组成。

## 3. Proposal、安全与隐私

- Proposal 只进入内存态 review；复用 `AiProposalReview` 的本地 preview、重校验、显式确认和 Phase 4.4 Application UseCase。无 AI Apply Tool、静默 Apply 或持久化 proposal。
- 系统指令经固定 Rust intent 映射；模型输入及应用数据不可信。用户输入限制 500 字符，结果 schema/字符串有界并复用路径、凭据脱敏。
- Diary body、Inbox raw、Search、通用数据库/HTTP/文件/命令工具不进入本工作流；Weather 仅读已授权缓存，不新增网络请求。
- 模型文本即使声称“已经创建”，在无本地 applied result 时仍被标记为纯文本建议、未修改应用数据。
- 真实 API Key 未读取、未输出、未写入仓库；未发起任何真实 DeepSeek 请求。

## 4. UI

- Workspace Rail 内联呈现 Composer 与结果，无二级弹窗；不增加一级 AI 导航、不自动请求。
- 支持自由文本发送、Ctrl/Cmd+Enter、Enter 换行、pending 去重和三种快捷操作。模糊请求由本地确定性路由默认选择 `today.analyze`；明确安排时间块请求选择 `today.plan`。
- 今日概览、风险、建议、信息限制与来源分区呈现，清理 Markdown 标记；真实 Proposal 审阅在结果下方内联显示任务、日期、起止时间、时长与 buffer。
- 无取消按钮；Native 请求 timeout 生效，取消能力延后。
- Mock Playwright 验证常规窗口与 720×520 浅色/深色视口；真实 Windows UI / DeepSeek live 人工验收待 Ethan 执行。

## 5. 自动验证

- 本轮 Targeted unit + architecture：**30 tests PASS**；Targeted Playwright：**36 tests PASS**（Composer、路由、结构化呈现、proposal review/confirm、低高度浅/深色与 Workspace Rail）。
- TypeScript typecheck：**PASS**。
- 最终完整 `npm run verify`：**PASS**；315 unit、130 architecture、993 UI PASS / 15 条件跳过；typecheck、lint、Prettier 和前端 production build 均 PASS。完整 UI 回归使用默认 8 个视口；无失败。
- Rust：`cargo test --manifest-path src-tauri/Cargo.toml` **96 PASS**；`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` **PASS**；`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` **PASS**。
- 当前修改后 `npm run tauri build`：**PASS**，应用版本仍为 **1.3.1**。本次生成 EXE（约 64.8 MiB）、MSI（约 51.9 MiB）、NSIS（约 50.0 MiB），并生成各自 436 字节 updater `.sig`；签名和安装包时间戳对应本次构建。产物留在被忽略的 `src-tauri/target/release`，未运行 EXE、未安装 MSI/NSIS、未访问 Release DB。
- 私钥未读取或输出；本地构建进程确认 signing 环境变量存在，`.sig` 确实由本次构建产生。未检查或修改 GitHub Actions Secret。

## 6. Live Gate

| 项目 | 状态 |
| --- | --- |
| DeepSeek `GET /models` / Credential Manager（Phase 4.1 历史人工验收） | PASS |
| Phase 4.5 `POST /responses` text | NOT EXECUTED |
| Phase 4.5 `POST /responses` structured | NOT EXECUTED |
| Phase 4.5 `POST /responses` tool calling | NOT EXECUTED |
| Proposal creation / preview / revalidation / user confirmation / Application write | NOT EXECUTED live |
| DeepSeek API Key 是否向 Codex 暴露 | NO |

Ethan 的 live 首次验收应使用本人安全配置与明显的测试 Planner 项目；确认创建后可由本人手动清理测试数据。不得把 API Key 提供到聊天。

## 7. Database / Git / 阶段

- Schema：**7**；migration：**0**；无 schema 8。
- Production EXE：未运行；installer：未安装；Release DB：未访问。
- 生产产物：`NTU Course Assistant_1.3.1_x64-setup.exe`、`NTU Course Assistant_1.3.1_x64_en-US.msi`，以及对应 `.sig`；均为本次 HEAD 构建。
- 本验证记录与实现一并纳入 Phase 4.5 收口提交；提交号以 Git 历史为准。
- Push / tag / Release：**NO**。
- Phase 4.5 Implementation：**COMPLETE**。
- Phase 4.5 Automated：**PASS**。
- Phase 4.5 DeepSeek Live：**PENDING**。
- Phase 4.5 Overall：**PENDING**。
- Phase 4.6：**NOT STARTED**。

## 8. 本轮人工验收阻断修复

- 回归起始 HEAD：`53eaab5cae21cc8cedc597b2aa18ca8ab7920e81`；修复范围仅限 Today Assistant UI、proposal preview 与 native tool-turn instructions，不改 schema、权限契约、Proposal apply 边界或稳定性提交。
- 提案未出现的根因已定位到 Native Provider 请求指令：本地 registry 和 `today.plan` workflow 已正确筛出并暴露 `planner_propose_time_block`，tool loop 能解析并执行该函数，真实应用 adapter 也能生成 Proposal；但 `tool_turn_request_body` 又无条件附加“只能使用本请求提供的只读函数”，与已暴露的 Proposal function 相矛盾。`tool_choice=auto` 保持有意设计，因此模型在冲突指令下返回纯文本，而不是函数调用。没有证据表明 Proposal 写入绕过、DB/schema 或确认流程有问题。
- 修复后 Native instructions 仅允许调用当前请求实际提供的函数，并明确 Proposal function 只创建待审提案、不会写入；明确安排请求在合法且参数可满足时应调用 Proposal function，否则说明原因、不虚构，也不强迫生成提案。Provider function list 仍由本地 `planner.propose` + workflow allowlist 控制，未增加 Apply Tool。
- 自由文本 workflow 选择由本地确定性路由完成：模糊/普通请求默认 `today.analyze`，明确安排时间块才选择 `today.plan`。Composer、结构化结果、来源/限制和真实 Proposal Review 改为 Workspace Rail 内联，无聊天记录；输入按钮、Ctrl/Cmd+Enter、pending 去重及手动重试均有测试覆盖。
- `AiProposalReview` 的既有弹窗模式仍保留给 Phase 4.4 原有调用者；Today Assistant 仅用 inline 模式呈现。提案预览补充 Task、Date、Start、End、Duration、buffers，未改变 Proposal DTO / 持久化或 Apply 语义。
- 本轮真实 DeepSeek `POST /responses` 仍未执行；自动验证只能证明已暴露函数、可信指令、完整 tool-call/adapter/result 通路以及 UI 确认边界，不等价于模型现场一定选择函数。DeepSeek live 仍待 Ethan 在本人 Windows 环境验收。
- 未使用真实 API Key，未启动或访问 Release 用户数据库；schema 仍为 7、migration 0；未运行 production EXE/installer。
