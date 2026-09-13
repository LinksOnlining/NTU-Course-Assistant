# Phase 10 验证记录

## 状态

**PASS**（2026-09-13）。Version 1.0 Release Candidate 已准备完成；没有创建 Git tag、远端 push 或 GitHub Release。

## 发布整理

- 产品名为 `NTU Course Assistant`，`package.json`、`src-tauri/tauri.conf.json`、`Cargo.toml` 和 Windows EXE metadata 均为版本 `1.0.0`。
- 正式应用图标、真实 multi-resolution ICO 与 Tray 图标保持既有 bundle 配置；identifier 保持 `com.ntu-course-assistant.desktop`，避免改变用户数据路径。
- 生产界面不显示 fixture、原型或测试数据标签；实际作息未保存时明确提示用户在设置中确认，不把测试作息表述为学校正式作息。
- README 已改为使用说明，MIT LICENSE 已加入；`.gitignore` 保护数据库、PDF、日志和临时文件。tracked 文件扫描未发现姓名、学号、邮箱、密钥、令牌、Cookie、会话、用户数据库或真实 PDF。

## 自动验证

- `npm run verify` PASS：107 项 TypeScript 单元测试、44 项架构测试、327 个 UI 场景通过；15 个依赖设备或私有样本的场景按既有条件跳过。typecheck、oxlint、Prettier 与生产 Vite build 均通过。
- `cargo test` PASS：33 项 Rust 测试通过。
- `cargo fmt -- --check` PASS；`cargo clippy --all-targets -- -D warnings` PASS。
- 既有 fresh DB、schema 4 和 future schema 拒绝测试由 Rust 数据库测试覆盖，本阶段没有新增 migration。

## RC 构建产物

| 产物 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| `ntu-course-assistant.exe` | 15,273,472 | `1B9D0085A2CBB1792CCD638218E6376FBDF9524C0154FEC9969AB0E3EA91EB7B` |
| `NTU Course Assistant_1.0.0_x64_en-US.msi` | 7,200,768 | `D4C48C05FA8819A024B36AFD9DA8A61F30B0BB4BBEA6F4F58B8C8B9C204D035A` |
| `NTU Course Assistant_1.0.0_x64-setup.exe` | 4,750,714 | `103583168ABDD66CD1DC54BF05AD318279E466E61BA9938A2446AA56DCF8471C` |

`npm run tauri build` PASS，生成 release EXE、MSI 与 NSIS 安装包。

## 安装态验收

- NSIS 卸载移除了安装目录中的 EXE 和 Start Menu 快捷方式，未删除用户级应用数据目录。
- 重新安装 RC 后，EXE 和 Start Menu 快捷方式均恢复；安装态 EXE 成功启动，进程数为 1，不依赖 localhost。
- 当前进程 5 秒空闲采样 CPU 增量为 0 秒，工作集约 41.4 MiB；未观察到持续 CPU 活动。
- Tray、Widget、提醒、真正退出和 single-instance 的人工验收沿用 Phase 8 与 Phase 9 已通过记录；本阶段发布配置没有改动这些生命周期实现。

## 已知限制

- Windows 11 是主要目标平台。
- PDF 导入仅支持已验证的南通大学文字型课表结构；扫描版 PDF 不支持。
- 小组件为底层桌面式窗口，不嵌入 Windows 壁纸；双显示器移除和 DPI 切换仍保留既有自动 fallback 覆盖的 documented limitation。
- 完全退出应用后不会发送提醒；未实现云同步、自动更新或教务系统直接导入。

## 后续

下一阶段为 **Phase 11 — GitHub Repository / CI / Release**，等待用户确认。
