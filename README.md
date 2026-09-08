# NTU Course Assistant

面向大学生的 Windows 11 本地课程表与上课提醒程序，优先适配南通大学。

Phase 1.1 桌面空壳及 Phase 1.2 最小课程模型/时间计算已 PASS。当前停止等待确认 Phase 1.3；尚无正式课程表 UI 或安装包。

- [设计与数据模型](DESIGN.md)
- [阶段状态](PROJECT_STATUS.md)
- [Phase 0 检查、路线与验收计划](docs/phase-0.md)
- [开发规则](CODEX.md)
- [变更记录](CHANGELOG.md)

建议技术栈：Tauri 2、React、TypeScript、Rust、Vite、npm；SQLite 在 Phase 2 接入。各依赖在实际进入对应阶段时选择兼容版本并锁定。

当前命令：`npm install` 安装依赖；`npm run build` 执行类型检查和前端构建；`npm run dev` 启动本机前端预览。三者均已执行成功。

桌面命令 `npm run tauri dev` 已实际运行成功，可打开独立 Windows 窗口。`npm run verify` 包含 typecheck/build 和单元、架构测试；也可分别运行 `npm run test:unit` 与 `npm run test:arch`。尚无 lint 命令，核心边界由严格类型和 AST 测试检查。

本次已安装用户级 Rust，未修改持久 PATH；终端需将用户 `.cargo/bin` 加入当前会话 PATH 后调用 Cargo。本机 C++ 桌面工具及 Windows SDK 已通过实际编译验证。

详见 [真实 PDF 样本检查](docs/pdf-sample-review.md) 和 [Phase 1.1 验证](docs/phase-1-verification.md)。
