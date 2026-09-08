# 项目状态

- 最后更新：2026-09-09
- 当前阶段：Phase 1.1 PASS（最小桌面空壳）。Phase 1 整体尚未完成。
- 阶段门禁：停止等待用户确认，不进入 Phase 1.2。
- 本轮修复：Vite 明确忽略 src-tauri/target、所有 target、src-tauri/gen、node_modules、dist、.git、.local；保留 src 监听和 React HMR。补齐 Windows 编译必需的 icon.ico/icon.png。
- 验证 PASS：npm run build；npm run tauri dev 的 Rust 编译完成并启动独立 ntu-course-assistant.exe；Computer Use 核对真实窗口及内容；同一桌面窗口内 App.tsx HMR 修改和恢复；实际 watcher 目录检查；Rust fmt。
- EBUSY：此次编译、运行及两次热更新未再出现 target DLL 锁定导致的 Vite 崩溃。
- 工具链：本机 MSVC/SDK 已可成功链接，之前 link.exe 缺失问题已解决。Rust 1.98.1 MSVC；Cargo.lock 已生成并纳入工程。
- 已知非阻断项：Rust 将 MSVC 的“正在创建库/对象”标准输出列为 linker_messages warning，编译和运行成功。未关闭该警告。
- 尚未实现：Course 模型、时间轴课程表、CRUD、存储、PDF 导入、教务导入、提醒、自启动；不把空壳 PASS 当成产品功能完成。
- PDF：已有真实样本检查，15 条固定安排和 3 条非固定实践课程，详见 docs/pdf-sample-review.md。原件及截图不入 Git；实际钟点和学期起点仍需确认。
- 下一步：用户确认后才开始 Phase 1.2。当前停止。
- 文档和验证依据：docs/phase-1-verification.md。
- Git：本阶段稳定检查后本地提交；提交号以 git log -1 为准，不推送远端。

继续前阅读 CODEX.md、DESIGN.md 和验证记录，勿重复安装工具链或重做已通过的样本检查。
