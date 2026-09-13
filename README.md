# NTU Course Assistant

面向大学生的 Windows 11 本地课程表与上课提醒程序，优先适配南通大学。

**Phase 6 PASS；Phase 4 已由用户取消。** 真实 PDF 可提取并识别为 15 条固定安排和 3 条非固定实践候选；用户修正并最终确认后，应用使用单个 SQLite 事务原子写入课程。运行中的 Windows 应用会在课程 due 时发送系统通知，并在应用重启或窗口恢复后重建提醒计划；完全退出时不提供后台提醒。设置中的“登录 Windows 后自动启动应用”默认关闭，启用后由 Windows 当前用户启动项运行，且重复启动只保留一个应用进程。

- [设计与数据模型](DESIGN.md)
- [阶段状态](PROJECT_STATUS.md)
- [Phase 0 检查、路线与验收计划](docs/phase-0.md)
- [Phase 2 验证](docs/phase-2-verification.md)
- [Phase 2.5 验证](docs/phase-2-5-verification.md)
- [Phase 2.6 验证](docs/phase-2-6-verification.md)
- [Phase 2.7 验证](docs/phase-2-7-verification.md)
- [Phase 3.1 验证](docs/phase-3-1-verification.md)
- [Phase 3.2 验证](docs/phase-3-2-verification.md)
- [Phase 3.3 验证](docs/phase-3-3-verification.md)
- [Phase 3.4 / Phase 3 总验收](docs/phase-3-4-verification.md)
- [Phase 5.1 验证记录](docs/phase-5-1-verification.md)
- [Phase 5.2 验证记录](docs/phase-5-2-verification.md)
- [Phase 5.3 验证记录](docs/phase-5-3-verification.md)
- [Phase 5.4 / Phase 5 总验收](docs/phase-5-4-verification.md)
- [Phase 6 验证记录](docs/phase-6-verification.md)
- [开发规则](CODEX.md)
- [变更记录](CHANGELOG.md)

建议技术栈：Tauri 2、React、TypeScript、Rust、Vite、npm；SQLite 在 Phase 2 接入。各依赖在实际进入对应阶段时选择兼容版本并锁定。

当前命令：

- `npm install`：安装锁定依赖。
- `npm run dev`：启动本机前端开发服务器。
- `npm run tauri dev`：启动真实 Tauri Windows 桌面窗口。
- `npm run build`：执行严格类型检查和 Vite 生产构建。
- `npm run verify`：执行 typecheck、单元测试、架构测试、315 个 UI 场景、lint、格式检查和 build。
- `npm run test:unit`、`npm run test:arch`、`npm run test:ui`、`npm run lint`、`npm run format:check`：分别运行对应检查。

Phase 2 的持久化 CRUD、故障恢复及原有时间轴已在 1280×800、1000×700、900×600 与 100%/125%/150% 设备缩放矩阵中验证；真实 Tauri 窗口另在本机 Windows 200% DPI 下从数据库不存在开始，完成自动建库、四轮启动以及添加、编辑、删除的 SQLite 恢复检查。浏览器测试没有替代 Desktop PASS。

本次已安装用户级 Rust，未修改持久 PATH；终端需将用户 `.cargo/bin` 加入当前会话 PATH 后调用 Cargo。本机 C++ 桌面工具及 Windows SDK 已通过实际编译验证。

详见 [真实 PDF 样本检查](docs/pdf-sample-review.md)、[Phase 1 验证](docs/phase-1-verification.md)、[Phase 2 验证](docs/phase-2-verification.md)、[Phase 2.5 验证](docs/phase-2-5-verification.md)、[Phase 2.6 验证](docs/phase-2-6-verification.md)、[Phase 2.7 验证](docs/phase-2-7-verification.md)、[Phase 3.1 验证](docs/phase-3-1-verification.md)、[Phase 3.2 验证](docs/phase-3-2-verification.md)、[Phase 3.3 验证](docs/phase-3-3-verification.md) 和 [Phase 3.4 / Phase 3 总验收](docs/phase-3-4-verification.md)。
