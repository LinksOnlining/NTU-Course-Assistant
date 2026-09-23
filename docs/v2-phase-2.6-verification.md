# Phase 2.6 — Unified Workspace Dashboard 验证记录

日期：2026-09-24
状态：实现完成；定向自动验证 PASS；完整阶段门禁留待 Phase 2.7 最终回归

## 实现与边界

- Workspace Application 并行读取 Academic schedule/hub 与 PlannerEvent、TimeBlock、PersonalTask；Academic 课程仍由 canonical occurrence resolver 解析。时间轴保留当天项目，额外加载未来七日安排用于下一项情境。
- Dashboard 时间轴组合课程、独立日程与个人任务时间块。PersonalTask deadline 本身不进入时间轴；TimeBlock 标题从关联的 PersonalTask 投影，不复制任务事实。仅未取消且占时的项目参与今日安排计数。
- AcademicTask 与 PersonalTask 合并到最多四项任务预览，保留“学业 / 个人”来源。按逾期、今天、未来、无截止日排序；同日按有时间、日期-only、优先级排序。PersonalTask deadline 仍与 TimeBlock 分离。
- Time Context 显示当前安排/空闲与下一项未来安排的标题、日期、来源和时间。Planner buffers 参与有效占用及空闲时长计算，但不改变 Timeline 的真实起止时间。摘要不显示按来源拆分的日程数量。
- 路由进入或返回 Dashboard 时重新加载；跨本地午夜重新加载新日期。分钟时钟仅更新派生 ViewModel、倒计时及当前时间线，不作数据库轮询。
- 无 schema migration、SQL、Rust、依赖或版本号修改；Diary、Inbox、AI 仍为未开放状态；未进入 Phase 3。

## 定向验证

- `npm run typecheck`：PASS。
- `node --test tests/unit/workspace-dashboard.test.mjs`：PASS，11 tests；覆盖跨源任务排序、来源标签、Planner 时间轴、取消项目计数、buffer-aware 空闲和读取范围。
- `node --test tests/architecture/workspace-dashboard-boundaries.test.mjs`：PASS，7 tests；覆盖 Application/presentation 边界、canonical Academic resolver、Planner 投影与任务 deadline 隔离。
- `npx playwright test tests/ui/workspace-dashboard.spec.ts --project=1280-100`：PASS，11 tests；覆盖 Dashboard、混合来源安排、任务导航、创建任务后返回 Dashboard 可见最新数据、时间轴边界、空状态、主题和本地时钟。
- Dashboard UI 定向运行在 Playwright `1280×800 / DPR 1` 项目；其余响应式目标、全部 UI suite 与正式门禁由 Phase 2.7 最终回归覆盖。
- 本阶段未运行 Rust checks（Rust 未改动）、完整 `npm run verify`、production build、Windows GUI、安装器或生产 EXE。
