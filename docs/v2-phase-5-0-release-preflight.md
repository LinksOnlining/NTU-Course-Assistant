# Phase 5.0 — Links Workplace 2.0 Release Preflight & Migration Audit

日期：2026-09-28
审计基线：`v2/workspace-rebase` / `c6f21f072e7c7d608d9c4011f9c5c17efdfa51a9`
范围：只读调查、发布身份与数据迁移设计；未修改产品代码或发布配置。

> **后续状态更新：**本文件以下记录是 Phase 5.0 审计当时的事实。Migration Source Policy 3 已获批准：独立支持旧 release lineage schema 5–7 与旧 identifier schema 8，不合并、不覆盖；存在无法证明关系的多源时安全停止。Phase 5.0 为 COMPLETE；Phase 5.1 identity / 迁移实现、真实数据库 dry-run 与本地 production build 已完成。最近完整 npm verify 有 2 个 UI 白屏/应用未挂载失败，隔离重跑通过；自动化门禁记 FAIL、Phase 5.1 Overall 未完成。真实库激活和安装/升级/卸载、自启动、Updater E2E 与发布未执行，详见 [`v2-phase-5-1-identity-data-migration.md`](v2-phase-5-1-identity-data-migration.md)。

## Baseline

- Phase 4.9：Ethan 确认真实 DeepSeek 与 Windows 人工验收全部 PASS，正式 COMPLETE。
- Phase 5.0：**BLOCKED**；Phase 5.1：**NOT STARTED**。
- 未迁移真实数据、安装/卸载、关闭进程、改自启动、改 identity/version、发布、打 tag 或 push。

## Current Identity

| 项目 | 当前值 |
|---|---|
| ProductName | `NTU Course Assistant` |
| Version（当前开发树） | `1.3.1`（Tauri、npm、Cargo 一致） |
| Identifier | `com.ntu-course-assistant.desktop` |
| Cargo 二进制 | `ntu-course-assistant.exe` |
| Window title | `大学课程表` |
| Tauri CLI | `2.11.4` |
| Updater | GitHub Releases `latest.json` HTTPS；NSIS passive |

当前 release 文件 `src-tauri/target/release/ntu-course-assistant.exe` 的文件版本是 1.3.1，但不是运行中的进程，也不是本机当前注册的安装版本。

## Target Identity Proposal（未采用）

> 以下是审计时的候选方案快照；后续用户批准并实施的正式 identity 以本节顶部状态更新及 Phase 5.1 记录为准。

- ProductName：`Links Workplace`
- Version：`2.0.0`
- Identifier 候选：`com.links.workplace.desktop`
- 建议暂时保留技术二进制名 `ntu-course-assistant.exe`，除非后续证明改名对安装、快捷方式、自启动及升级没有副作用。
- 本阶段没有修改配置或创建新目录。

## Running Release Process

- 项目相关进程：未发现；PID、命令行、父进程、启动时间均 N/A。
- 未关闭任何程序。`Safe to close=NO`；`Action taken=NO`。
- Windows 卸载注册表实际记录为 `NTU Course Assistant 1.3.0`，安装目录 `%LOCALAPPDATA%\NTU Course Assistant`，有 `uninstall.exe`；开始菜单存在对应快捷方式。因此本机当前安装态不是 1.3.1。

## Data Paths

代码经 Tauri `app_local_data_dir()` 取得数据根目录；debug 构建追加 `dev-v2`，release 构建不追加。Tauri 未配置 `appDirectoriesOverride`。

