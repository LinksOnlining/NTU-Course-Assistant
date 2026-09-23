# 当前项目状态

- 最后更新：2026-09-23

## Links Workplace v2.0

- 当前开发分支：`v2/workspace-rebase`，从稳定 `main` commit `3f2d580d2423bdb19d2753023db6414b5408c546` 创建；`main` 继续代表稳定 1.x 基线。
- Phase 1.0 Read-Only Architecture Rebase Audit：COMPLETE。结论：当前无 router；Application boundary 部分存在；Academic occurrence resolver 是稳定核心；identifier 决定 AppData 路径；尚无完整 Design Tokens；schema 为 5；当前实现没有 migration 前备份。
- Phase 1.1 Architecture Contract & Project Baseline：COMPLETE。已建立项目规则、v2 产品需求 SSOT 和架构契约。
- Phase 1.2 类型化导航契约与对象定位基础：COMPLETE。新增 `src/navigation/types.ts` 与 `src/navigation/navigation.ts`；App 和 AcademicHub 已由 `AppRoute` 驱动，Academic Tasks 暂用 `academic/tasks-legacy` 兼容路由；未引入 Router，未改变可见文案或布局。`npm run verify` PASS：139 单元、62 架构、453 UI PASS / 15 条件跳过，以及 typecheck、lint、format、build PASS。
- Phase 1.3 Academic 应用层读取边界：COMPLETE。新增 `src/application/academic/` 的 `AcademicScheduleData`、`AcademicHubData` 与 `loadAcademicScheduleData`、`loadAcademicHubData`、`resolveAcademicOccurrences`；App / AcademicHub 的 Academic 读取已迁移到应用层 facade，resolver 仍委托稳定 core。Academic 写入继续使用 legacy storage service；Widget / Reminder 本轮未迁移。`npm run verify` PASS：146 unit、66 architecture、453 UI PASS / 15 条件跳过，以及 typecheck、lint、format、frontend build PASS。
- Phase 1.4 Design Tokens & Theme Foundation：COMPLETE。新增 `src/theme/` 语义令牌与主题逻辑；主窗口支持浅色、深色、跟随系统，默认浅色，偏好存于 `localStorage`。浅色 Accent 保持既有绿色；深色覆盖主课表、Today/AcademicHub、表单与设置、课程卡和 PDF 预览。主题在主窗口 React 渲染前应用，系统主题监听可清理。Widget 外观未迁移；未改 Academic 业务逻辑、导航、Rust、数据库/schema、identifier、依赖、产品名、README 或 CHANGELOG。`npm run verify` PASS：154 unit、70 architecture、480 UI PASS / 15 skipped，typecheck、lint、format、frontend build 均 PASS。
- Phase 1.5 Links Workplace 公共 Shell：COMPLETE。新增 `src/shell/` 公共应用外壳；主窗口 React UI 品牌为 Links Workplace，默认进入 `workspace/home`，顶部提供工作台/课表切换、本地日期、每日已核验寄语与设置。Weather Slot 已预留但不渲染内容；不获取或伪造天气数据。Academic 子导航及课表专属控制已与工作台分离；学业事项仍是 AcademicTask 临时过渡入口。未实现路由显示明确状态，不再静默回退到 Today。正式工作台 Dashboard 尚未实现；Tauri / 系统品牌身份未迁移。Windows 11 Pro 人工 UI 验收待 Ethan 执行。
- Phase 1.5 自动验证：`npm run verify` PASS；159 unit、73 architecture、516 UI PASS / 15 条件跳过，typecheck、lint、format、frontend build 均 PASS。本轮未修改 Rust / DB / Tauri config，因此未运行 Rust 或 Tauri production build。
- v2 开发及主要人工验收环境：Windows 11 Pro。v1.3.1 的 Windows 10 安装态 ALL PASS 是历史验收事实，不代表在 Windows 11 已执行相同验收。
- 当前 v2 目标品牌为 Links Workplace；顶层导航 `[工作台] [课表]`；技术 identifier `com.ntu-course-assistant.desktop`、`courses.sqlite3`、GitHub repo/updater source 保持不变。Quick Capture 与 Focus 在当前规划中为 REMOVED。
- 下一阶段：等待 Ethan / ChatGPT 审核后进入 Phase 1.6，不自动开始。

## 当前稳定版本：NTU Course Assistant v1.3.1

- 当前稳定版本：**NTU Course Assistant v1.3.1 — RELEASED**。
- GitHub Release：[v1.3.1](https://github.com/LinksOnlining/NTU-Course-Assistant/releases/tag/v1.3.1)；annotated tag 指向 `a2c1d7043ae65ff71d9ad154f0b53967b6dd0a0a`。`v1.3.0` 未修改。
- v1.3.1 时间事实：`startPeriod/endPeriod` 成对存在时，节次索引是课程时间的权威事实；课程实际时间始终由当前已确认的 `PeriodTime[]` 解析。两节次索引均为空时才使用固定钟点。旧 `startTime/endTime` 对节次课程仅为兼容快照，不得用于运行时回退；本次无 schema migration 或课程批量改写。
- 验证：本机 `npm run verify` PASS（132 unit、60 architecture、453 UI PASS，15 条件跳过）；Rust 40 tests、fmt、clippy PASS；当前 HEAD 的 Tauri production build、NSIS/MSI 及 updater signatures PASS。GitHub main CI、tag CI 与 Release workflow 均 PASS。
- Windows 10 安装态最终人工验收由 Ethan 确认 **ALL PASS**：作息修改即时影响按节次课程；固定钟点课程不变；换教室、明确调课、停课语义保持正确；Schedule、Today、Widget、Reminder 和重启恢复一致。
- Updater：公开 `latest.json` 为 1.3.1；NSIS/MSI 签名文件与 metadata 一致，且两份 GitHub installer 均通过当前 updater public key 的 Minisign 验证。**v1.3.0 安装态升级到 v1.3.1 的真实 updater E2E 未执行，状态 BLOCKED / 未验证**；不得据此宣称跨版本自动升级 PASS。
- SQLite schema：5。已知限制：应用完全退出后不提供后台提醒；未进行 Windows Authenticode 商业代码签名。
- 1.x 进入稳定维护，仅修复真实 bug，不主动增加功能。v2 已完成架构基线、类型化导航契约、Academic 读取边界、主题基础及公共 Shell；正式 Dashboard 和其他 Workspace 业务模块尚未开始。
- 详细发布与回归记录：`docs/v1.3.1-verification.md`。
