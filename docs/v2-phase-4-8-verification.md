# Links Workplace v2.0 — Phase 4.8 验证记录

## 最终阶段处置（2026-09-28）

- Ethan 确认：除主动移除的 Daily Summary 外，Phase 4.8 其余人工验收均 PASS。
- Phase 4.8 Core：**COMPLETE**；Phase 4.8.1 Daily Summary：**DE-SCOPED / REMOVED**；Phase 4.8.2 Weather：**Implementation COMPLETE、Automated PASS、AMap Live PASS、Map Picker Live PASS、Windows Manual PASS、Overall COMPLETE**；Phase 4.8 Overall：**COMPLETE**。
- SQLite schema **8** 保留；本次 migration **0**。`daily_summaries` 是 dormant / unused legacy table；应用运行时不读写、不暴露 UI、workflow、设置或 AI context。不执行 downgrade、DROP 或数据清理。
- Phase 4.9 AI Final Acceptance 已开始；本文件较早内容是当时的阶段记录，其中待验收状态不覆盖本节最终处置。Phase 5 仍 **NOT STARTED**。

## 阶段状态

- 起始基线：`47bff6671c4fd97559657894af2aa2013ef89065`（`fix: refine inbox ai workflow and workspace ui`）
- 分支：`v2/workspace-rebase`
- Phase 4.7 / 4.7-P：用户确认人工验收 PASS；未在本阶段重做。
- Phase 4.8 Core Implementation：**COMPLETE**
- Phase 4.8 Core Automated：**PASS**
- Rust 检查：**PASS**
- 本地 Tauri production build：**PASS**（仅构建，未运行或安装）
- Phase 4.8 DeepSeek Live：**PASS**（Ethan 已确认）
- Phase 4.8 Windows Manual：**PASS**（Ethan 已确认）
- Phase 4.8 Core：**COMPLETE**
- Recent Daily Summary：**NOT IMPLEMENTED**；转入独立 Phase 4.8.1，等待 Schema 8 审批
- Phase 4.8.1 Migration Impact Review：**COMPLETE**；Implementation **BLOCKED — SCHEMA 8 APPROVAL REQUIRED**
- Phase 4.9：**NOT STARTED**
- SQLite：schema **7**；本阶段 migration **0**

UI polish commit：`e7b0ce95d6d8bbf6d65211cca9319a2bf8eee2e4`。日期/时间中文显示与个人任务删除弹窗留白修改通过 targeted UI（8 项）、相关单元测试（39 项）、typecheck、lint、Prettier 和 `git diff --check`；无 schema / migration / Rust 修改。

## 实现范围

- 新增工作台每日简报入口与本地 fallback；重要日可自动显示一次，空白日只显示紧凑提示；手动打开/重试不修改自动展示 gate。
- 新增设置偏好：每日简报默认关闭；启用后可配置自动 gate。自动请求异步执行，不阻止工作台；关闭其他模态窗口期间不会在后方弹出简报。
- 新增 `dailyBrief.generate` 结构化只读 workflow，复用现有权限、Context Engine、Provider 与解析边界。只请求当前已授权的 Academic、Planner、Routine、Weather 模块；Provider 无权调用 Proposal / Apply Tool。
- 上下文限定为今日安排与近期截止事项；逾期事项有界并优先呈现较近的逾期项；空截止日期不会被误认为近期任务。Routine 仅使用当天启用项；Weather 只使用与当前地点匹配的本机缓存。
- Provider 输出经 JSON Schema 与本地 schema 校验；任务和候选时段引用必须来自本次有限上下文。用户主动点击建议后复用既有本地 Planner 路由、候选重算、Proposal Review、重校验和确认流程。
- 自动/手动 AI 不可用时保留本机数据整理结果；没有可用授权数据时不检查凭据、不调用 Provider。自动请求不会读取 Diary 正文、Inbox 原文或 AI 历史。

## DailySummary 实体与迁移影响审查

审查 `src-tauri/src/db.rs` 中 schema 7 定义以及应用层实体/查询后，未发现正式 `DailySummary`、`DailyReview`、`DaySummary` 或等价持久业务实体、表、Repository / Query API。现有 schema 7 包含 Diary、Inbox、Routine 等业务表，但它们不是每日总结。

因此本阶段：

- 不把 Diary、AI 对话/响应历史、Inbox 原文或 localStorage 大文本当作 DailySummary。
- 不推断或伪造“连续未推进事项”；结构化简报 `carryOvers` 必须为空。
- “参考最近每日总结（最近 3 天）”选项保持不可用，并在设置中解释原因。
- 不增加 schema 8，不修改迁移代码；schema 维持 7，migration 维持 0。

DailySummary 的独立迁移影响审查已记录在 [`v2-phase-4-8-daily-summary-verification.md`](v2-phase-4-8-daily-summary-verification.md)。结论是正式持久实体无法在 schema 7 中合法复用，必须新增 schema 8 / migration 7→8；尚未获批，不得编码或修改迁移。

## 自动验证结果

所有结果均来自本地命令；未将自动化结果记作真实 DeepSeek 或 Windows GUI 验收。

| 验证 | 结果 |
|---|---|
| 新增无截止日期任务 fallback 回归（Playwright，9 个视口/缩放组合） | PASS：9 passed |
| `npm run verify` | PASS：376 unit、135 architecture、1,119 UI passed / 15 skipped；typecheck、lint、Prettier、frontend build 均 PASS |
| `cargo test --manifest-path src-tauri/Cargo.toml` | PASS：98 passed，0 failed |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | PASS |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | PASS |
| `npm run tauri build` | PASS；当前包元数据版本仍为 1.3.1。生成 EXE、MSI、NSIS 及两个 installer 的 updater `.sig`；未运行或安装产物、未访问 Release 用户数据库 |

### 本地构建产物（仅供本地验证，不提交 Git）

| 产物 | 大小 |
|---|---:|
| `src-tauri/target/release/ntu-course-assistant.exe` | 68,275,200 bytes |
| `NTU Course Assistant_1.3.1_x64_en-US.msi` | 54,456,320 bytes |
| `NTU Course Assistant_1.3.1_x64_en-US.msi.sig` | 436 bytes |
| `NTU Course Assistant_1.3.1_x64-setup.exe` | 52,462,580 bytes |
| `NTU Course Assistant_1.3.1_x64-setup.exe.sig` | 436 bytes |

构建有两条非阻断工具链提示：Vite 的既有大 chunk 提示，以及 Windows linker 的库/对象生成提示；build、Clippy 均成功。

## 人工验收边界

当时 Ethan 已确认 Phase 4.8 Core 的 DeepSeek Live 与 Windows Manual 验收 PASS；本段为历史记录。最终 Phase 4.8 子阶段 disposition 以本文开头的最终处置为准。该历史 `npm run tauri build` 产物未启动、未安装；没有因此推断安装态验收。Phase 4.9 的当前状态见 [`v2-phase-4-9-final-ai-acceptance.md`](v2-phase-4-9-final-ai-acceptance.md)。
