# 当前项目状态

- 最后更新：2026-09-23
- 当前稳定版本：**NTU Course Assistant v1.3.1 — RELEASED**。
- GitHub Release：[v1.3.1](https://github.com/LinksOnlining/NTU-Course-Assistant/releases/tag/v1.3.1)；annotated tag 指向 `a2c1d7043ae65ff71d9ad154f0b53967b6dd0a0a`。`v1.3.0` 未修改。
- v1.3.1 时间事实：`startPeriod/endPeriod` 成对存在时，节次索引是课程时间的权威事实；课程实际时间始终由当前已确认的 `PeriodTime[]` 解析。两节次索引均为空时才使用固定钟点。旧 `startTime/endTime` 对节次课程仅为兼容快照，不得用于运行时回退；本次无 schema migration 或课程批量改写。
- 验证：本机 `npm run verify` PASS（132 unit、60 architecture、453 UI PASS，15 条件跳过）；Rust 40 tests、fmt、clippy PASS；当前 HEAD 的 Tauri production build、NSIS/MSI 及 updater signatures PASS。GitHub main CI、tag CI 与 Release workflow 均 PASS。
- Windows 10 安装态最终人工验收由 Ethan 确认 **ALL PASS**：作息修改即时影响按节次课程；固定钟点课程不变；换教室、明确调课、停课语义保持正确；Schedule、Today、Widget、Reminder 和重启恢复一致。
- Updater：公开 `latest.json` 为 1.3.1；NSIS/MSI 签名文件与 metadata 一致，且两份 GitHub installer 均通过当前 updater public key 的 Minisign 验证。**v1.3.0 安装态升级到 v1.3.1 的真实 updater E2E 未执行，状态 BLOCKED / 未验证**；不得据此宣称跨版本自动升级 PASS。
- SQLite schema：5。已知限制：应用完全退出后不提供后台提醒；未进行 Windows Authenticode 商业代码签名。
- 1.x 进入稳定维护，仅修复真实 bug，不主动增加功能。下一步为 **Links Workplace v2.0 — Phase 1 Workspace Architecture Rebase**，尚未开始，等待 Ethan 单独启动。
- 详细发布与回归记录：`docs/v1.3.1-verification.md`。
