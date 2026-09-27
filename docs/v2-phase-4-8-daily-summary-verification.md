# Phase 4.8.1 — Daily Summary Migration Impact Review

状态：**Migration Impact Review COMPLETE；Implementation BLOCKED — 等待 Ethan 明确批准 Schema 8。** 本文是设计与影响审查，不是实现授权。当前数据库 schema 为 7，migration 数为 0；未新增实体、表、Repository、UseCase、UI、migration 或测试实现。Phase 4.9 未开始。

## Phase 4.8 Core 收口

- Implementation：**COMPLETE**
- Automated：**PASS**
- DeepSeek Live：**PASS**（Ethan 确认）
- Windows Manual：**PASS**（Ethan 确认）
- Overall：**COMPLETE**
- Recent Daily Summary：**NOT IMPLEMENTED**，不属于上述 Core PASS 范围。
- 日期/时间占位与个人任务删除弹窗 polish：commit `e7b0ce95d6d8bbf6d65211cca9319a2bf8eee2e4`；targeted UI 8 项、相关单元测试 39 项、typecheck、lint、Prettier 与 diff-check 均 PASS。未修改 Rust、数据库 schema 或 migration。

## 当前模型审计

审计结论：当前代码中不存在正式的 `DailySummary`、`DailyReview`、`DaySummary`、`DailyReflection` 或语义等价的持久化业务实体。

- `diary_entries` 是用户日记正文，不是每日总结；不得复用。
- AI 响应是临时生成结果，不是可持久化业务对象；不得复用。
- Inbox 项目保存待处理输入，不是每日总结；不得复用。
- `app_settings` 保存偏好配置，不是业务记录；不得将总结塞入 settings blob。
- localStorage、AI 历史、聊天记录均不得代替正式业务存储。
- `DailyBriefSource` 中的 `dailySummary` 是来源类型标识，不构成实体、表、Repository 或查询实现。

现有 schema 7 无合法、语义匹配的业务存储可复用。因此，满足“用户可编辑并持久保存每日总结”的目标需要 schema 8 与 migration 7→8。未经 Ethan 明确批准，不实施下述方案。

## Migration Impact Review

### 1. 建议表结构

建议新增独立 `daily_summaries` 表，每个本地日历日期最多一条：

| 字段 | 建议语义 |
| --- | --- |
| `id TEXT PRIMARY KEY` | 稳定、不透明的实体 ID；便于未来同步，不编码机器路径或用户信息 |
| `summary_date TEXT NOT NULL UNIQUE` | ISO `YYYY-MM-DD` 本地日历日期；唯一约束保证每天一条 |
| `overview TEXT NOT NULL` | 用户可编辑的总结正文 |
| `highlights_json TEXT NOT NULL` | 今日完成 / 亮点的 JSON 数组 |
| `unfinished_json TEXT NOT NULL` | 未完成 / 延续事项的 JSON 数组 |
| `tomorrow_notes_json TEXT NOT NULL` | 明日备注的 JSON 数组 |
| `created_at TEXT NOT NULL` | UTC 时间戳 |
| `updated_at TEXT NOT NULL` | UTC 时间戳；每次用户保存更新 |
| `revision INTEGER NOT NULL CHECK (revision >= 1)` | 本地修订版本，为后续同步冲突处理预留概念基础 |

实现时应由 Rust/domain/application 层校验 ISO 日期、非空规则、JSON 数组元素类型、长度上限与 revision；不得仅依赖 SQLite 接受文本。字段可在编码前按现有项目命名约定微调，但不得扩大业务范围。

### 2. 索引

`UNIQUE(summary_date)` 同时提供唯一性和日期查询索引，足以支持最近三个日历日的精确查询；默认不另建冗余索引。只有查询计划证明必要时才考虑额外索引。

### 3. Domain Entity 与 Repository

- 新建独立 `DailySummary` domain entity；它是用户业务数据，不是 AI Memory。
- Repository 提供按日期读取、按明确日期窗口读取、创建/更新/删除（若产品确认允许删除）等最小操作。
- 唯一日期冲突应转为明确的领域结果或更新既有日期记录，不得产生重复行。
- UI 与 AI workflow 通过 Application 层使用 Repository；不得直接访问 SQL。

### 4. Application UseCase

建议拆分为：读取日期总结、读取指定日期窗口、保存用户确认后的总结，以及生成仅存在于界面的 draft。生成流程为：本地可信来源聚合 → 可选 DeepSeek enrichment → preview → 用户编辑 → 用户明确保存。生成阶段不自动写库、不后台生成、不定时生成；DeepSeek 不可用时仍提供 local draft。

最近总结查询只读取最近三个 calendar-day 日期窗口，缺失日期直接跳过，绝不向更早日期补足三条。当前实时 Task 状态优先于历史 Summary；历史内容只作为历史背景。

### 5. Migration 7→8 与旧库升级路径

- 仅增加 `daily_summaries` 及必要约束；不改写 schema 7 既有表和记录。
- `CURRENT_SCHEMA_VERSION` 在获批实现时提升为 8，并添加严格的 7→8 migration。
- schema 7 用户库：按现有启动备份路径先产生并验证 migration 前备份，再以单一 SQLite transaction 建表、验证目标结构、最后设置 `user_version=8` 并提交。
- fresh DB：继续沿已有 migration chain 顺序到 schema 8；不得维护与旧版本不一致的旁路建库逻辑。
- schema > 8：继续按现有策略安全拒绝，不得降级或清理数据库。

