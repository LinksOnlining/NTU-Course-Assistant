# Links Workplace v2.0 — Product Brief

本文件是已确认的 v2.0 产品需求 SSOT。它描述目标与边界，不表示尚未实现的能力已经存在。v1.3.1 仍是当前稳定发布产品；v2 在现有应用中渐进演进。

## 1. Product

- **Name:** Links Workplace
- **Version target:** 2.0.0
- **Platform:** Windows 10 first for product compatibility; v2 development and primary manual acceptance run on Windows 11 Pro.
- **Evolution:** NTU Course Assistant → Links Workplace, in-place within this repository and existing application.

## 2. Product Principle

以时间为中心、结合个人上下文、以成熟 Academic 能力为基础、AI-assisted、local-first 的个人工作台。Academic 是稳定基座；新 Workspace 能力围绕它渐进生长。

## 3. Top-Level Navigation

- 固定为 `[工作台] [课表]`，工作台在左、课表在右。
- 默认进入工作台。
- “课表”保留现有 Academic 产品，不开发第二套课程系统。

## 4. Workspace Dashboard

- 工作台首页一屏完成，页面自身不纵向滚动；左侧约 68–70%，右侧约 30–32%。
- 左侧是 24 小时 Timeline，可在自身 viewport 内纵向滚动，默认定位当前时间附近。
- 右侧摘要为 Task、Diary、Inbox、AI；正常目标尺寸下不独立滚动。内容过多时显示摘要和“查看全部”，而不是无限长卡片。
- 顶部左侧 Links Workplace 与 Daily Quote；右侧 Date、Live Weather、工作台/课表切换及 Settings。
- Daily Quote 只能来自已验证名言库并正确署名，或标为 AI 生成内容；不得伪造名人署名。

## 5. Schedule / Academic

保留现有周课表、课程变化、考试、学期管理、PDF Import、教学周、Period settings、5/7 天视图，以及已有 Course / Occurrence / Override 体系。Academic 不重写。

## 6. Workspace Modules

目标模块：Schedule / Timeline、PersonalTask、PlannerEvent、TimeBlock、Diary、Inbox、AI。Weather、Context、Routine 是横切能力，不是工作台新增的大型独立卡片。

## 7. Domain Contracts

- `Course`、`CourseOccurrence` 与 `CourseOverride` 属于 Academic；保持既有模型。
- `PersonalTask`、`PlannerEvent`、`TimeBlock` 是不同概念。`AcademicTask` 与 `PersonalTask` 在 Domain 分离，即便 UI 可统一呈现。
- Task deadline 不等于已排入时间轴的时间；Diary 不是 Timeline occupancy；AI Proposal 不是业务事实。

## 8. Dashboard Interaction

- Timeline 展示 24 小时，可内部滚动、显示当前时间线；Course 在 Timeline 上只读。
- PlannerEvent 与 TimeBlock 可拖动、可调整大小。
- 停课、调课、换教室、补课必须走 Academic CourseOverride 流程，不直接拖改 Course occurrence。
- 冲突默认是 warning；允许用户明确选择仍然保存。

## 9. PersonalTask

核心字段：title、可选 due date/time、priority、可选 estimated duration、note、status。Task 可无 deadline；逾期不会自动顺延。一个 Task 可关联多个 TimeBlock，不限定为一个。

## 10. Diary

定位为本地优先、高隐私的每日个人记录，不是 Notes/PKM。UI 按天呈现每日长文本日记；Ethan 在 Phase 3 授权的实现契约明确，同一个本地日期最多一条 DiaryEntry。支持 autosave。DiaryEntry 不进入 Timeline。AI 读取 Diary 需要单独权限；全局 AI read permission 不隐含 Diary permission。

## 11. Inbox

仅限应用内。流程为 `Raw → Preserve Raw → Local Parse → Preview → User Confirm → Business Object`。本地解析优先，AI 仅可作为不确定时的可选辅助。模糊时间不得静默猜测或自动排期。首期可转换 PersonalTask、PlannerEvent，也可保留或删除；不得直接修改 Academic Course。

## 12. Weather / Context / Routine

