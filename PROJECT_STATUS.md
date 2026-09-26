# 当前项目状态

- 最后更新：2026-09-26

## Links Workplace v2.0

- **当前状态：Phase 3 COMPLETE；Phase 3.9 Database Migration Recovery PASS；Phase 4.0 COMPLETE；Phase 4.1 Implementation / Automated / Windows Live Manual / Overall COMPLETE；Phase 4.2 AI Runtime Permission + Context Engine COMPLETE；Phase 4.3 NOT STARTED。** Phase 4.1 的 DeepSeek Native Responses API adapter、Windows Credential Manager 与用户主动模型发现已完成；真实 `GET /models`、凭据持久化/删除和断网处理经 Ethan Windows 11 验收通过。Phase 4.2 新增默认关闭的数据读取权限 UI、默认拒绝的 Runtime Gate、仅限当前请求及所选对象的一次性敏感授权契约、按模块隔离的安全 Snapshot / 投影 / 脱敏 / 预算 Context Builder；没有 Tool 执行、Proposal 应用、AI Chat 或 Provider 网络调用。SQLite schema 维持 7、migration 0；未访问 Release 用户数据库。`POST /responses` 文本及结构化真实生成待首次正式 AI 工作流验收。详见 `docs/v2-phase-4-2-verification.md`。
- Phase 3 隐私事实源：`docs/v2-personal-context-privacy-contract.md`。Diary/Inbox/Search 本地化；Context 不含私人正文；Weather 是唯一外网能力且默认关闭，手动搜索仅在提交后请求 Photon 并只保存最终选中地点，当前位置需明确同意、系统授权和坐标模糊化；Routine 只建议并需用户确认。Phase 3.0 文档提交 `11fa394` 已保留。
- Planner 冻结约束见 `docs/v2-planner-domain-contract.md`：Task deadline 不占 Timeline；Academic occurrence 在 Planner 只读；PersonalTask 1:N TimeBlock；Event 独立；buffer 不改事实时间；冲突 warn-but-allow。

