# Links Workplace v2.0 — Phase 2.1 验证

状态：**PASS**

## 范围

- Debug app database 使用 `<app_local_data_dir>/dev-v2/courses.sqlite3`；Release app database 仍使用 `<app_local_data_dir>/courses.sqlite3`。
- 实现唯一新增生产迁移 `schema 5 → 6`，创建 `personal_tasks`、`planner_events`、`time_blocks` 及查询索引。
- 对已有 schema 1–5 数据库，在任何 migration 写入前通过 `VACUUM INTO` 生成一致性备份并校验；备份创建或校验失败时不执行迁移。
- 迁移在单个 SQLite transaction 中完成；验证表、索引、外键、`user_version`、完整性，失败时回滚。
- Release identifier、数据库文件名及生产数据路径不变；本阶段未读取、复制或修改真实用户数据库。

## 自动验证

- `npm run verify`：PASS。TypeScript typecheck、177 unit tests、79 architecture tests、606 UI tests PASS / 15 skipped、lint、Prettier 与前端 build 均通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：PASS，46 tests。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：PASS。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`：PASS。
- Rust migration tests 覆盖 fresh database、schema 1–5 migration、已有 Academic/settings 数据保留、migration backup 创建与校验、备份失败关闭、transaction rollback、外键 cascade、debug/release path isolation、重复打开幂等、future schema 拒绝。

## 边界

- 未启动 Tauri 开发窗口或 Production EXE；debug path isolation 由 Rust 自动化测试验证。
- 未安装 installer；未 push、创建 tag 或 Release。
- Schema 仍只有一条新的正式迁移（5→6）；后续 Phase 2.2 / 2.3 复用 schema 6。
