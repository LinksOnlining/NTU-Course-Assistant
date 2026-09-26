# Links Workplace v2.0 — Phase 4.6 验证记录

日期：2026-09-27
分支：`v2/workspace-rebase`
实现基线：`9da94c0 docs: close phase 4.5 live acceptance`
SQLite：schema `7`，migration `0`

## 阶段状态

- Phase 4.6 Implementation：**COMPLETE**
- Phase 4.6 Automated：**PASS**
- Phase 4.6 DeepSeek Live：**PENDING**（未执行真实 Planner Tool Calling）
- Phase 4.6 Overall：**PENDING** Ethan Windows 人工验收
- Phase 5：**NOT STARTED**

## 实现范围

- 自然语言意图及日期/时间范围由本地可信路由解析；最多规划未来 31 天。时区取本地 Application Clock 注入值，默认 `Asia/Shanghai`。daypart 使用统一窗口：上午 06:00–12:00、下午 12:00–18:00、晚上 18:00–22:00、深夜 22:00–24:00。
- 区分只读分析、独立活动 `PlannerEvent`、已有 `PersonalTask` 的 `TimeBlock`、显式创建 `PersonalTask` 和澄清。对话无历史；已有任务仅接受唯一规范化 exact match；缺少日期、时长或目标对象时不猜测。
- 目标日期 Context 复用现有 Context Engine、Academic Application 查询及 Planner Application 查询。课程使用 canonical effective occurrence；包含目标区间内的考试、学业截止日期、PlannerEvent、TimeBlock、开放任务。Weather 仅读取已授权且已缓存的摘要，不触发位置或天气请求；Diary 正文、Inbox 原文、Search 与 DB 不对 AI 开放。
- 空闲时间在本地基于现有 Timeline `computeFreeTimeIntervals` / `effectiveOccupancy` 确定性计算，考虑课程、考试、日程、TimeBlock 与 buffer。当天不推荐已经开始的时间；明确时刻的普通冲突保留 warn-but-allow 并显示预览提示。超过范围、冲突数据不完整或 Context 被截断时不生成安全候选。
- 安全边界保持 `planner.propose` 模块级授权 + workflow-specific 单一 Proposal Tool allowlist。一个请求最多一个 Proposal；Provider 参数必须与本地核验候选完全一致。Provider 无 Apply/Write 工具；用户确认后才通过现有 Proposal Review、重校验和 Application UseCase 写入。
- 仅扩展现有工作台 Composer 的一次性请求路由与结果标题；未新增聊天历史、数据库结构、AI 一级导航或新 Provider。

## 自动验证

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS — 331 unit、130 architecture、1011 UI；15 UI 条件跳过；lint、Prettier、前端 build 均 PASS |
| Planner/Context/Proposal/Tool/Orchestrator targeted regression | PASS — 64 tests；后续日期边界补充测试 8/8 PASS |
| `cargo test --manifest-path src-tauri/Cargo.toml` | PASS — 97 tests |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | PASS |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | PASS |
| `npm run tauri build` | PASS — Windows x64 EXE、NSIS、MSI 及 updater `.sig` 均生成 |

UI tests 中 15 项为既有条件跳过；Playwright 可能记录 Tauri mock `currentWindow` 订阅和 PDF.js 索引 warning，未导致测试失败。构建输出存在既有单 chunk 大于 500 kB 的非阻断提示。

## 本机 Build 产物检查

以下均为忽略目录 `src-tauri/target/release/` 内的本地构建产物；未加入 Git。文件名仍显示应用现有版本 `1.3.1`，本 Phase 未更改产品版本、Tauri 版本或 schema。

| 文件 | 大小（字节） | SHA-256 |
|---|---:|---|
| `ntu-course-assistant.exe` | 67,993,088 | `EC8E429667994382896CFC0D42CA6E893DEABC24BFB89030601AA5DB663FF903` |
| `NTU Course Assistant_1.3.1_x64_en-US.msi` | 54,390,784 | `316657F1C82B929FFDAA0393D7D7CF78BDCF97FCE81F23A19E134953ABBEF0EA` |
| `NTU Course Assistant_1.3.1_x64_en-US.msi.sig` | 436 | `023B7E6F30F0307FB061877E25B279EF19A98EF5002C041DD4D49FBF20068EE2` |
| `NTU Course Assistant_1.3.1_x64-setup.exe` | 52,487,056 | `A41CDE281C17C78BC312F4D4C624419FD40DFA313F3E7F93170D944069F9F041` |
| `NTU Course Assistant_1.3.1_x64-setup.exe.sig` | 436 | `22D62F1571F587CF432FEA9D8D40ED39924D86BADD067F83F06904E93D221FE5` |

**没有运行 EXE、没有安装 installer、没有执行真实 DeepSeek 请求。** 本 build 仅证明当前工作树可完成 production packaging；不是新版本 Release。

## Live 状态与限制

- Phase 4.5 已完成的 DeepSeek `GET /models`、文本/结构化 `POST /responses`、真实 Workspace Context 与授权约束保持历史 PASS。
- Phase 4.6 DeepSeek Tool Calling（Event、TimeBlock、Task 三种路由）、真实 Proposal Preview/Review、确认后重校验与真实 Planner 写入：**NOT EXECUTED**。
- Windows 真实界面验收：**PENDING**。本记录没有将自动化 Mock E2E 当作 Provider/Windows Live PASS。
- schema 7、migration 0；没有新增 AI 持久化、聊天历史或 Proposal 数据表。

## Ethan 人工验收清单

请在 Windows 开发态先确认 AI 数据权限和 DeepSeek 已配置，再逐项检查：

1. 工作台输入“明天晚上跑步 30 分钟”：本地识别日期/时长，只产生一个待审 PlannerEvent，不声称已写入；检查预览后取消，再次确认数据未变化。
2. 输入“周末晚上跑步 45 分钟”：候选在周末窗口中确定；若缺信息/冲突，结果如实澄清或显示冲突，不伪造空闲事实。
3. 输入安排已有任务的请求：只在任务标题唯一 exact match 时生成 TimeBlock；不存在或重名时澄清，不绑定错误任务。
4. 输入明确创建 PersonalTask 的请求：只生成 Task Proposal，不自动生成 TimeBlock。
5. 分别确认、取消提案；确认后查看 Planner 结果，取消后验证未写入。若开始时间已过去或源日程变化，应要求重校验/再次确认。
6. 检查天气仅在已授权且有缓存时出现；未授权时不得触发位置、天气或其他后台请求。

人工验收全部完成前，Phase 4.6 Overall 保持 PENDING；不进入 Phase 5，不 push、不 tag、不发布 Release。
