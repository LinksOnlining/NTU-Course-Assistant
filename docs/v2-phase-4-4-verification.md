# Links Workplace v2.0 — Phase 4.4 验证记录

状态：**Phase 4.4 AI Proposal Review Pipeline COMPLETE；Phase 4.5 NOT STARTED。** 本阶段完成 Planner 提案生成与本地审阅基础；没有用户可见 AI workflow 入口，没有真实 DeepSeek Tool Calling live 请求，也未发布。

## 1. 基线与范围

- 项目：`D:\AI_Workspace\Projects\NTU-Course-Assistant`
- Branch：`v2/workspace-rebase`
- 起始 HEAD：`d283c8614608b89c58138b2f215216f533b78ac5`
- SQLite schema：**7**；migration：**0 added**。
- Phase 4.0–4.3 保持 COMPLETE；未访问 Release 用户数据库。
- Ponytail Skill：`ponytail:ponytail`，用于优先选择最小实现、复用现有 Planner UseCase 与无新增依赖方案。

## 2. 权限与 Tool capability

Permission 粒度：**module-level proposal authorization**。

```text
planner.propose
```

Tool 粒度：**workflow-specific proposal capability**。

| workflow allowlist                           | Provider 可见 Proposal Tool  | 结果 |
| -------------------------------------------- | ---------------------------- | ---- |
| permission 未授予                            | 无                           | PASS |
| `planner.propose` 有；allowlist 为 task      | `planner_propose_task`       | PASS |
| `planner.propose` 有；allowlist 为 event     | `planner_propose_event`      | PASS |
| `planner.propose` 有；allowlist 为 timeBlock | `planner_propose_time_block` | PASS |
| `planner.propose` 有；allowlist 缺失/为空    | 无                           | PASS |

没有按 Proposal 对象类型拆分权限，也没有任何 Apply、Mutation 或 Write Tool。伪造注册工具名无法绕过逐次执行 allowlist；同轮多项 Proposal 调用在任何副作用之前拒绝。

## 3. Proposal / Apply boundary

- Provider Tool 只可创建短时内存态 `reviewRequired` Proposal；来源由 orchestration 提供，Proposal id/status/timestamps 不能由 Provider 设置。
- 本地生成 preview 字段及冲突摘要。过期时间 15 分钟；冲突 warn-but-allow。关联 TimeBlock 任务必须存在且未完成。
- 用户取消、未确认、过期、关联任务失效路径不会调用写入。用户通过本地审阅组件显式确认后，重新检查权限、状态、预览 revision、关联任务和当前日程；预览发生变化时要求再次确认。
- 成功只在既有 Application UseCase 成功后记为 `applied`：`createPersonalTask`、`createPlannerEvent`、`createTimeBlock`。失败不自动重试；同一 proposal 的并发确认 single-flight，避免重复写入。
- Review UI 可复用，但本阶段未将其接入 production AI workflow 或增加 AI Chat / Prompt / Debug 入口。

## 4. 验证

- 完整 `npm run verify`：**PASS**。TypeScript typecheck、302 unit tests、127 architecture tests、885 UI tests、15 conditional skips、oxlint、Prettier 与前端 build 均通过。
- Targeted Proposal unit + architecture：**PASS**，39/39；包括单一 `planner.propose` 权限、逐 workflow allowlist、伪造调用拒绝、Proposal 输出类型约束、取消/未确认不写入、确认后 UseCase、冲突变化后二次确认、关联任务变化/失效、过期/失败终态与并发幂等。
- Targeted Playwright Mock UI：**PASS**，18/18 项（9 viewport/device-scale 项目 × 2 流程）；覆盖 Mock AI → Proposal Tool → Preview → 取消/Escape 不写入，以及显式用户确认 → 应用用例 fake repository 成功状态。使用 test fixture 与 fake repository，不访问 Release 用户数据库。
- Tauri production build：**PASS**（`npm run tauri build`）。生成 NSIS、MSI 及对应 updater `.sig`；只验证构建产物，未启动 EXE、未安装 installer。
- Rust：没有 Rust 源码或 Cargo dependency 修改；未单独运行 `cargo test`、`cargo fmt --check`、`cargo clippy`。Tauri release build 已成功编译 Rust release target。

## 5. Provider live 状态

- `GET /models`：**PASS**（继承 Phase 4.1 Ethan Windows 11 实测）。
- DeepSeek `POST /responses` 文本生成：**NOT EXECUTED**。
- DeepSeek `POST /responses` 结构化生成：**NOT EXECUTED**。
- DeepSeek `POST /responses` Tool Calling：**NOT EXECUTED**。没有正式 AI workflow 入口，本阶段使用 Mock Provider 自动验证，不创建临时生产入口。

## 6. 数据、构建与发布边界

- SQLite schema **7**，migration **0**；Proposal 仅内存态，不写 SQLite。
- Tauri 构建基于当前稳定版本 `1.3.1`，未升级产品版本号。产物在忽略目录 `src-tauri/target/release/bundle/`：
  - `msi/NTU Course Assistant_1.3.1_x64_en-US.msi`：54,366,208 bytes。
  - `msi/NTU Course Assistant_1.3.1_x64_en-US.msi.sig`：436 bytes。
  - `nsis/NTU Course Assistant_1.3.1_x64-setup.exe`：52,264,748 bytes。
  - `nsis/NTU Course Assistant_1.3.1_x64-setup.exe.sig`：436 bytes。
- 未运行生产 EXE、未安装 NSIS/MSI、未访问 Release 用户数据库。
- 未创建 tag、未 push、未发布 Release。
- 构建文件与签名时间为 2026-09-26 UTC；均保留在 Git 忽略的 `src-tauri/target/`，未纳入版本控制。

## 7. Git 收口

- `git diff --check`：PASS。Phase 4.4 实现、测试及文档将形成一个本地稳定提交；未 push、未创建 tag 或 Release。
- 最终提交与工作区状态以本阶段结束时的 Git 记录为准。
- 不进入 Phase 4.5。
