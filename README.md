# NTU Course Assistant

面向大学生的 Windows 11 本地课程表与上课提醒程序，优先适配南通大学。

Phase 0 已完成；用户已确认继续 Phase 1。Phase 1.1 工程空壳已通过实际 Windows 桌面启动与 HMR 验证，当前停止等待确认 Phase 1.2。尚无课程表功能或安装包。

- [设计与数据模型](DESIGN.md)
- [阶段状态](PROJECT_STATUS.md)
- [Phase 0 检查、路线与验收计划](docs/phase-0.md)
- [开发规则](CODEX.md)
- [变更记录](CHANGELOG.md)

建议技术栈：Tauri 2、React、TypeScript、Rust、Vite、npm；SQLite 在 Phase 2 接入。各依赖在实际进入对应阶段时选择兼容版本并锁定。

当前命令：`npm install` 安装依赖；`npm run build` 执行类型检查和前端构建；`npm run dev` 启动本机前端预览。三者均已执行成功。

桌面命令 `npm run tauri dev` 已实际运行成功，可打开独立 Windows 窗口。当前没有完整 verify/lint/test 命令，须随本阶段后续小步骤加入，不能把空壳构建当成阶段完成。

本次已安装用户级 Rust，未修改持久 PATH；终端需将用户 `.cargo/bin` 加入当前会话 PATH 后调用 Cargo。本机 C++ 桌面工具及 Windows SDK 已通过实际编译验证。

详见 [真实 PDF 样本检查](docs/pdf-sample-review.md) 和 [Phase 1.1 验证](docs/phase-1-verification.md)。