### 6. 重复启动 / reopen safety

- schema 8 再次启动只验证既有结构，不重复执行 7→8，也不重新创建表。
- `summary_date` 唯一约束确保同一天重复保存不会产生多条记录。
- 两个并发或重复保存必须由事务 / 唯一约束加 Repository 语义处理；失败需返回明确结果，不得留下半条记录。

### 7. Partial migration 防护

- 对 `user_version=7` 但已存在 `daily_summaries` 或迁移专属索引的状态，按不一致/部分迁移拒绝并保留原始 DB，不应静默 `IF NOT EXISTS` 后宣称迁移成功。
- 建表、结构检查与 `user_version` 更新必须处于一个事务中；任何一步失败均回滚。
- 对已标为 8 但目标表/约束缺失的 DB，启动应明确失败，不应自动重建业务表。

### 8. Backup / rollback

继续使用现有迁移前验证备份和 SQLite transaction 机制，不复制或重写业务 DB 来伪装迁移成功。备份失败时应阻止 migration；事务失败时原库维持 schema 7，备份保留。只有在回滚路径经过完整性验证后才能报告恢复成功。应验证当前备份命名逻辑随 `CURRENT_SCHEMA_VERSION` 更新后仍可追溯旧版来源，避免误覆盖既有备份。

### 9. Phase 3.9 migration recovery 兼容性

Phase 3.9 修复的 schema 6→7 恢复逻辑和验证必须原样保留。7→8 是其后的独立一步；已为 schema 7 的数据库不得重新进入 6→7 recovery。迁移门禁必须以目标 migration 的版本边界判断，避免因为 current version 提升到 8 而误触发旧迁移。新增测试需覆盖 6→7 recovery 后继续到 8、普通 7→8，以及 7→8 失败回滚。

### 10. 测试矩阵

获批实现时至少覆盖：

1. fresh DB 经 migration chain 到 schema 8，目标表/约束正确。
2. schema 7 → 8，旧数据、Phase 3 数据及现有 AI/Planner 数据保留。
3. schema 8 reopen / double startup 不重复建表或改变记录。
4. schema 7 下预置目标表、部分迁移或错误结构时安全拒绝。
5. future schema 安全拒绝。
6. 同一日期唯一；同日更新不产生重复记录。
7. transaction 中注入失败：user_version 保持 7、旧数据完整、备份存在。
8. migration backup 失败时不执行迁移。
9. Phase 3.9 的 6→7 恢复用例与其后 7→8 顺序兼容。
10. 最近三日按日期窗口查询；缺失日跳过，不查询第 4 日。
11. 当前任务状态覆盖与历史总结相矛盾的旧状态。
12. DeepSeek 不可用仍可生成本地 draft；生成不自动持久化。
13. 权限关闭不读取总结；开启时只读用户授权范围。
14. Diary 正文、Inbox 原始内容明确不进入默认 Daily Summary context。
15. Prompt injection 文本作为不可信数据；不得改变 system policy、解锁工具或触发 Proposal。
16. Preview、编辑、取消、显式保存以及保存失败后的状态恢复。

### 11. Android / future sync 兼容性

稳定 ID、ISO 本地日期、UTC `updated_at` 与单调 `revision` 为未来同步提供最小概念兼容。当前不实现 Android、账号、网络同步、outbox、冲突解决协议或同步元数据表。未来同步仍需单独定义删除语义、跨时区日期归属、revision/conflict policy 与隐私授权；本地 schema 不应假设设备路径或 Windows 专有字段。

## 产品与 AI 安全边界（供后续实现遵守）

- Daily Summary 是用户可编辑的业务数据；不是 AI Memory、chat history、Vector DB、RAG 或 embeddings。
- 本地 draft 可从当天课程、PlannerEvent、TimeBlock、PersonalTask 状态、Deadline、Routine 及经授权的 Weather 聚合；不得默认读 Diary body 或 Inbox raw。
- 生成结果必须先 preview、编辑、再由用户明确保存；不得自动应用 Planner 变更。
- Recent Summary 是不可信历史文本；不得赋予工具能力、提高权限或触发 Proposal。内容如含“忽略规则 / 调用工具”等指令，只能作为普通文本处理。
- Daily Brief 的 Summary 读取必须有明确授权/开关；不得仅因 `planner.read` 自动继承读取权。

## 当前状态与门禁

- Phase 4.8 Core：**COMPLETE**。
- Phase 4.8.1 Daily Summary Migration Impact Review：**COMPLETE**。
- Phase 4.8.1 Implementation：**BLOCKED — SCHEMA 8 APPROVAL REQUIRED**。
- Daily Summary UI：**NOT IMPLEMENTED**。
- Local fallback draft：**NOT IMPLEMENTED**（仅审查设计，不是 PASS）。
- Recent 3-day retrieval / Daily Brief integration：**NOT IMPLEMENTED**。
- Prompt injection regression tests：**NOT IMPLEMENTED**。
- Schema：**7**；本项 migration：**0**。
- Phase 4.9：**NOT STARTED**。

下一门禁：Ethan 明确批准 schema 8 后，才可启动 schema 8 / migration 7→8 的实现与测试。批准前不修改业务代码、数据库 schema 或 migration，不创建 Daily Summary UI，也不进入 Phase 4.9。
