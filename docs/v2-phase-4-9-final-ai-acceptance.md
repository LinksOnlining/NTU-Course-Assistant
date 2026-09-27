# Links Workplace v2.0 — Phase 4.9 AI Final Acceptance

## 当前检查点

- 起始 branch：`v2/workspace-rebase`
- 起始 HEAD：`8c3d812a8faf5d694ebf79a4de47e5f77ad3738d`
- 当前 schema：8；本轮 migration：0
- Phase 4.8：**COMPLETE**
- Phase 4.8.1 Daily Summary：**DE-SCOPED / REMOVED**
- Phase 4.8.2 Weather：用户确认 Implementation、Automated、AMap Live、Map Picker Live、Windows Manual 均 **PASS**；Overall **COMPLETE**
- Phase 4.9：Implementation / Hardening **COMPLETE**；Automated **PASS**；Live DeepSeek 与 Windows Manual **PENDING**；Overall **PENDING**。Phase 5：**NOT STARTED**。

## Daily Summary 移除边界

| 能力 | 当前状态 |
|---|---|
| 工作台 UI / Dialog / Preview / Edit / Save | REMOVED |
| AI generation workflow / registration / prompt | REMOVED |
| Daily Brief recent-summary context / carry-over | REMOVED |
| 设置项与偏好字段 | REMOVED；旧 localStorage 字段被忽略，写回时归一化丢弃 |
| Tauri commands / runtime repository methods | REMOVED |
| SQLite schema 8 `daily_summaries` table | 保留为 dormant / unused legacy schema；不由运行时读写 |
| Migration / destructive cleanup | 本轮 migration=0；不 DROP、不 downgrade、不清理旧数据 |
| Memory / RAG / Vector DB / Chat History | NOT IMPLEMENTED |

## 最终 AI 能力 / 安全回归台账

| 范围 | 自动回归 | 真实 Live / Windows |
|---|---|---|
| Provider GET `/models`、text、structured、tool calling | PASS（自动门禁） | PENDING；不得以 mock 记作 live |
| Timeout、network、401、429、5xx、invalid response | PASS（自动门禁） | PENDING（真实错误码若未实际触发则注明模拟） |
| Credential Manager 存储、frontend 不回传 secret、日志脱敏 | PASS（自动门禁） | PENDING |
| Persistent permissions 默认拒绝、关闭后不投影数据 | PASS（自动门禁） | PENDING |
| Sensitive Diary/Inbox consent 的 object/request/single-use 绑定 | PASS（自动门禁） | PENDING |
| Context 最小化、预算、Diary/Inbox raw 隔离、Weather 权限 | PASS（自动门禁） | PENDING |
| Diary/Inbox/业务文本 Prompt Injection | PASS（自动门禁） | PENDING |
| Read tools 校验与无隐藏写入 | PASS（自动门禁） | PENDING |
| Task/Event/TimeBlock Proposal → Preview → Revalidate → Confirm → Application UseCase | PASS（自动门禁） | PENDING |
| TimeBlock 不改变 Task Deadline；未来日期与模糊时间 | PASS（自动门禁） | PENDING |
| Daily Brief opt-in、每日 gate、本地 fallback、无历史总结 | PASS（自动门禁） | PENDING |
| Weather / 位置隐私 / offline cache | Phase 4.8.2 验收已由 Ethan 确认 PASS；Phase 4.9 自动回归待记录 | 既有 Phase 4.8.2 Live / Manual PASS；Phase 4.9 不重复声称新验收 |
| Light / Dark、多窗口尺寸、frameless window | PASS（Playwright 自动门禁） | PENDING（Windows GUI） |

## Phase 4.9 Live DeepSeek 清单

以下必须由实际 Provider / 应用链路完成；没有使用真实凭据和实际调用的项目不标 PASS：

- GET `/models`
- 普通文本生成
- 结构化结果生成
- Tool calling
- Read Tool、Task Proposal、Event Proposal、TimeBlock Proposal
- Sensitive Diary、Sensitive Inbox
- Daily Brief
- 无 Key、离线、timeout、401、429、5xx、invalid response、权限撤销、stale proposal、重复确认与 Prompt Injection

**当前状态：PENDING。**

## 最终门禁结果

最终自动门禁（2026-09-28）：

- `npm run typecheck`：PASS
- `npm run verify`：PASS；378 unit、140 architecture、1155 Playwright passed / 15 skipped、lint、Prettier、frontend build PASS
- Rust tests：PASS；105 passed、1 ignored
- `cargo fmt -- --check`：PASS
- `cargo clippy --all-targets -- -D warnings`：PASS
- `npm run tauri build`：PASS；仓库内既有 release EXE 被运行中的进程占用，未终止该进程，改用隔离的临时 Cargo target directory 完成构建。产物：`ntu-course-assistant.exe`（68,264,960 bytes）、`NTU Course Assistant_1.3.1_x64_en-US.msi`（54,476,800 bytes）、`NTU Course Assistant_1.3.1_x64-setup.exe`（52,401,813 bytes），以及 MSI / NSIS 各自的 `.sig`（各 436 bytes）。未运行 EXE、未安装 MSI/NSIS。

Windows 真实 GUI 人工验收：**PENDING**。自动浏览器测试不等同于 Windows WebView / frameless 窗口人工验收。

## 阶段状态

- Phase 4.9 Implementation / Hardening：COMPLETE。
- Phase 4.9 Automated：PASS。
- Phase 4.9 DeepSeek Live：PENDING。
- Phase 4.9 Windows Manual：PENDING。
- Phase 4.9 Overall：PENDING。
- Phase 5：NOT STARTED。
- Push / Tag / Release：本阶段不执行。

## 本轮小型 UI polish

- 主界面 AI 助手标题由“AI 助手 ✨”改为“AI 助手”；仅去除装饰星光，不改变 AI 功能或交互。
- 本轮未进行 Windows GUI / DeepSeek Live 验收，因此相关状态仍为 PENDING。