- Weather 可提供 current/hourly/7-day/warning/cache 信息；失败不影响核心工作台。
- Context 尽可能本地、确定性地产生 INFO / SUGGESTION / WARNING，并进入最相关的 Timeline、Task、Notification、Morning Brief、AI context 或 Evening Review；不要求用户访问独立大页面。
- Routine 是软目标，只提供建议，不自动生成 Task 或占用时间。用户确认后才转成 PlannerEvent / TimeBlock；不在首页增加长期 Routine 大卡。

## 13. AI

OpenAI 优先，保留 provider-neutral 边界。AI 可选，不是核心应用启动依赖。API key 存 Windows secure credential storage，绝不进入 SQLite 或备份。写入流程必须为 `AI → AIToolRegistry → PermissionGate → Application UseCase`。AI 不得直接修改 Course、Exam Deadline、Task Deadline 或 Diary 正文；Diary 另需单独权限。所有 AI 建议必须 Preview、Revalidate、User Confirm 后再由 Application UseCase 执行。

## 14. Removed Features

- Quick Capture：REMOVED。
- Focus：REMOVED。
- 不恢复 global Quick Capture shortcut、floating capture、FocusSession、ActualActivity、Focus Timer 或 Planned-vs-Actual。

旧文档可保留历史事实；本 Brief 与当前 v2 Architecture Contract 优先于旧方向。

## 15. UI

Clean Minimal Desktop Workspace：清晰、安静、高信息密度、不拥挤、低视觉疲劳。避免大量渐变、高饱和卡片、AI 紫色发光、大量巨大圆角和复杂动画。主 Accent 继承现有 Academic 视觉；现有 `#2f7b68` 是历史事实，新增实现通过 Design Tokens，不散布 literal。未来主题为 Light / Dark / System。目标桌面尺寸：1920×1080、1600×900、1366×768；Dashboard 在这些尺寸保持一屏。

## 16. Technical / Data / Network Constraints

- 继续使用现有 Tauri 2 + React + TypeScript + Rust + SQLite 应用；不创建第二个 Academic DB。Links Workplace 2.0 是 clean-start release，不继承 NTU 1.x 用户数据库。
- 正式 v2 身份为 Product `Links Workplace`、Version `2.0.0`、Tauri identifier `com.links.workplace.desktop`；DB 文件名为 `courses.sqlite3`，GitHub repo / updater endpoint 保持不变。旧 `com.ntu-course-assistant.desktop` 仅为历史身份，不得扫描、复制或恢复。
- SQLite schema 为 8。新数据库创建为 schema 8，既有 schema 8 正常打开；任何已存在且 `user_version != 8` 的数据库只读拒绝且不得修改。2.0 不支持 schema 5/6/7 自动迁移或 1.x→2.0 自动升级。安装 2.0 前用户须自行卸载 1.x；旧数据不会自动恢复。未来 schema migration 必须单独审批。
- 不复制 WebView `localStorage`、缓存、AI 权限授权、临时状态或任何 secret。Keyring 凭据不导出、不复制。UI 不直连 DB，Workspace 不绕过 Application API 访问 Academic 内部表。
- Weather 可访问外部服务，但离线或服务故障不能破坏本地核心功能。AI 网络不可用不能妨碍 Academic、Planner、Tasks、Diary、Inbox、Timeline、Reminder 或本地 Search。
- AI key 必须放系统安全凭据存储，不入 DB、不入 backup。

## 17. Non-Goals for Initial v2

第三方 Plugin SDK / marketplace、Google Calendar、Outlook Calendar、Cloud Sync、Automation Rules、Quick Capture、Focus、第二套 Academic、重写 PDF parser 均不在初期范围。不得因旧规划文档自行重新引入已删除功能。

## 18. Acceptance / Delivery Boundaries

- v2 以明确的 Phase 指令逐步交付；当前文档不授权开始任何运行时实现。
- Academic 时间语义及历史稳定能力不得回退；应用核心在 AI、Weather 或网络不可用时仍可使用。
- Dashboard 的视口目标、导航、数据边界和失败隔离必须由后续相应阶段的自动测试及 Windows 11 Pro 人工验收验证。
- 自动化 PASS 不等同 Windows UI、安装器、Updater、通知、托盘或自启动人工验收 PASS。
- 2.0 clean-start 安装、卸载、自启动与 updater 必须分别通过 Windows 11 Pro E2E；不得暗中引入 1.x 自动迁移或安装升级。