| 用途 | 路径 | 状态 |
|---|---|---|
| 当前 identity 根数据库 | `%LOCALAPPDATA%\com.ntu-course-assistant.desktop\courses.sqlite3` | 存在；229,376 bytes；mtime 2026-09-27 20:25:39 UTC |
| v2 开发数据库 | `%LOCALAPPDATA%\com.ntu-course-assistant.desktop\dev-v2\courses.sqlite3` | 存在；229,376 bytes；mtime 2026-09-28 00:23:40 UTC |
| 新 identity 候选路径 | `%LOCALAPPDATA%\com.links.workplace.desktop\courses.sqlite3` | 不存在，未创建 |
| 旧 Roaming 候选 | `%APPDATA%\com.ntu-course-assistant.desktop` | 不存在 |
| 旧 identity `backups` 目录 | `%LOCALAPPDATA%\com.ntu-course-assistant.desktop\backups` | 存在；当前文件数 0 |

Tauri 的 `app_local_data_dir()` 使用 Local AppData 下的 identifier 子目录；更换 identifier 会改变数据目录及 WebView 数据目录，不能假定新身份会自动看到旧数据。来源：[Tauri path API](https://v2.tauri.app/reference/javascript/api/namespacepath/)、[Tauri identifier](https://v2.tauri.app/reference/config/#identifier)。

## Release DB — 关键阻断

仅读取数据库 schema、表名和完整性结果；没有读取任何业务行、课程、Diary/Inbox 正文、姓名或 API 密钥。

- 当前 identity 根目录 DB：`user_version=8`。
- `PRAGMA integrity_check`：`ok`；`PRAGMA foreign_key_check`：0 条违规。
- 表列表：`academic_tasks`、`app_settings`、`course_overrides`、`courses`、`daily_summaries`、`diary_entries`、`exams`、`handled_reminders`、`inbox_items`、`period_times`、`personal_tasks`、`planner_events`、`reminder_instances`、`reminder_rules`、`routines`、`semesters`、`time_blocks`。
- `daily_summaries` 是 schema 8 dormant 表，本阶段未读写或改表。
- 同目录见 `courses.sqlite3-wal`（0 bytes）和 `courses.sqlite3-shm`（32,768 bytes），未删除。
- 主 DB 文件 mtime 未变。普通 SQLite `mode=ro` 检查可能创建/刷新 `-shm` sidecar；随后完整性复核使用 `immutable=1`。因此只能确认主 DB 文件未写入，不能声称目录 sidecar 元数据绝对未变。

**停止条件已触发：**公开 `v1.3.1` tag 的历史源码 `CURRENT_SCHEMA_VERSION=5`；本机 Windows 注册安装仍为 `1.3.0`；而旧 identifier 根路径现在存在 schema 8 DB。这个 DB 不能被证明是未触碰的公开 v1.3.1 schema 5 数据库。其来源、所有权以及是否就是 Ethan 希望带入 Links Workplace 2.0 的真实数据，不能从路径、mtime 或 schema 单独推断。

Phase 5.0 不降级或“修复”该 DB，也不按 mtime 选择数据。需要 Ethan 明确迁移的权威来源：公开 v1.3.1 schema 5 数据、当前旧 identity 路径 schema 8 数据，或未来分别支持两种独立来源。确认前不得用真实 DB 执行迁移。

## Migration / Backup / Rollback（仅策略，不执行）

1. 先用无私人内容的 fixture 覆盖 schema 5→目标 schema 8；schema 8 路径应作为独立 continuity/no-op fixture，不混为公开 v1.3.1 来源。
2. 真迁移前创建一次性一致性快照；应使用 SQLite Backup API，不能在 WAL 活跃时简单复制主文件。
3. 在新身份目录的 staging 路径迁移和校验 integrity、外键与允许记录的关键行数；全部通过后才原子激活。
4. 迁移失败不激活新库、不删除旧库；保留旧 DB 和迁移备份供回滚。
5. 新旧路径都已有 DB 时安全停止；不得自动合并，也不得用较新的 mtime 静默覆盖。
6. 本轮未运行 migration、未创建 fixture/harness、schema/migration 均未改。

## Credentials

只审阅代码里的 Credential Manager 标识；没有读取、输出或导出 secret。

| 凭据 | 当前标识 | 迁移建议 |
|---|---|---|
| DeepSeek | service `links-workplace.ai` / account `deepseek.default` | 保持标识则无需复制 secret；禁止转存明文 |
| 高德 | service `links-workplace.weather` / account `amap.web-service` | 保持标识；不导出密钥 |
| 百度 | service `links-workplace.weather` / account `baidu.web-service` | 同上 |
| 其他 | 当前代码检索未发现其他 Keyring service | 后续新增时单独审计 |

## Settings / Local State

- SQLite `app_settings` 包含 `term_config`、`reminder_settings`、`widget_settings`、`day_count`；应随选定 DB 来源验证迁移。
- WebView `localStorage` 使用主题、AI provider 选择、AI data-access grant、Daily Brief 偏好、Weather 设置与 Weather cache。identifier 改变后不会自动共享；禁止整体复制 `EBWebView`。
- AI data-access/grant 属于同意边界，建议新产品身份下重新确认；不要迁移旧授权。
- Daily Brief：如用户同意，可迁移 `enabled`；不迁移 `lastAutoShownDate`。
- Weather cache 不迁移。已选地点是敏感位置偏好，只能经显式 allowlist 和用户确认迁移；Weather 保持默认关闭。
- 不迁移临时 AI proposal/context、WebView cache/cookies、日志、提醒去重状态或任何密钥。

## Installer / Autostart

- 当前仓库通过 Tauri Action 构建 NSIS、MSI；当前本机注册的是 per-user `1.3.0` 安装，含 `uninstall.exe` 与 Start Menu shortcut。
- 本地 1.3.1 构建输出有 NSIS、MSI 及 `.sig`，但没有安装这些产物：`NTU Course Assistant_1.3.1_x64-setup.exe`（52,401,813 bytes）、对应 `.sig`（436 bytes）、`NTU Course Assistant_1.3.1_x64_en-US.msi`（54,476,800 bytes）、对应 `.sig`（436 bytes）。
- 当前 Tauri 配置没有显式固定 MSI `wix.upgradeCode`。Tauri 文档说明默认 UpgradeCode 由 ProductName 生成；改名可能令 MSI 将新产品视为不同应用并造成重复安装。来源：[Tauri Wix configuration](https://v2.tauri.app/reference/config/#wixconfig)。
- 新 identifier 改变 AppData；ProductName、安装目录、MSI UpgradeCode、NSIS 卸载与快捷方式身份必须在隔离 Windows 环境成组验证。本轮不能宣称 in-place 或 side-by-side 升级安全。
- Autostart 使用官方 Tauri plugin，默认关闭、用户显式启用；本机未发现指向 NTU/Links 的 HKCU Run 项。本轮未测试卸载清理。
- 禁止安装器静默注册自启动；不新增 minimized-to-tray 启动模式。

## Updater / Signing

- endpoint：`https://github.com/LinksOnlining/NTU-Course-Assistant/releases/latest/download/latest.json`。只读读取返回版本 `1.3.1`；Windows NSIS/MSI metadata 均有下载 URL 与 signature 字段。
- 当前配置含 updater public key 与 HTTPS endpoint，NSIS `installMode=passive`；没有改 key，也没有读取私钥。
- 本地 1.3.1 NSIS/MSI `.sig` 文件存在；本阶段未重新执行密码学验签。
- 历史 `v1.3.0 → v1.3.1` 安装态 updater E2E 未完成，仍未验证。
- Release workflow 是 `v*` tag-only、Windows、`tauri-apps/tauri-action@action-v1.0.0`，但 `releaseDraft: false`，tag push 会直接发布。2.0 RC 需先改成 Draft/人工发布门禁；本轮未改 workflow、未发布。
- updater signature 不等于 Authenticode；当前无商业 Authenticode，Windows 仍可能显示 Unknown Publisher / SmartScreen 提示。

## Branding / Version

- `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 当前均为 1.3.1。
- 主窗口标题仍是 `大学课程表`，可见品牌仍是 NTU Course Assistant。
- 当前图标源仍为 NTU Course Assistant 课程表品牌；Links Workplace 是否换新图标留待后续品牌决策。本轮未生成或替换图标。
- 未修改版本、ProductName、identifier 或 updater 配置。

## RC Matrix / 未执行项

本阶段不是 RC；没有运行 fresh install、从公开 v1.3.1 升级、reinstall/uninstall、Autostart 清理、2.0 updater E2E、offline/DeepSeek/Weather、窗口尺寸或主题矩阵。Phase 4.9 用户人工 PASS 不替代 2.0 identity migration / installer 验收。

## Risks / Recommendation

1. **阻断：公开 v1.3.1 schema 5、本机安装态 1.3.0、当前旧 identity DB schema 8 不是同一已证明基线。**
2. ProductName 改名会影响默认 MSI UpgradeCode；NSIS install/uninstall/shortcut 身份也未经改名配置验证。
3. 新 identifier 会创建新数据与 WebView 目录；真实数据源、双路径冲突、localStorage allowlist、用户位置与 AI 授权须先决定。
4. v1.3.0→1.3.1 updater E2E 未验证；当前 tag workflow 立即发布，不适合作 2.0 RC 门禁。
5. 建议 Ethan 先指定权威数据来源，再建立 schema 5 和 schema 8 独立匿名 fixtures 与隔离 Windows installer 测试。当前 **Phase 5.1 可以安全开始：NO**，直到基线冲突被澄清。

### 安全结论

- 主业务 DB 文件未写入；没有迁移、删除、安装、卸载或创建新 identity 目录。
- SQLite 只读连接可能触碰 `-shm` sidecar；文件/目录未人工清理。
- 未读写或记录业务行、个人正文、Credential Manager secret、Updater private key/password。
- 无产品配置、版本、schema、migration、产品代码改动。

## Git

- 起始 HEAD：`c6f21f072e7c7d608d9c4011f9c5c17efdfa51a9`。
- Push：NO；Tag：NO；Release：NO。

## Ethan 批准的最终迁移决策

- Migration Source Decision：**APPROVED — Policy 3**。
- Source policy：支持旧正式版本 lineage 的 schema 5/6/7，通过正式 5→6→7→8 migration chain 迁移；支持旧 identifier 根路径中的合法 schema 8，零 schema migration、备份并复制到新身份。
- 不根据安装版本推断数据库 schema；不将公开 Release 当作本机额外数据库来源。
- `%LOCALAPPDATA%\com.ntu-course-assistant.desktop\dev-v2\courses.sqlite3` 明确为 DEVELOPMENT ONLY，release discovery 永远忽略。
- old/new 数据库同时存在时，仅接受匹配的 sidecar migration completion marker；否则分类为 CONFLICT。禁止 merge、mtime winner、文件大小 winner 或静默覆盖。
- 目标 Tauri identity：`Links Workplace` / `2.0.0` / `com.links.workplace.desktop`；GitHub repository、updater endpoint、数据库文件名 `courses.sqlite3` 不变。
- Phase 5.0：**COMPLETE**；Phase 5.1 implementation：**COMPLETE**，dry-run / build：**PASS**；automated gate：**FAIL**（完整 npm verify 最近一次有 2 个 UI failure，隔离复跑通过）；真实数据 activation、installer / updater E2E：**NOT EXECUTED**（最终实现和验证见 Phase 5.1 记录）。

## References

- [Tauri appLocalDataDir API](https://v2.tauri.app/reference/javascript/api/namespacepath/)
- [Tauri identifier](https://v2.tauri.app/reference/config/#identifier)
- [Tauri MSI UpgradeCode](https://v2.tauri.app/reference/config/#wixconfig)
- [NTU Course Assistant v1.3.1 Release](https://github.com/LinksOnlining/NTU-Course-Assistant/releases/tag/v1.3.1)
