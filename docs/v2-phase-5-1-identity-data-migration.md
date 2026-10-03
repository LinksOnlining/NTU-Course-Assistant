# Phase 5.1 — Links Workplace 身份与数据迁移

> **SUPERSEDED：**2026-10-03 产品决策将 Links Workplace 2.0 定义为 clean-start release。本文记录的迁移实现与验收仅为历史证据，不是当前受支持能力或 Release Gate。当前 2.0 不扫描、复制、激活或迁移 NTU 1.x 数据；见 `docs/v2-phase-5-2-clean-start-verification.md`。

## 结果

- Phase 5.0：**COMPLETE**；Migration Source Policy 3 已获 Ethan 批准。
- Phase 5.1 Implementation：**COMPLETE**。
- Phase 5.1 Automated：**PASS**；Playwright 完整套件、双轮 `npm run verify` 与 4-worker 套件均稳定通过。
- Phase 5.1 Overall：**COMPLETE**。本阶段没有执行真实用户数据库激活、安装/升级/卸载、Autostart 或 updater E2E。
- Phase 5.1 Real Data Dry Run：**PASS**。
- Phase 5.1 Production Build：**PASS**。
- 起始 HEAD：`bd7eb232be9fda979c31ce9a039187343a45c2bb`；分支：`v2/workspace-rebase`。
- 本阶段没有安装、卸载、激活真实用户数据库、注册自启动、执行 updater E2E、push、tag 或发布。

## 已批准策略与新身份

- 产品：`Links Workplace`；版本：`2.0.0`；Tauri identifier：`com.links.workplace.desktop`；实际 EXE：`links-workplace.exe`。
- 新正式数据库路径由 Tauri `app_local_data_dir()` 返回，再使用 `courses.sqlite3` 文件名；旧候选为 `local_data_dir()/com.ntu-course-assistant.desktop/courses.sqlite3`。
- Debug 数据仍隔离在新 identity app-local directory 下的 `dev-v2/courses.sqlite3`，Release discovery 永不扫描该路径。
- GitHub repository、updater endpoint 与数据库文件名保持不变。
- 旧 release lineage schema 5–7 与旧 identifier 根路径 schema 8 是分别支持的来源；不根据安装版本推断 schema。公开 release 只用于格式兼容依据，不是本机第二份数据库。

## Source discovery 与迁移安全

来源分类为 `NONE`、`LEGACY_SCHEMA_5`、`LEGACY_SCHEMA_6`、`LEGACY_SCHEMA_7`、`OLD_IDENTIFIER_SCHEMA_8`、`NEW_IDENTIFIER_SCHEMA_8`、`CONFLICT`、`INVALID`。不选择“最佳候选”。旧、新库同时存在时，只有 completion marker 与来源身份、路径标识、schema 及目标 schema 全部匹配才接受新库；否则安全停止，不合并、不覆盖、不按时间/文件大小/行数裁决。

旧源只读校验 → SQLite Online Backup snapshot → 持久化并校验备份 → staging 工作副本 → 既有 migration chain → integrity / foreign-key / 结构 / 行数验证 → 原子激活。原来源不变；失败不以空库继续启动。schema 5→8、6→8、7→8 分别运行 3、2、1 个 schema migrations；schema 8→8 为 0 个 schema migrations。

SQLite `app_settings` 随选定数据库整体迁移。WebView `localStorage`、缓存、AI 授权、临时 proposal/context、日志与凭据不复制；DeepSeek / Weather Credential Manager service/account 保持不变。Schema 保持 **8**，无新增 migration。

## 自动验证

| 门禁 | 结果 |
|---|---|
| `npm run verify`（typecheck、unit、architecture、UI、lint、Prettier、frontend build） | **PASS ×2**；两轮各 Playwright 1155 passed、15 skipped、0 failed。 |
| Playwright 并行完整套件（`--workers=4`） | **PASS**；1155 passed、15 skipped、0 failed。 |
| 独立前端门禁 | **PASS**：typecheck、unit 140、architecture 140、lint、Prettier；frontend bundle 随 Tauri production build 成功生成。 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **PASS**；113 passed、0 failed、2 ignored |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | **PASS** |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | **PASS** |
| 迁移定向测试 | **PASS**；schema 5/6/7/8、冲突/marker、损坏库、staging/backup/activation 失败、重试/idempotency、source lock 与 `dev-v2` 排除均有覆盖 |

## Playwright 白屏 / 未挂载回归

