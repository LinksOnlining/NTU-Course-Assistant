# Links Workplace v2.0 — Phase 4.5 验证记录

状态：**Implementation COMPLETE；Automated PASS；DeepSeek Live PENDING；Overall PENDING。Phase 4.6 NOT STARTED。** 本阶段未创建 tag、未 push、未发布；待 Ethan 完成本人 DeepSeek 实机验收。

## 1. 基线与范围

- 项目：`D:\AI_Workspace\Projects\NTU-Course-Assistant`
- Branch：`v2/workspace-rebase`
- 起始 HEAD：`e7508043f6b59e73b7f1067027afdf3ec1b94466`
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

- Workspace Rail 提供低干扰“AI 助手”入口；不增加一级 AI 导航、不默认弹窗、不自动请求。
- 一次性输入、分析今天、安排今天、加载状态、结果/来源/限制、手动重试、未授权/未配置设置入口及现有提案审阅均在同一面板呈现；无聊天气泡或历史。
- 无取消按钮；Native 请求 timeout 生效，取消能力延后。
- Mock Playwright 验证常规窗口与 720×520 深色视口；真实 Windows UI / DeepSeek live 人工验收待 Ethan 执行。

## 5. 自动验证

- Targeted unit + architecture：**28 tests PASS**（Today workflow、tool runtime、boundary）。
- Targeted Playwright：**7 tests PASS**（按需调用、pending 去重、授权/配置入口、手动重试、proposal review/confirm、hallucinated-success 防护）。
- TypeScript typecheck：**PASS**。
- 完整 `npm run verify`：**PASS**；313 unit、130 architecture、948 UI PASS / 15 条件跳过；typecheck、lint、Prettier 和前端 production build 均 PASS。Playwright 使用独立 loopback Vite 服务完成；为避开已运行的开发服务，临时使用空闲端口，测试后已恢复配置。
- Rust：`cargo test` **95 PASS**；`cargo fmt -- --check` **PASS**；`cargo clippy --all-targets -- -D warnings` **PASS**。本阶段修改了 Rust 的固定可信 intent 映射与对应安全测试。
- `npm run tauri build`：**PASS**。产品版本仍为 **1.3.1**；生成 EXE、MSI、NSIS 及两种 installer 的 updater `.sig`。EXE 约 64.8 MiB，MSI 约 51.8 MiB，NSIS 约 50.0 MiB；各 `.sig` 约 436 字节。未运行 production EXE、未安装 MSI/NSIS、未访问 Release DB。
- 生产构建包含 updater signing artifacts；未记录或输出 signing private key / password。

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
