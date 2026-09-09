# NTU Course Assistant

面向大学生的 Windows 11 本地课程表与上课提醒程序，优先适配南通大学。

**Phase 2.3 PASS。** 当前可在 Windows 11 独立运行，并能添加、编辑、删除和持久化用户课程。数据通过受限 Tauri command 写入 Windows 用户应用数据目录中的 SQLite；正常关闭和重新启动后，添加与编辑结果保留，删除结果也保持。fixture 只在开发模式显示且不会写入数据库。

- [设计与数据模型](DESIGN.md)
- [阶段状态](PROJECT_STATUS.md)
- [Phase 0 检查、路线与验收计划](docs/phase-0.md)
- [Phase 2 验证](docs/phase-2-verification.md)
- [开发规则](CODEX.md)
- [变更记录](CHANGELOG.md)

建议技术栈：Tauri 2、React、TypeScript、Rust、Vite、npm；SQLite 在 Phase 2 接入。各依赖在实际进入对应阶段时选择兼容版本并锁定。

当前命令：

- `npm install`：安装锁定依赖。
- `npm run dev`：启动本机前端开发服务器。
- `npm run tauri dev`：启动真实 Tauri Windows 桌面窗口。
- `npm run build`：执行严格类型检查和 Vite 生产构建。
- `npm run verify`：执行 typecheck、单元测试、架构测试、81 个 UI 场景、lint、格式检查和 build。
- `npm run test:unit`、`npm run test:arch`、`npm run test:ui`、`npm run lint`、`npm run format:check`：分别运行对应检查。

Phase 2.3 的持久化 CRUD 及原有时间轴已在 1280×800、1000×700、900×600 与 100%/125%/150% 设备缩放矩阵中验证；真实 Tauri 窗口另在本机 Windows 200% DPI 下完成四轮启动以及添加、编辑、删除的 SQLite 恢复检查。浏览器测试没有替代 Desktop PASS。

本次已安装用户级 Rust，未修改持久 PATH；终端需将用户 `.cargo/bin` 加入当前会话 PATH 后调用 Cargo。本机 C++ 桌面工具及 Windows SDK 已通过实际编译验证。

详见 [真实 PDF 样本检查](docs/pdf-sample-review.md)、[Phase 1 验证](docs/phase-1-verification.md) 和 [Phase 2 验证](docs/phase-2-verification.md)。Phase 2.3 完成后停止等待确认，不进入 Phase 2.4。
