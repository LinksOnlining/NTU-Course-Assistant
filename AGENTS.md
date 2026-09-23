# Links Workplace 项目规则

## 项目身份

- 当前开发目标：Links Workplace v2.0；它是在本仓库内对 NTU Course Assistant v1.3.1 的原地演进，不是新仓库或第二套课程表。
- 现行需求事实源：`PROJECT_BRIEF.md`；v2 技术边界：`docs/v2-architecture-contract.md`。
- Codex 是执行器；产品与主要架构决策由 Ethan / ChatGPT 给出。指令与实际代码不符时先报告，不猜测或自行重设计。

## 新任务读取顺序

1. `AGENTS.md`
2. `PROJECT_BRIEF.md`
3. `PROJECT_STATUS.md`
4. 与任务有关的 `DESIGN.md` / `docs/`
5. `git status` / `git diff`
6. 任务直接相关的源码

按 `Search → Read → Modify → Verify` 工作；先看 diff 和直接调用链，不做无目的全仓扫描。小批次修改，只运行足以证明本次变更正确的验证；真实 Windows UI 验收由 Ethan 决定。自动测试不等于人工验收。

## 稳定 Academic 边界

以下是 HIGH STABILITY；未经具体任务授权，不整体搬迁、重写、重命名或顺手清理：

- `src/core/period-time.ts`
- `src/core/course-occurrence.ts`
- `src/core/reminder.ts`
- `src/core/reminder-v2.ts`
- `src/core/import-proposal.ts`
- `src/importers/ntu-pdf/parse.ts`
- `src/core/timetable-layout.ts`
- `src-tauri/src/db.rs`
- `src-tauri/src/scheduler.rs`

节次课程以 `startPeriod/endPeriod` 为权威事实，钟点由当前 `PeriodTime[]` 解析；不能回退到旧时间快照。固定钟点课程以明确保存的 `startTime/endTime` 为准。`Task Deadline` 不等于时间轴占用；Diary 不是时间轴占用；AI Proposal 不是业务事实。

Planner 领域边界：`PersonalTask` deadline 不占时间轴；Academic CourseOccurrence 在 Planner 只读；PersonalTask 可关联多个 TimeBlock；PlannerEvent 独立；buffer 只影响冲突/空闲计算，不改变事实时间；冲突是允许用户确认继续保存的 warning，不是持久化拒绝条件。

## 技术身份与数据

- Tauri identifier `com.ntu-course-assistant.desktop`、`courses.sqlite3` 文件名、GitHub 仓库及 updater 来源在专门迁移任务前保持不变。不得仅为品牌整洁而更改；identifier 变更须先有数据迁移设计、Windows installer/updater E2E 和 Ethan 明确批准。
- React 界面品牌与 Tauri `productName`、系统窗口标题、Tray、安装器和 updater 身份分开迁移；系统级品牌变更必须经过独立兼容任务。
- 当前 SQLite schema 为 5。任何 schema 升级前须设计并验证备份、事务迁移、数据校验和失败恢复；当前应用没有 migration 前备份。
- Presentation 不直接访问 SQLite；Workspace 不绕过 Application API 读取 Academic 内部表；AI 不直接访问 Repository 或 DB。

## 产品方向保护

- v2 当前基线为 `Links Workplace`；顶层为 `[工作台] [课表]`，默认进入工作台。
- 当前规划已取代旧文档中的旧 v2 方向：Quick Capture 与 Focus 均为 REMOVED。不得按旧历史材料恢复它们或 FocusSession / Planned-vs-Actual。
- 每个任务只做明确授权的范围。没有明确 Phase 指令时不自行开始下一阶段，不发布、不推送、不改稳定 tag。
- 版本 1.3.1 的 Windows 10 验收是历史事实；v2 当前开发及主要人工验收环境是 Windows 11 Pro。

新 Workspace UI 不得新增主品牌颜色 literal，应使用 Design Tokens。
