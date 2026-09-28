# Phase 5.1 — Links Workplace 身份与数据迁移

## 结果

- Phase 5.0：**COMPLETE**；Migration Source Policy 3 已获 Ethan 批准。
- Phase 5.1 Implementation：**COMPLETE**。
- Phase 5.1 Automated：**FAIL（最新完整门禁）**；最近一次完整 `npm run verify` 有 2 个 UI 用例失败，均为白屏 / 应用导航未挂载；随后单独重跑这 2 个用例均 PASS。未将该轮完整门禁标为 PASS。
- Phase 5.1 Overall：**NOT COMPLETE**，完整自动化门禁仍需通过。
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
| `npm run verify`（typecheck、unit、architecture、UI、lint、Prettier、frontend build） | 最近一次完整运行 **FAIL**：Playwright 1153 passed、15 skipped、2 failed（`workspace-schedule.spec.ts:394` 未挂载 Workspace Dashboard；`timetable.spec.ts:929` 在 beforeEach 未挂载“课表”导航；失败截图均为白屏）。两个失败用例随后分别单独重跑均 PASS。 |
| 独立前端门禁 | **PASS**：typecheck、unit 140、architecture 140、lint、Prettier；frontend bundle 随 Tauri production build 成功生成。 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **PASS**；113 passed、0 failed、2 ignored |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | **PASS** |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | **PASS** |
| 迁移定向测试 | **PASS**；schema 5/6/7/8、冲突/marker、损坏库、staging/backup/activation 失败、重试/idempotency、source lock 与 `dev-v2` 排除均有覆盖 |

## 本机真实数据库 dry-run

只读检查旧 identifier 根目录候选，并在唯一临时目录执行 copy dry-run；未写入正式新 identity 路径。

- 分类：`OLD_IDENTIFIER_SCHEMA_8`；schema：8→8；schema migrations：0。
- snapshot / copy：PASS；`integrity_check=ok`；`foreign_key violations=0`。
- 行数摘要：courses 19、period_times 12、semesters 1、academic_tasks 0、personal_tasks 1、planner_events 1、time_blocks 0、diary_entries 1、inbox_items 0、routines 1。
- 源文件 dry-run 前后 SHA-256 相同；临时 dry-run 产物已移除；不记录课程/日记等业务内容。
- 正式 `%LOCALAPPDATA%/com.links.workplace.desktop/courses.sqlite3` 激活：**NOT EXECUTED**；验证时新路径仍不存在。

## Production Build 与产物

- `npm run tauri -- --version`：`tauri-cli 2.11.4`。
- `npm run tauri build`：**PASS**，2026-09-28 11:04（Asia/Shanghai）；构建前仅检查 updater signing 环境变量存在性，未读取或输出私钥/密码。
- Tauri config / Cargo / npm metadata：产品名 `Links Workplace`、版本 `2.0.0`、identifier `com.links.workplace.desktop`；MSI Property 表只读核验 `ProductName=Links Workplace`、`ProductVersion=2.0.0`。
- EXE：`src-tauri/target/release/links-workplace.exe`，68,404,736 bytes，SHA-256 `0762B61A5E9C9924D38D1BDC07CDB6CF9D7073062024338C191DB5AD4E44DCAF`。
- MSI：`src-tauri/target/release/bundle/msi/Links Workplace_2.0.0_x64_en-US.msi`，54,525,952 bytes，SHA-256 `3C06A9DF991C84696FB2634406DE578187900000D21F133477B2487B6392E3E0`。
- MSI updater signature：同目录 `.msi.sig`，428 bytes，SHA-256 `2FEBA8D54EB07D070F95D55BA1D42A8F6C3BBA741D181E0B28F7500E740C6B73`。
- NSIS：`src-tauri/target/release/bundle/nsis/Links Workplace_2.0.0_x64-setup.exe`，52,549,841 bytes，SHA-256 `4340008B411A09964CEEF366500A4872B2E04B2DC1CB7861F18379615B6CA0E2`。
- NSIS updater signature：同目录 `.exe.sig`，428 bytes，SHA-256 `6EDE4DDA57104816DB0F5F119BAD02B99FC8C34F88717B75706CB1C33B2BB8AD`。
- `.sig` 由本次 build 新生成；GitHub `latest.json` / 云端签名发布属于后续 release 阶段，当前没有生成或上传。

## 尚未执行的验收

- 正式迁移真实数据：**NOT EXECUTED**。
- NSIS/MSI 安装与旧版 upgrade / side-by-side / uninstall：**NOT STARTED**。
- Autostart 与真实 updater E2E：**NOT STARTED**。
- GitHub updater metadata 发布、push、tag、Release：**NOT STARTED**。
- 当前仅为身份与迁移实现、自动验证、真实数据 copy dry-run 和本地 production build 的完成记录；不代表 2.0 安装、升级或发布已通过。
