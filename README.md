# NTU Course Assistant

面向大学生的 Windows 11 本地课程表与上课提醒程序，优先适配南通大学。

当前仅完成 Phase 0 检查和设计，没有应用代码、安装包或可运行命令。未经用户确认不得进入 Phase 1。

- [设计与数据模型](DESIGN.md)
- [阶段状态](PROJECT_STATUS.md)
- [Phase 0 检查、路线与验收计划](docs/phase-0.md)
- [开发规则](CODEX.md)
- [变更记录](CHANGELOG.md)

建议技术栈：Tauri 2、React、TypeScript、Rust、Vite、npm；SQLite 在 Phase 2 接入。各依赖在实际进入对应阶段时选择兼容版本并锁定。

安装、运行、构建说明将在 Phase 1 实际验证后补充。当前不能执行 npm run verify 或运行桌面程序。