- 根因：失败 trace 中 HTML 的 `#root` 已存在并记录 `html-root-ready`，但 React 入口模块没有执行；浏览器日志与网络 trace 显示启动脚本请求以 `net::ERR_NO_BUFFER_SPACE` 失败（先后在 Vite 源模块和静态预览拆分 chunk 复现）。因此 Workspace / 课表导航未挂载是入口资源请求失败的后果，不是 React render、数据库初始化或测试持久状态污染。
- 完整 suite 才暴露的原因：每个 Playwright case 使用隔离页面/上下文，Vite 开发服务器会在整套 9 个 viewport/DPR 项目中反复传输分散的源码模块；长序列下 Windows Chromium 的本机网络资源请求失败。诊断记录了 worker/执行顺序；例如 `timetable.spec.ts` 在 `persisted period-based course follows schedule edits without rewriting the course` 后失败时，trace 在入口执行前记录到 `ERR_NO_BUFFER_SPACE`。前序用例是执行顺序信息，不构成应用共享状态污染证据。
- 修复：Playwright 改用 test-mode 静态预览构建；将应用共享模块合并为 test-only shared chunk，同时保留 index 与每个 HTML harness 的独立入口，避免测试模块互相执行。生产构建分包行为未改变。启动时间线现在覆盖 HTML/root、main module、React root、App mount、数据 bootstrap 和 render error；失败时保留 Playwright trace，并由 reporter 记录 worker、序号和前序用例。
- 回归证据：根因相关 25 次重复序列 **PASS**；原失败测试包含在两轮完整 verify 中均通过；完整 Playwright workers=1（经两轮 verify）及 workers=4 均 **PASS**，未再观察到 `ERR_NO_BUFFER_SPACE` 或白屏。

## 本机真实数据库 dry-run

只读检查旧 identifier 根目录候选，并在唯一临时目录执行 copy dry-run；未写入正式新 identity 路径。

- 分类：`OLD_IDENTIFIER_SCHEMA_8`；schema：8→8；schema migrations：0。
- snapshot / copy：PASS；`integrity_check=ok`；`foreign_key violations=0`。
- 行数摘要：courses 19、period_times 12、semesters 1、academic_tasks 0、personal_tasks 1、planner_events 1、time_blocks 0、diary_entries 1、inbox_items 0、routines 1。
- 源文件 dry-run 前后 SHA-256 相同；临时 dry-run 产物已移除；不记录课程/日记等业务内容。
- 正式 `%LOCALAPPDATA%/com.links.workplace.desktop/courses.sqlite3` 激活：**NOT EXECUTED**；验证时新路径仍不存在。

## Production Build 与产物

- `npm run tauri -- --version`：`tauri-cli 2.11.4`。
- `npm run tauri build`：**PASS**，2026-09-28 14:27（Asia/Shanghai）；只确认 updater signing 环境变量存在，未读取或输出私钥/密码。
- Tauri config / Cargo / npm metadata：产品名 `Links Workplace`、版本 `2.0.0`、identifier `com.links.workplace.desktop`；MSI Property 表只读核验 `ProductName=Links Workplace`、`ProductVersion=2.0.0`。
- EXE：`src-tauri/target/release/links-workplace.exe`，68,404,736 bytes，SHA-256 `2B75B0F1CDAFA9DDC973CFAC593E1C52D708E81511114A540F7D4A44A5018C54`。
- MSI：`src-tauri/target/release/bundle/msi/Links Workplace_2.0.0_x64_en-US.msi`，54,525,952 bytes，SHA-256 `B6DEAF74B349D3FC6BADCB135BA216033B7C2478BC99E513E410AE8B158B1166`。
- MSI updater signature：同目录 `.msi.sig`，428 bytes，SHA-256 `2DA7ED34A1E1F13682581779476BBB6939CE7F31D5B5C62164F7031F0C3D7F1C`。
- NSIS：`src-tauri/target/release/bundle/nsis/Links Workplace_2.0.0_x64-setup.exe`，52,463,333 bytes，SHA-256 `2B72923BE09536C0D7C9183DA23CBA03C07A3E6411ABCD9615A4BC7538D8DB0F`。
- NSIS updater signature：同目录 `.exe.sig`，428 bytes，SHA-256 `A6CFEFBB3814D871D703D7669C3C698F029A63E9FAEA4442B618BFAC490BBCB3`。
- `.sig` 由本次 build 新生成；GitHub `latest.json` / 云端签名发布属于后续 release 阶段，当前没有生成或上传。

## 尚未执行的验收

- 正式迁移真实数据：**NOT EXECUTED**。
- NSIS/MSI 安装与旧版 upgrade / side-by-side / uninstall：**NOT STARTED**。
- Autostart 与真实 updater E2E：**NOT STARTED**。
- GitHub updater metadata 发布、push、tag、Release：**NOT STARTED**。
- 当前仅为身份与迁移实现、自动验证、真实数据 copy dry-run 和本地 production build 的完成记录；不代表 2.0 安装、升级或发布已通过。
