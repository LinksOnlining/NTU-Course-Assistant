# Phase 5.2 — Windows Integration & Installer Upgrade

更新日期：2026-09-28

分支：`v2/workspace-rebase`

基线 HEAD：`ed0a98f9b94e3825721b9c61c687a3fcdea357a8`

状态：**BLOCKED / NOT COMPLETE**

## 状态摘要

| 项目 | 状态 | 证据 / 限制 |
|---|---|---|
| 合成 schema 5–8 迁移测试 | PASS | Sentinel 字段保留；source、staging target、backup 均执行 SQLite `integrity_check` |
| Windows Autostart 代码审计 | PARTIAL | 官方 Tauri plugin 2.5.1；界面读取真实系统状态，安装默认不启用；未做登录态实测 |
| MSI UpgradeCode 连续性 | PASS（静态） | 当前 WiX UpgradeCode 固定为旧 v1.3.x MSI 的 UpgradeCode；当前 MSI Property 与 Upgrade 表一致 |
| NSIS fresh / upgrade / uninstall / reinstall | PENDING | 无隔离 Windows VM/Sandbox，未运行安装器 |
| MSI fresh / upgrade / uninstall / reinstall | PENDING | 静态元数据不构成安装升级验收 |
| Autostart enable / disable / login / uninstall cleanup | PENDING | 未修改宿主注册表或运行安装态程序 |
| 真实用户数据库 | NOT EXECUTED | 仅确认旧路径文件存在；未读取、复制、写入、迁移或激活 |
| Updater E2E / Phase 5.3 | NOT STARTED | 本阶段明确不执行 |

## Installer identity 审计

- 新产品身份：`Links Workplace` / `2.0.0` / `com.links.workplace.desktop` / `links-workplace.exe`。
- v1.3.0 与 v1.3.1 官方 MSI 的 UpgradeCode 均为 `{2F689303-B82C-571D-BCD4-3DDF71E745AF}`；当前 2.0.0 MSI 原先会因 ProductName 派生出新的 UpgradeCode。
- `src-tauri/tauri.conf.json` 现显式固定上述既有 UpgradeCode。当前 MSI 只读表审计得到 `ProductName=Links Workplace`、`ProductVersion=2.0.0`、UpgradeCode 与 Upgrade 表均匹配旧产品线；新 ProductCode 为 `{F96F27CE-A94C-4A22-B565-7D04B0305E19}`。
- 这只能证明 MSI 元数据声明同一升级产品线，**不证明** Windows Installer 的 major-upgrade 实际成功、旧快捷方式/卸载项清理正确或数据得到保留。
- NSIS 的当前生成脚本包含当前产品名 Run 项的卸载清理；没有验证旧 `NTU Course Assistant` Run 项如何随 1.x→2.0 安装处理。MSI 当前未见对应的 RemoveRegistry 清理表。需在隔离环境确认并修正后才能判断卸载行为。
- 当前不能基于静态检查决定最终 NSIS/MSI 发布等级；NSIS 是优先候选，MSI 暂列次选候选，二者均等待实际 E2E。

## Autostart 审计

- 实现仍使用官方 `tauri-plugin-autostart` 2.5.1，通过现有服务调用 `isEnabled` / `enable` / `disable`；设置加载和切换后都会读取实际系统状态，不是仅保存应用内偏好。
- 插件 Windows 后端基于当前用户 Run 注册项；程序启动不主动调用 enable，UI 默认值来自系统实际状态，因此“安装后保持 OFF”在代码路径上成立，但尚未通过 fresh install/登录会话验收。
- 插件默认注册项名称来源于 Tauri `package_info().name`。v1.x 与 Links Workplace 的产品身份名称不同；遗留名称 Run 项迁移、重复项和卸载清理必须通过隔离升级/卸载测试验证。不要清理其他未知启动项。
- 当前 NSIS 生成脚本仅显示清理当前 `${PRODUCTNAME}` 对应的 HKCU Run 值；旧产品值与 MSI 卸载清理仍是未验证风险。

## 合成数据与迁移覆盖

迁移测试使用完全虚构的 schema 5、6、7、8 数据库。课程、个人任务、日记、Inbox、Routine 的正文包含明确 `*_MIGRATION_SENTINEL` 标记。测试验证迁移目标实体数量及适用的 sentinel 保留，同时对源数据库、迁移目标和备份分别执行 SQLite `integrity_check`。目标数据仍在测试临时目录内；测试没有引用用户数据库。

针对性 Rust 迁移测试：8 passed，1 ignored。完整 Rust 测试：113 passed，2 ignored。Ignored 项未作为通过证据。

## 外部旧安装包核验

