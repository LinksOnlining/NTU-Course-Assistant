# Links Workplace v2.0 — Phase 4.6 验证记录

日期：2026-09-27
分支：`v2/workspace-rebase`
修复基线：`91c8ca8 feat: expand ai planner for future scheduling`
SQLite：schema `7`，migration `0`

## 阶段状态

- Phase 4.6 Implementation：**COMPLETE**
- Phase 4.6 Automated：**PASS**
- Phase 4.6 DeepSeek Live：**PASS**（Ethan 确认 Windows / DeepSeek 人工验收通过）
- Phase 4.6 Overall：**COMPLETE**
- Phase 4.7：**NOT STARTED**；Phase 5：**NOT STARTED**

## 实现范围

- 自然语言意图及日期/时间范围由本地可信路由解析；最多规划未来 31 天。时区取本地 Application Clock 注入值，默认 `Asia/Shanghai`。daypart 使用统一窗口：上午 06:00–12:00、下午 12:00–18:00、晚上 18:00–22:00、深夜 22:00–24:00。
- 区分只读分析、独立活动 `PlannerEvent`、已有 `PersonalTask` 的 `TimeBlock`、显式创建 `PersonalTask` 和澄清。对话无历史；已有任务仅接受唯一规范化 exact match；缺少日期、时长或目标对象时不猜测。
- 目标日期 Context 复用现有 Context Engine、Academic Application 查询及 Planner Application 查询。课程使用 canonical effective occurrence；包含目标区间内的考试、学业截止日期、PlannerEvent、TimeBlock、开放任务。Weather 仅读取已授权且已缓存的摘要，不触发位置或天气请求；Diary 正文、Inbox 原文、Search 与 DB 不对 AI 开放。
- 空闲时间在本地基于现有 Timeline `computeFreeTimeIntervals` / `effectiveOccupancy` 确定性计算，考虑课程、考试、日程、TimeBlock 与 buffer。当天不推荐已经开始的时间；明确时刻的普通冲突保留 warn-but-allow 并显示预览提示。超过范围、冲突数据不完整或 Context 被截断时不生成安全候选。
- 安全边界保持 `planner.propose` 模块级授权 + workflow-specific 单一 Proposal Tool allowlist。一个请求最多一个 Proposal；Provider 仅提交与当前请求唯一候选完全一致的 `candidateId`；日期和时间由可信本地 payload 构造。Provider 无 Apply/Write 工具；用户确认后才通过现有 Proposal Review、重校验和 Application UseCase 写入。
- 仅扩展现有工作台 Composer 的一次性请求路由与结果标题；未新增聊天历史、数据库结构、AI 一级导航或新 Provider。

## Live 问题修复（2026-09-27）

### PlannerEvent 候选不匹配

- 故障阶段定位为 Proposal Tool 参数门禁：旧流程先在本地构造日期、开始/结束时间等完整 payload，再要求 Provider 重新生成这些业务字段，并将 Provider 参数与完整本地 payload 做 `stableStringify` 精确比较；任何一个值不同都会命中“AI 返回的提案未匹配本地校验候选，请重试”。这是结构性根因。既有日志未保存本次 DeepSeek 的原始 `function_call.arguments`，因此无法诚实指出当时究竟哪一个字段发生差异；不将猜测写成事实。
- 旧 Candidate 只有日期、本地开始/结束钟点、时长、warnings 和 source window，没有可供 Provider 选择的候选身份。当前 Candidate 包含稳定 `candidateId`、本地日期/钟点、由同一注入时区生成的 ISO `start` / `end`、`durationMinutes`、warnings 和 source window。
- ID 使用 `slot-YYYYMMDD-HHMM-HHMM` 的确定性格式，由本地候选日期与本地起止钟点组成；相同输入重复生成相同 ID。`planner_propose_event` / `planner_propose_time_block` 只向 Provider 暴露 `candidateId`，不暴露可由模型改写的 start/end。运行时仍严格校验该 ID 与当前请求唯一候选一致；Proposal Adapter 从当前请求的可信本地 `canonicalPayload` 构造 Proposal，Provider 不提供任何时间事实。伪造 ID 或额外传入 start/end 均被拒绝。
- 时间业务字段仍以 Planner 使用的本地 `date` + `startTime` / `endTime` 为准；Candidate 的 ISO 时刻从同一时区契约派生，不以 UTC 字符串与本地钟点作裸字符串比较。明天晚上解析为 18:00–22:00 窗口；30 分钟请求在全空窗口中确定性选择最早合法的 18:00–18:30。明确指定 20:00 时只候选 20:00–20:30，不暗中改时。结束时间不允许序列化为不受当前 Planner 时间 schema 支持的 24:00。
- 真实开发态数据库只读核验中，测试目标“高数复习”的唯一未完成 exact match 数为 0；本地澄清是正确安全行为，不创建伪 ID 或模糊绑定。自动 fixture 覆盖唯一 exact match、零匹配、多个同名匹配及中文/英文外层引号规范化。该检查只记录匹配数量，不复制数据库行。
- PersonalTask Proposal 创建路径保持现状并通过回归。Event Proposal Review 标题为“建议创建活动”，预览包括活动名、日期、合并时间段、时长、地点和缓冲；只有本地用户确认、重新校验通过后才调用现有 Application UseCase。提案生成/预览本身不写入。

