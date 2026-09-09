# NTU Course Assistant

面向大学生的 Windows 11 本地课程表与上课提醒程序，优先适配南通大学。

**Phase 2.7 PASS。** Phase 2 的本地课程 CRUD、SQLite 持久化和可配置作息保持通过；桌面时间轴将节次与完整时间段分层显示，课程与节次继续按真实分钟位置对齐。课程区采用无内部网格的留白，并保留短课程的名称、时间、教室和教师，通过自适应字号适配，不改变真实高度；当前仍使用明确标注的 test-only 作息，正式南通大学作息尚未配置。

- [设计与数据模型](DESIGN.md)
- [阶段状态](PROJECT_STATUS.md)
- [Phase 0 检查、路线与验收计划](docs/phase-0.md)
- [Phase 2 验证](docs/phase-2-verification.md)
- [Phase 2.5 验证](docs/phase-2-5-verification.md)
- [Phase 2.6 验证](docs/phase-2-6-verification.md)
- [Phase 2.7 验证](docs/phase-2-7-verification.md)
- [开发规则](CODEX.md)
- [变更记录](CHANGELOG.md)

建议技术栈：Tauri 2、React、TypeScript、Rust、Vite、npm；SQLite 在 Phase 2 接入。各依赖在实际进入对应阶段时选择兼容版本并锁定。

当前命令：

- `npm install`：安装锁定依赖。
- `npm run dev`：启动本机前端开发服务器。
- `npm run tauri dev`：启动真实 Tauri Windows 桌面窗口。
- `npm run build`：执行严格类型检查和 Vite 生产构建。
- `npm run verify`：执行 typecheck、单元测试、架构测试、261 个 UI 场景、lint、格式检查和 build。
- `npm run test:unit`、`npm run test:arch`、`npm run test:ui`、`npm run lint`、`npm run format:check`：分别运行对应检查。

Phase 2 的持久化 CRUD、故障恢复及原有时间轴已在 1280×800、1000×700、900×600 与 100%/125%/150% 设备缩放矩阵中验证；真实 Tauri 窗口另在本机 Windows 200% DPI 下从数据库不存在开始，完成自动建库、四轮启动以及添加、编辑、删除的 SQLite 恢复检查。浏览器测试没有替代 Desktop PASS。

本次已安装用户级 Rust，未修改持久 PATH；终端需将用户 `.cargo/bin` 加入当前会话 PATH 后调用 Cargo。本机 C++ 桌面工具及 Windows SDK 已通过实际编译验证。

详见 [真实 PDF 样本检查](docs/pdf-sample-review.md)、[Phase 1 验证](docs/phase-1-verification.md)、[Phase 2 验证](docs/phase-2-verification.md)、[Phase 2.5 验证](docs/phase-2-5-verification.md)、[Phase 2.6 验证](docs/phase-2-6-verification.md) 和 [Phase 2.7 验证](docs/phase-2-7-verification.md)。Phase 2.7 完成后停止等待确认，不进入 Phase 3。
