# 保存系统重构验证记录

## 范围

本次修复覆盖两个相互关联的真实故障链路：

- PDF 导入确认写入课程后，后续小组件/作息保存可能长期显示“保存中”；
- 新增或编辑作息后，保存可能失败、卡住，且失败后不能可靠重试。

本次不修改课程模型、提醒业务、Widget 持久化契约或 SQLite schema；`PRAGMA user_version` 仍为 `4`。

## 根因判断

旧实现把一个已打开的 `CourseDatabase` 放在进程级 `Arc<Mutex<...>>` 中。所有存储命令共享同一连接和锁；当 PDF 导入后的刷新链路、同步读取或失败命令留下运行时占用时，后续命令只能等待这个进程级 guard。前端 `invokeWithTimeout` 只让 UI 的 Promise 先返回，并不会取消仍在 Rust 侧运行的命令，因而会掩盖而不是释放资源。

这解释了“结束进程后恢复”的现象：持久化课程数据仍然存在，重启只是清除了 process-local connection/guard/pending 状态。

## 新的保存边界

1. 启动阶段只完成一次数据库初始化/迁移，然后在 `CourseState` 中保存数据库路径，不保存进程级连接或 Mutex。
2. 每个课程、作息、应用设置、Widget 设置和读取命令都在 `spawn_blocking` 中创建独立的短生命周期 SQLite 连接。
3. 事务、回读和校验在同一条命令内完成；命令返回前显式释放连接，窗口 API、提醒刷新和前端状态更新不在数据库 guard 内执行。
4. 前端保存状态为 `idle → validating → saving → success/error`。成功、失败和校验异常都会离开 saving；错误状态保留可重试入口，重复点击会被忽略。
5. 移除前端 `invokeWithTimeout`，避免出现“前端已超时但后端仍持锁运行”的未取消操作。SQLite 连接使用现有 3 秒 busy timeout；真实错误仍返回 UI，不伪造成功。

## PDF 导入关系

PDF 文件选择器和 `import_courses` 仍使用独立的 Tauri 命令。导入事务成功后，后续刷新读取使用新的短连接；前端导入状态仍在 `finally` 中释放。这样导入结束不会把连接、锁或同步读取留在进程级共享状态中，也不会让后续作息/Widget 保存依赖导入命令的旧运行时状态。

## 自动验证

已执行：

- `npm run verify`：通过；112 项 unit、50 项 architecture、441 个 UI 场景中 426 通过、15 项按设备/私有样本条件跳过；lint、Prettier、生产前端 build 均通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：37 passed、0 failed。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：通过。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`：通过。
- `npm run tauri -- build`：通过；使用当前工作区代码生成了 NSIS、MSI 及各自 updater `.sig`。

本次生产构建产物（均位于被忽略的 `src-tauri/target/release`）：

- `NTU Course Assistant_1.2.1_x64-setup.exe`（51,949,254 bytes，SHA-256 `FBAE82122860A711CEAD9E417F11616B6B5F8687C4FB27E23ECC6B68751E86AB`）及其 `.sig`（436 bytes）；
- `NTU Course Assistant_1.2.1_x64_en-US.msi`（54,853,632 bytes，SHA-256 `02EFE4C56CA31EEEED246EB2F83DF792FE809DBAB475463DDBB998AA93995632`）及其 `.sig`（436 bytes）。
- 未打包的 release EXE 元数据为 `ProductVersion=1.2.1`、`FileVersion=1.2.1`。

`.sig` 与安装包在本次构建窗口内生成，未将签名内容或私钥写入仓库。

## GitHub v1.2.1 发布产物

Release workflow `35608176021` 已成功完成，GitHub Draft Release 已核验后发布为：

- Release：<https://github.com/LinksOnlining/NTU-Course-Assistant/releases/tag/v1.2.1>
- Tag：`v1.2.1`，指向提交 `6b34024889d9e271062a3f736e2022190a8cb57f`；
- `latest.json`：版本 `1.2.1`，包含 `windows-x86_64`、`windows-x86_64-nsis`、`windows-x86_64-msi` 三个平台条目；
- GitHub NSIS：`NTU.Course.Assistant_1.2.1_x64-setup.exe`，51,952,353 bytes，SHA-256 `892EE4CEE70D557FEB473E1B94A5A42C7F029F7A77E787759D666F56F6AD5230`；
- GitHub NSIS 签名：436 bytes，SHA-256 `A1614653CB44E809E6423CF6032D2420F19A8CB04CFE1F18EDA2CA8BBE046655`；
- GitHub MSI：`NTU.Course.Assistant_1.2.1_x64_en-US.msi`，53,673,984 bytes，SHA-256 `E695AAB975371E5FDE4298DD8EB925EF52D0B25E9547CE5EFB9BAD595E9C3BEC`；
- GitHub MSI 签名：436 bytes，SHA-256 `36B7BF740A28E9E0BF7E28AE717B95B1029526F9320FE143B064E4252C8B7584`；
- GitHub `latest.json` SHA-256：`A13EB9A4B8F3B44658EBB2C9D787337BCFEC4CCD51E37F8A3BDC3426B09CCC3D`。

以上哈希来自发布页实际下载的 GitHub 产物；私钥、密码和签名内容未写入仓库或文档。

新增/强化覆盖：

- 多次使用新连接保存已有和新增作息，验证连接释放后仍可回读；
- 新增作息、编辑时间、保存后重新打开设置并核对值；
- 保存失败后按钮恢复可用，第二次保存可以成功；
- PDF dialog 在设置写入 pending/失败时仍保持响应；
- 架构测试禁止回到进程级数据库 Mutex 或前端未取消超时包装。

## Windows 10 人工验收

状态：**PASS（Ethan 已完成真实 Windows 10 安装态人工验收；本环境未使用 Computer Use 代替人工验收）。**

请使用最新生产构建，按以下最小顺序记录真实结果：

1. 启动并打开 Widget；
2. 完成一次真实 PDF 导入确认；
3. 保存 Widget 设置，确认 Widget 仍渲染且按钮可操作；
4. 保存作息，确认不再长期“保存中”；
5. 连续再次保存 Widget/作息；
6. 保存后立即打开 PDF 文件选择器；
7. Widget show/hide 多轮；
8. 失败保存后重试；
9. Tray 恢复主窗口、单实例、测试提醒和真正退出；
10. 重启后核对课程、作息和 Widget 状态。

Ethan 已确认上述 PDF 导入、Widget/作息保存、连续保存、失败重试、文件选择器、Widget 生命周期、Tray、单实例、提醒、真正退出和重启恢复场景均通过。

## 已知限制

自动化 UI 使用浏览器环境时会输出 Widget 原生 bounds API 不可用的 warning；这是测试适配提示，不代表 Tauri 安装态白屏。真实 Windows 10 安装态仍是本次保存系统重构的最终证据。
