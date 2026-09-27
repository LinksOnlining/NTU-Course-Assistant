# Links Workplace v2.0 — Phase 4.8 验证记录

## 阶段状态

- 起始基线：`47bff6671c4fd97559657894af2aa2013ef89065`（`fix: refine inbox ai workflow and workspace ui`）
- 分支：`v2/workspace-rebase`
- Phase 4.7 / 4.7-P：用户确认人工验收 PASS；未在本阶段重做。
- Daily Brief Core 实现：**COMPLETE**
- 自动化质量门：**PASS**
- Rust 检查：**PASS**
- 本地 Tauri production build：**PASS**（仅构建，未运行或安装）
- DeepSeek Live：**PENDING**；本阶段未使用真实 API Key / 网络调用
- Windows GUI Manual：**PENDING**；未使用 Computer Use
- Recent Daily Summary：**BLOCKED — Migration approval required**
- Phase 4.8 Overall：**PENDING**
- Phase 4.9：**NOT STARTED**
- SQLite：schema **7**；本阶段 migration **0**

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

若以后决定增加 durable DailySummary，至少需要单独审查：

1. Domain 实体、字段来源、生成时机、幂等键与用户删除/保留策略。
2. 独立 Repository / Application Query；AI 只接收最近 3 天且经用户授权的最小摘要，不复用 Diary/Inbox 原文。
3. schema 7→8 的事务、目标版本门禁、失败回滚、migration 前备份、完整性校验、schema 7 用户升级与 fresh DB 直建路径。
4. Phase 3.9 已建立的保护备份与恢复流程兼容性，以及数据隐私、日志、导出/备份和删除语义。
5. 迁移测试矩阵、旧数据保留、重复启动、future schema 拒绝与失败注入。

上述仅为影响审查，不是 schema 8 提案或实施授权。须先取得 Ethan 明确批准。

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

本轮不通过 GUI 自动化冒充人工体验，也不连接真实 DeepSeek。仍需 Ethan 在 Windows 开发态人工检查：默认关闭/开启每日简报、一天一次 gate、空白日提示、手动入口、AI 失败 fallback、结构化内容与授权说明；Recent Daily Summary 因缺少已批准的数据实体保持不可用。`npm run tauri build` 的本地构建产物未启动、未安装，不能作为 Windows 安装态验收。人工验收前不创建 Phase 4.9 工作，不推送、不打 tag、不发布。