### 隐私与 Provider 指令

- 工作台提示由“仅使用你在 AI 设置中允许的数据，并发送至 DeepSeek 处理。”调整为“仅在你主动使用 AI 时，将本次请求所需且已授权的数据发送至 DeepSeek 处理。”；权限 Gate、显式用户动作、workflow 最小读取范围和 Context 投影机制未改变。
- 当前 workflow 有 Proposal Tool 时，trusted instructions 表述为仅可生成待审提案并等待用户确认，不声称只读或可直接应用；没有 Proposal Tool 时才说明当前为只读分析。Provider 仍无 Apply/Write Tool。

## 自动验证

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS — 338 unit、130 architecture、1011 UI；15 UI 条件跳过；lint、Prettier、前端 build 均 PASS |
| Planner/Context/Proposal/Tool/Orchestrator targeted regression | PASS — 55 tests；Candidate、Task exact match、Proposal gate / confirm / revalidation 覆盖 |
| Today Assistant targeted UI regression | PASS — 126 tests，9 个窗口/DPI 项目均通过（包含新 privacy 文案和 Event Proposal 预览字段） |
| AI operation / Today Assistant architecture tests | PASS — 13 tests |
| `cargo test --manifest-path src-tauri/Cargo.toml` | PASS — 97 tests |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | PASS |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | PASS |
| `npm run tauri build` | PASS — Windows x64 EXE、NSIS、MSI 及 updater `.sig` 均生成 |

UI tests 中 15 项为既有条件跳过；Playwright 可能记录 Tauri mock `currentWindow` 订阅和 PDF.js 索引 warning，未导致测试失败。构建输出存在既有单 chunk 大于 500 kB 的非阻断提示。

## 本机 Build 产物检查

以下均为忽略目录 `src-tauri/target/release/` 内本轮重新生成的本地构建产物；未加入 Git。文件名显示 v2 开发分支当前应用版本 `1.3.1`；本 Phase 未更改产品版本、Tauri 依赖版本或 schema。只确认文件、大小和 SHA-256，没有运行 EXE 或安装 installer。

| 文件 | 大小（字节） | SHA-256 |
|---|---:|---|
| `ntu-course-assistant.exe` | 67,993,600 | `FB5852B64A9FA15E3A9A543E32BCD8A353D09659B3E23E13EC007A9F79600460` |
| `NTU Course Assistant_1.3.1_x64_en-US.msi` | 54,390,784 | `502D34466F4B9E9E85B5742558CF7CD1E3242D813B377C8FD274F3519A0E2089` |
| `NTU Course Assistant_1.3.1_x64_en-US.msi.sig` | 436 | `9D9C4AC896084D20DB3CC11458D44A6068910853D72D76FD0787A612EED9BF92` |
| `NTU Course Assistant_1.3.1_x64-setup.exe` | 52,433,468 | `4F9F84A0710E26D367F06851E3A7EF26F90A4A86D6AA6DBC7FC149CCC4A52309` |
| `NTU Course Assistant_1.3.1_x64-setup.exe.sig` | 436 | `9015B61ECACFB1D817E0D7E358C7E526F2E5C34F309B3868DC39C9DD54B474A1` |

**本机 build 核验未运行 EXE、未安装 installer、未访问 Release 用户数据库，也未发起真实 DeepSeek 请求。** 这些限制仅描述构建验证范围；Ethan 后续单独完成的 Windows / DeepSeek Live 验收结果见下文。该 build 仅证明当前工作树可完成 production packaging；不是新版本 Release。只读核验的数据库是独立 `dev-v2` 数据库，仅得到任务匹配计数 `0`。

## Ethan Windows / DeepSeek 人工验收结果

Ethan 确认 Phase 4.6 Windows / DeepSeek 人工验收通过，以下结果记录为用户实测确认：

- Future-date Planner 与 Planner AI future planning：**PASS**。
- 已有 PersonalTask 识别：**PASS**。
- TimeBlock Proposal、Proposal / Confirmation flow、TimeBlock 实际写入：**PASS**。
- Task 与 TimeBlock 语义隔离：**PASS**。为“高数复习”安排明天下午 1 小时 TimeBlock 后，TimeBlock 新增成功；PersonalTask 原本无 Deadline，写入后仍无 Deadline。
- Deadline 表示最晚完成时间；TimeBlock 表示计划执行时间。安排执行时间不得自动修改 Task Deadline。未来若用户明确要求修改 Deadline，必须通过独立的 Old Deadline → New Deadline Proposal、Preview、User Confirm、Revalidate 与 Application UseCase；不得与 TimeBlock Proposal 捆绑静默修改。

本节为 Ethan 提供的真实人工验收结果；没有将本次自动测试或代码检查冒充为 Windows / DeepSeek 人工验收。Phase 4.6 Overall 已关闭；Phase 4.7 尚未开始。