- 当前开发分支：`v2/workspace-rebase`，从稳定 `main` commit `3f2d580d2423bdb19d2753023db6414b5408c546` 创建；`main` 继续代表稳定 1.x 基线。
- Phase 1.0 Read-Only Architecture Rebase Audit：COMPLETE。结论：当前无 router；Application boundary 部分存在；Academic occurrence resolver 是稳定核心；identifier 决定 AppData 路径；尚无完整 Design Tokens；schema 为 5；当前实现没有 migration 前备份。
- Phase 1.1 Architecture Contract & Project Baseline：COMPLETE。已建立项目规则、v2 产品需求 SSOT 和架构契约。
- Phase 1.2 类型化导航契约与对象定位基础：COMPLETE。新增 `src/navigation/types.ts` 与 `src/navigation/navigation.ts`；App 和 AcademicHub 已由 `AppRoute` 驱动，Academic Tasks 暂用 `academic/tasks-legacy` 兼容路由；未引入 Router，未改变可见文案或布局。`npm run verify` PASS：139 单元、62 架构、453 UI PASS / 15 条件跳过，以及 typecheck、lint、format、build PASS。
- Phase 1.3 Academic 应用层读取边界：COMPLETE。新增 `src/application/academic/` 的 `AcademicScheduleData`、`AcademicHubData` 与 `loadAcademicScheduleData`、`loadAcademicHubData`、`resolveAcademicOccurrences`；App / AcademicHub 的 Academic 读取已迁移到应用层 facade，resolver 仍委托稳定 core。Academic 写入继续使用 legacy storage service；Widget / Reminder 本轮未迁移。`npm run verify` PASS：146 unit、66 architecture、453 UI PASS / 15 条件跳过，以及 typecheck、lint、format、frontend build PASS。
- Phase 1.4 Design Tokens & Theme Foundation：COMPLETE。新增 `src/theme/` 语义令牌与主题逻辑；主窗口支持浅色、深色、跟随系统，默认浅色，偏好存于 `localStorage`。浅色 Accent 保持既有绿色；深色覆盖主课表、Today/AcademicHub、表单与设置、课程卡和 PDF 预览。主题在主窗口 React 渲染前应用，系统主题监听可清理。Widget 外观未迁移；未改 Academic 业务逻辑、导航、Rust、数据库/schema、identifier、依赖、产品名、README 或 CHANGELOG。`npm run verify` PASS：154 unit、70 architecture、480 UI PASS / 15 skipped，typecheck、lint、format、frontend build 均 PASS。
- Phase 1.5 Links Workplace 公共 Shell：COMPLETE。新增 `src/shell/` 公共应用外壳；主窗口 React UI 品牌为 Links Workplace，默认进入 `workspace/home`，顶部提供工作台/课表切换、本地日期、每日已核验寄语与设置。Weather Slot 已预留但不渲染内容；不获取或伪造天气数据。Academic 子导航及课表专属控制已与工作台分离；学业事项仍是 AcademicTask 临时过渡入口。未实现路由显示明确状态，不再静默回退到 Today。正式工作台 Dashboard 尚未实现；Tauri / 系统品牌身份未迁移。Windows 11 Pro 人工 UI 验收待 Ethan 执行。
- Phase 1.5 自动验证：`npm run verify` PASS；159 unit、73 architecture、516 UI PASS / 15 条件跳过，typecheck、lint、format、frontend build 均 PASS。本轮未修改 Rust / DB / Tauri config，因此未运行 Rust 或 Tauri production build。
- Phase 1.6 工作台首页与统一 24 小时时间轴基础：COMPLETE。`workspace/home` 现在渲染 `WorkspaceDashboard`，复用 Academic application reads 与 canonical occurrence resolver；新增仅供展示的 `TimelineItem` 投影和 1,440 分钟日布局，处理重叠分栏、无效时间警告、停课与只读语义。工作台提供今日时间轴、当前/下一课程摘要、最多 4 项学业任务摘要及明确未开放的 Diary / Inbox / AI 卡片；分钟时钟不触发数据库轮询，本地跨日会重新读取当天 Academic 数据。未新增业务事实、数据库结构或模块能力。Windows 11 Pro 人工验收尚待 Ethan 执行。
- Phase 1.6 验证：新增 15 个 unit、4 个 architecture、6 个 Workspace UI 场景 PASS；完整 `npm run verify` PASS：174 unit、77 architecture、570 UI PASS / 15 条件跳过；typecheck、lint、Prettier、frontend build 均 PASS。本轮未修改 Rust / DB / Tauri config、未新增依赖，因此未运行 Rust checks 或 Tauri production build。Playwright 仍会输出既有 Widget bounds Tauri mock `currentWindow` warning，未导致测试失败。
- Phase 1.6.1 工作台整体 UI 精修与设置分域：实现及自动验证完成，Windows 11 Pro 人工视觉验收 **PENDING**。工作台采用 Quiet Productivity 的连续 Top Canvas（品牌、已核验每日寄语、确定性 Today Overview、静态弱背景），以 Time / Link / Node 呈现时间与来源关联；主内容改为 Timeline / Time Context / Workspace Rail 三栏。Time Context 只消费已解析投影，显示当前/下一课程及真实空闲，不创建第二时间轴；任务显示自然截止日期和学业来源，Diary / Inbox / AI 保持明确未开放。新增 Surface 与 motion 语义 token、Reduced Motion 规则。统一设置容器按工作台/课表/通用分域，入口默认分别为首页/作息，主题位于通用外观；原作息、提醒、Widget 等保存逻辑未重构。`npm run verify` PASS：176 unit、78 architecture、579 UI PASS / 15 条件跳过，typecheck、lint、format、frontend build 均 PASS。仅改前端与测试/架构文档，schema 仍为 5；未运行 Rust 或 Tauri production build。
- Phase 1.6.2 Windows 11 Visual Polish：实现、自动验证及 Ethan / ChatGPT Windows 11 Pro 真实截图复验均 **PASS**。压缩 Top Canvas 与低高度布局，删除可见的“今日概览”“时间概览”冗余标签；Time Context 使用纯 ViewModel 表达当前空闲/正在上课与下一课程/空闲，长课程名最多两行；设置首页改为真实功能说明，设置滚动条与 Timeline 统一细窄样式，深色半小时线和次级文字收敛。00:00/24:00 刻度向画布内对齐，课程块与当前时间线仍按 1 分钟=1px 定位。后追加的 Quote → Today Status 呼吸间距微调已单独提交 `f840adb`，未重新扩大 Top Canvas，≤850px 紧凑规则保持。
- Phase 1.7-A 综合回归与 Production Build：**PASS**。前端 `npm run verify`：177 unit、79 architecture、606 UI PASS / 15 条件跳过，typecheck、lint、Prettier、frontend build 均 PASS；Rust 40 tests、`cargo fmt -- --check`、`cargo clippy` PASS。Tauri production build 成功，生成主 EXE、NSIS、MSI 与两种 installer 的 updater `.sig`。未运行 production EXE、未安装 installer、未访问用户数据库。范围审查确认 Phase 1 之外的 Planner/PersonalTask/Diary/Inbox/AI/Weather 等无实现，schema 5。
- **Phase 1 Overall：COMPLETE**（仅表示已冻结的架构、Shell、Theme、Workspace Dashboard、Timeline、Settings 与自动/Rust/production build 门禁完成；不表示 v2 Release Ready）。Windows 11 Pro Visual Acceptance：PASS。Installer compatibility：NOT VERIFIED；v1.3.1 → v2 updater E2E：NOT EXECUTED；系统级品牌迁移：PENDING；Phase 2 已完成，详见 `docs/v2-phase-2-verification.md`。
- v2 开发及主要人工验收环境：Windows 11 Pro。v1.3.1 的 Windows 10 安装态 ALL PASS 是历史验收事实，不代表在 Windows 11 已执行相同验收。
- 当前 v2 目标品牌为 Links Workplace；顶层导航 `[工作台] [课表]`；技术 identifier `com.ntu-course-assistant.desktop`、`courses.sqlite3`、GitHub repo/updater source 保持不变。Quick Capture 与 Focus 在当前规划中为 REMOVED。
- Phase 1 后曾记录“等待 Phase 2 确认”的条目为历史状态；Phase 2 现已由 Ethan 明确授权连续执行。

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
