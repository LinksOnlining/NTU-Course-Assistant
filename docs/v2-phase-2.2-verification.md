# Links Workplace v2.0 — Phase 2.2 验证

日期：2026-09-24
结果：**PASS**

## 范围

- PersonalTask schema 6 persistence CRUD、完成/重新打开、验证与重启后读取。
- Planner Application 边界：表单校验、deadline 语义、自然日期标签、排序和 use cases。
- Workspace Tasks：个人任务增改、完成/重新打开、删除确认；AcademicTask 只读并导航回 Academic 管理入口。
- `workspace/tasks` 从 Dashboard 导航激活；PersonalTask deadline 不进入 Timeline。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run verify` | PASS：182 unit、83 architecture、624 UI；15 个条件跳过。typecheck、lint、Prettier、frontend build 均通过。 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | PASS：49 tests。 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | PASS。 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | PASS。 |
| `git diff --check` | PASS。 |

完整验证第一次运行中，一个既有课表 UI 测试在 `beforeEach` 等待导航按钮时超时；该单测隔离运行通过，随后完整 `npm run verify` 通过。没有为该超时修改产品代码或放宽断言。

Rust 链接器输出 Windows 导入库生成提示；测试、格式检查与 Clippy 均成功，未产生 Rust lint 错误。

## 数据与边界

- schema 保持 6；未增加迁移或改变生产数据库路径。
- 测试覆盖 PersonalTask CRUD、deadline/status validation、complete/reopen、数据库重开及删除任务时的关联 TimeBlock cascade。
- Workspace Tasks 不直接调用 Tauri/storage；AcademicTask 不可在该处编辑。
- AcademicCourseOccurrence 的 Timeline adapter 不接收 PersonalTask/deadline。
- 未执行 Tauri production build、安装态验证、push、tag 或 Release；均不属于本阶段门禁。

## 重要文件

- `src/application/planner/personal-tasks.ts`
- `src/services/planner-storage.ts`
- `src/workspace/tasks/WorkspaceTasksPage.tsx`
- `src-tauri/src/db.rs`
- `src-tauri/src/models.rs`
- `docs/v2-planner-domain-contract.md`
