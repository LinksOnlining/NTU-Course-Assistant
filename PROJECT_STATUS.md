# 当前项目状态

- 最后更新：2026-09-23

## Links Workplace v2.0

- 当前开发分支：`v2/workspace-rebase`，从稳定 `main` commit `3f2d580d2423bdb19d2753023db6414b5408c546` 创建；`main` 继续代表稳定 1.x 基线。
- Phase 1.0 Read-Only Architecture Rebase Audit：COMPLETE。结论：当前无 router；Application boundary 部分存在；Academic occurrence resolver 是稳定核心；identifier 决定 AppData 路径；尚无完整 Design Tokens；schema 为 5；当前实现没有 migration 前备份。
- Phase 1.1 Architecture Contract & Project Baseline：COMPLETE。已建立项目规则、v2 产品需求 SSOT 和架构契约；没有开始运行时实现。
- v2 开发及主要人工验收环境：Windows 11 Pro。v1.3.1 的 Windows 10 安装态 ALL PASS 是历史验收事实，不代表在 Windows 11 已执行相同验收。
- 当前 v2 目标品牌为 Links Workplace；顶层导航 `[工作台] [课表]`；技术 identifier `com.ntu-course-assistant.desktop`、`courses.sqlite3`、GitHub repo/updater source 保持不变。Quick Capture 与 Focus 在当前规划中为 REMOVED。
- 下一阶段：Phase 1.2 Core Contracts / Navigation / Application Boundary Design；等待 Ethan / ChatGPT 的具体指令，不自动开始。

## 当前稳定版本：NTU Course Assistant v1.3.1

- 当前稳定版本：**NTU Course Assistant v1.3.1 — RELEASED**。
- GitHub Release：[v1.3.1](https://github.com/LinksOnlining/NTU-Course-Assistant/releases/tag/v1.3.1)；annotated tag 指向 `a2c1d7043ae65ff71d9ad154f0b53967b6dd0a0a`。`v1.3.0` 未修改。
- v1.3.1 时间事实：`startPeriod/endPeriod` 成对存在时，节次索引是课程时间的权威事实；课程实际时间始终由当前已确认的 `PeriodTime[]` 解析。两节次索引均为空时才使用固定钟点。旧 `startTime/endTime` 对节次课程仅为兼容快照，不得用于运行时回退；本次无 schema migration 或课程批量改写。
- 验证：本机 `npm run verify` PASS（132 unit、60 architecture、453 UI PASS，15 条件跳过）；Rust 40 tests、fmt、clippy PASS；当前 HEAD 的 Tauri production build、NSIS/MSI 及 updater signatures PASS。GitHub main CI、tag CI 与 Release workflow 均 PASS。
- Windows 10 安装态最终人工验收由 Ethan 确认 **ALL PASS**：作息修改即时影响按节次课程；固定钟点课程不变；换教室、明确调课、停课语义保持正确；Schedule、Today、Widget、Reminder 和重启恢复一致。
- Updater：公开 `latest.json` 为 1.3.1；NSIS/MSI 签名文件与 metadata 一致，且两份 GitHub installer 均通过当前 updater public key 的 Minisign 验证。**v1.3.0 安装态升级到 v1.3.1 的真实 updater E2E 未执行，状态 BLOCKED / 未验证**；不得据此宣称跨版本自动升级 PASS。
- SQLite schema：5。已知限制：应用完全退出后不提供后台提醒；未进行 Windows Authenticode 商业代码签名。
- 1.x 进入稳定维护，仅修复真实 bug，不主动增加功能。v2 runtime implementation 尚未开始。
- 详细发布与回归记录：`docs/v1.3.1-verification.md`。
