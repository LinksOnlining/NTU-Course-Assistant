# Links Workplace v2.0 — Phase 3.9 Database Migration Recovery

日期：2026-09-25  
状态：**PASS**

## 基线与根因

- 开始时 branch：`v2/workspace-rebase`；HEAD：`a6ea960dafa8067bc3867e1ca42b3342c9197671`；`git diff --check` PASS。
- SQLite schema version 的唯一事实来源是 `PRAGMA user_version`，不是自定义 metadata table。
- 阻断由未提交的 Phase 4.1 草稿引入：`CURRENT_SCHEMA_VERSION` 被抬到 8，但 6→7 runner 仍以 `version < CURRENT_SCHEMA_VERSION` 判断是否执行。已有 version 7 因而满足 `7 < 8`，再次运行 6→7 并在 `CREATE TABLE diary_entries` 处因表已存在而失败。Phase 4.0 的已提交改动只有设计文档，不含此 migration 代码。
- 历史实现中 Phase 3 表只在 6→7 migration 中创建；没有独立 bootstrap / `ensureTables` / startup 建表调用，也没有重复注册。migration 将三个表、两个索引与 `user_version = 7` 放在同一事务内，随后在事务中校验并 commit；失败由 SQLite transaction drop 回滚。问题是 runner 的版本门禁，不是半提交的 Phase 3 migration。

## 实际 Debug DB 只读检查

仅访问 Debug DB：`<LOCALAPPDATA>/com.ntu-course-assistant.desktop/dev-v2/courses.sqlite3`。Release DB 只按代码确认其路径规则为同一 app data 目录下的 `courses.sqlite3`，未检查文件是否存在或读取内容。

| 项目 | 实测结果 |
|---|---|
| `PRAGMA user_version` | 7 |
| `PRAGMA integrity_check` | `ok` |
| Phase 3 表 | `diary_entries`、`inbox_items`、`routines` 均存在 |
| Phase 3 索引 | `inbox_items_status_created_at`、`routines_enabled` 均存在 |
| Diary 约束 | `id` 主键；`entry_date` 唯一；日期长度与非空字段 CHECK 存在 |
| Inbox 约束 | 字段完整；raw/status/parse kind/confirmation 组合 CHECK 存在 |
| Routine 约束 | 字段完整；时长、星期、时间窗口与 enabled CHECK 存在 |
| Partial migration | 否；实际结构与 schema 7 migration 一致 |
| 现有业务行数 | 检查到的 Academic、Planner、Diary、Inbox、Routine 表均为 0 行 |

已在仓库外临时目录创建 Debug DB 的只读来源副本；副本 `user_version = 7` 且 `integrity_check = ok`。先前错误草稿启动在 6→7 重复建表失败前创建了 `courses-v7-to-v8-*.sqlite3` 保护备份；该备份也只读验证为 schema 7 且完整。故障后的原 Debug DB 检查值为 217,088 bytes、schema 7、`integrity_check = ok`；不据此推断启动前后的文件时间戳变化。

## 修复与 Recovery Contract

- schema 7 为当前 schema；6→7 runner 现在以该 migration 自己的目标版本门禁，不再依赖可被后续版本提升的 `CURRENT_SCHEMA_VERSION`。
- 正常 schema 7 启动会验证 schema 7，不重复执行 6→7。
- schema 6 若已存在任何 Phase 3 migration 对象，当前没有已知历史 bootstrap 路径能证明它是合法完成态；系统以明确错误拒绝自动修复，不覆盖、不删除、不猜测，也不机械使用 `IF NOT EXISTS`。受保护的 migration 前备份仍可重开。
- schema 6 且无 Phase 3 对象：执行原子 6→7 migration；表、索引、版本更新、校验仍处在同一事务。
- future schema 继续安全拒绝。

## 自动验证矩阵

| 场景 | 结果 |
|---|---|
| Fresh DB → schema 7 | PASS |
| Clean schema 6 → schema 7 | PASS；Academic / PersonalTask / PlannerEvent / TimeBlock 数据保留，源备份可重开 |
| Valid schema 7 关闭后重开 | PASS；Diary/Inbox sentinel 保留，未重跑 migration |
| schema 6 + 仅 `diary_entries` | PASS；明确拒绝，版本、表及数据不变 |
| schema 6 + `diary_entries` + `inbox_items` | PASS；明确拒绝，版本、表及数据不变 |
| schema 6 + 全部 Phase 3 表、版本仍为 6 | PASS；因无可证明的 legacy completion 路径而明确拒绝，数据与备份保留 |
| schema 6 + 不匹配的 `diary_entries` 定义 | PASS；拒绝且原 DDL/数据不变 |
| 注入 6→7 migration failure | PASS；已有测试验证表、版本与 Phase 2 数据完整 rollback |
| Future schema 8 | PASS；安全拒绝且 sentinel 未修改 |

所有 recovery matrix 均使用隔离临时数据库。没有对真实 Debug DB 手工改版本或删除对象。

## 阶段与安全边界

- schema：**7**；没有创建 AI 表或 schema 8。
- Release DB contents accessed：**NO**；Release DB migrated：**NO**。
- Production EXE run：**NO**；Installer installed：**NO**。
- `IF NOT EXISTS` 用于 Phase 3 migration：**NO**。
- Phase 3：**COMPLETE**；Phase 3.9：**PASS**；Phase 4：**NOT STARTED**。

## 最终验证与产物

- `npm run verify`：**PASS**；114 unit、114 architecture、813 UI PASS / 15 skipped；typecheck、lint、format、frontend build 均 PASS。
- Rust：`cargo test` **77 passed / 0 failed**；`cargo fmt -- --check` PASS；`cargo clippy --all-targets -- -D warnings` PASS。
- 修复后 `npm run tauri dev` 使用原 Debug DB 启动 PASS：日志报告 schema 7，课程、作息、Widget、提醒、学期、Personal Tasks、Planner Events、Time Blocks、Diary、Inbox、Routines 的启动读取均完成；未见重复建表错误。
- `npm run tauri build`：**PASS**。仅构建，没有运行 Release EXE 或安装产物。构建产物位于被忽略的 `src-tauri/target/release/`：

| 产物 | 大小 |
|---|---:|
| `NTU Course Assistant_1.3.1_x64_en-US.msi` | 54,247,424 bytes |
| `NTU Course Assistant_1.3.1_x64_en-US.msi.sig` | 436 bytes |
| `NTU Course Assistant_1.3.1_x64-setup.exe` | 52,365,207 bytes |
| `NTU Course Assistant_1.3.1_x64-setup.exe.sig` | 436 bytes |

- 构建产生的既有前端大 chunk / PDF.js 与 Windows linker 提示为 warning，不影响构建成功；本次未改动它们。
- GitHub push、tag、Release：**未执行**。