从既有公开 Release 获取的 v1.3.0/v1.3.1 NSIS 与 MSI 均只做下载和 SHA-256 核对，**没有执行**。文件位于仓库外临时目录；旧资产身份及哈希与 [v1.3.0](https://github.com/LinksOnlining/NTU-Course-Assistant/releases/expanded_assets/v1.3.0) / [v1.3.1](https://github.com/LinksOnlining/NTU-Course-Assistant/releases/expanded_assets/v1.3.1) GitHub Release 资产列表一致：

| 版本 | Installer | 大小 | SHA-256 |
|---|---|---:|---|
| 1.3.0 | NSIS | 51,992,445 | `80ABE30CAEC082157D97C719C72934823432D004D5B97F118DC53A15EC6778B2` |
| 1.3.0 | MSI | 53,841,920 | `C084AB0D3B03D3C618EEC1AE6BF52DC4C751C0E9844877021156F5A4A7848D11` |
| 1.3.1 | NSIS | 52,042,158 | `D7C9E691A8AA3D60695CD3DF126CF75EDE13CA0F2DC49B40735FCBF860E6FF5D` |
| 1.3.1 | MSI | 53,833,728 | `ADBD54D427AB71FD1CEA93897A18E00EB1EF6175972A42A792A0B81485EF42DC` |

## 本地验证与产物

- `npm run typecheck`：PASS。
- `npm run verify`：PASS；unit 378、architecture 141、Playwright UI 1,155 passed / 15 skipped / 0 failed；typecheck、lint、Prettier 与前端 build 均通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：113 passed、2 ignored、0 failed。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：PASS。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`：PASS。
- `npm run tauri build`：PASS；实际生成下列测试构建资产。构建输出中的 Rust linker diagnostics 与 Vite 大 chunk 提示为 warning，构建退出码为 0。

| 产物 | 大小（bytes） | SHA-256 | UTC 修改时间 |
|---|---:|---|---|
| `links-workplace.exe` | 68,404,736 | `9DE5D576162A97F957F17C84DDF52C3FFF9F4B9FF561832B6EC6B80465F91E40` | 2026-09-28 07:25:52 |
| `Links Workplace_2.0.0_x64_en-US.msi` | 54,525,952 | `4C6E62EC46DFC3332C7F7DEEAB8B432E02CD43796F7FBDF298B22FFE5EC78DA5` | 2026-09-28 07:25:26 |
| `Links Workplace_2.0.0_x64_en-US.msi.sig` | 428 | `CAE21B41CEA77642E09EF397BCFC5697EC92AA7DE0D05EA524F7B49DC2F5AC8A` | 2026-09-28 07:25:52 |
| `Links Workplace_2.0.0_x64-setup.exe` | 52,464,435 | `F3438969BF49EDC72E2EB4BBA9E6EBE1033D83B43652C0E166930A0A1DD5214E` | 2026-09-28 07:25:52 |
| `Links Workplace_2.0.0_x64-setup.exe.sig` | 428 | `816414334B9885DCF62B8F967D4CB6C2F860EDFB8321C77334C31F3ABC49A5E0` | 2026-09-28 07:25:52 |

签名文件由本次成功的 Tauri bundle 构建生成；未记录或显示签名私钥。产物仅在 `src-tauri/target`，不得提交或发布。

## 隔离环境阻塞与安全边界

当前 Windows 主机没有可用的 Windows Sandbox 可执行文件或已配置的 Hyper-V/VMware/VirtualBox/Docker Windows 隔离环境。启用 Windows Sandbox/可选 Windows 功能需要管理员操作；本阶段没有尝试更改系统功能。WSL 不能替代真实 Windows Installer 与登录自启动验收。

宿主存在旧 identifier 数据文件；只检查了目标文件是否存在，没有读取数据库内容，也没有执行新旧程序或 installer。因此所有安装、迁移激活、用户数据恢复、快捷方式、卸载、自启动、凭据、窗口行为和启动流程验收仍为 **PENDING**。

继续条件：Ethan 提供/启用一个干净的 Windows Sandbox 或隔离 Windows VM，再在该隔离环境内依次运行 fresh install、v1.3.0/v1.3.1 NSIS 升级、MSI fresh/upgrade、卸载重装、自启动 enable/disable/login 与 synthetic migration E2E。不得改用真实宿主用户数据库。

## 最终状态

- Phase 5.1：COMPLETE。
- Phase 5.2 Implementation：PENDING（静态与自动部分完成；installer/autostart cleanup 的完整实现与实测未完成）。
- Phase 5.2 Automated：PASS（代码级门禁）。
- NSIS fresh / 1.3.0 upgrade / 1.3.1 upgrade：PENDING。
- MSI fresh / upgrade：PENDING。
- Autostart Automated / Windows Manual：PENDING。
- Synthetic Installer Migration E2E：PENDING；仅迁移逻辑自动测试通过。
- Real User Data Activation：NOT EXECUTED。
- Updater E2E：NOT STARTED。
- Phase 5.3：NOT STARTED。
- Push / tag / Release：NO。
