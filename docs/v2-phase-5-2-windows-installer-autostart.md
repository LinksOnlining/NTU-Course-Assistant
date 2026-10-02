# Phase 5.2 — Windows Integration & Installer Upgrade

## 当前有效状态（2026-10-03）

缺陷复现基线：`0185cd722c1c072730190a716a4376e4c22ecbcb`；Phase 5.2：**IN PROGRESS — MSI cleanup defect confirmed; fixed candidate build PASS; admin cleanup validation PENDING**。

### 封板与用户接受的覆盖缺口

- MSI-S04-R1：**PASS，保持封板**。official 1.3.0 MSI → Links Workplace 2.0 MSI：旧产品清理、schema 5→8、backup、marker、源不变、Launch 1 与 Launch 2/3 NO MIGRATION 均通过。只引用 immutable result，不要求 S04 当前 AppData / marker / archive 存在。
- S04 证据：`<ReleaseTest>/Phase-5-2/results/LinYu-E2E/MSI-S04-R1/MSI-S04-R1-result-20260930-204654-565.json`。
- **MSI-S05 / official v1.3.1 MSI → 2.0 MSI：DEFERRED / NOT TESTED — USER ACCEPTED**。harness around S04 archive/S05 preparation remained unstable；candidate executed=FALSE；product defect=NOT ESTABLISHED；不重跑。
- **MSI reinstall 矩阵：DEFERRED / NOT TESTED — USER ACCEPTED**。这是独立 uninstall→reinstall 场景；该 harness 只有 preflight / selftest / validate 日志，没有属于该矩阵的 execution directory 或 uninstall/reinstall MSI log，因此该矩阵的 uninstall executed=FALSE、reinstall executed=FALSE。此结论只表示 reinstall 矩阵没有建立缺陷；后续独立 cleanup scenario 真正执行了 0185 MSI uninstall，并发现下方单独记录的自启动产品缺陷。
- MSI reinstall 延期证据：`<ReleaseTest>/Phase-5-2/results/LinYu-E2E/MSI-REINSTALL/MSI-REINSTALL-USER-ACCEPTED-DEFER-20260930-223613-807.json`。

### 2026-09-30：真实 MSI uninstall 自启动清理缺陷

- 0185 基线的 MSI 卸载真实执行成功（ProductCode `{1D6E34AF-C879-4912-885A-C099017292B3}`，`msiexec /x` exit 0，日志显示 Removal completed successfully），但独立测试随后观察到自启动仍存在：`MSI_UNINSTALL_AUTOSTART_REMAINS`。不可变结果：`D:\AI_Workspace\ReleaseTest\Phase-5-2\scenario-local\c7d3dfbf8fec4be9b274db5fc7b0f99a\cleanup-execution\result.json`；原始 MSI 日志：同目录 `msi-uninstall.log`。
- 判定：**PRODUCT DEFECT = CONFIRMED**，不是 harness false positive。测试在卸载前用官方 auto-launch Windows backend 注册了当前安装 EXE，卸载后检查精确 Run value；结果的 `testRegistrationReverted=true` 表明 harness `finally` 只在数据 `Trim()` 后等于它创建的目标路径时才移除残留，因此注册确属 Links Workplace。结果 JSON 未保留 registry 的原始 value bytes/text；目标路径由测试输入及 installed EXE / shortcut 证据确认是 `C:\Program Files\Links Workplace\links-workplace.exe`，不伪称保存了原始 value data。
- Backend：Tauri autostart plugin 2.5.1 → `auto-launch` 0.5.0；测试针对 HKCU `Software\Microsoft\Windows\CurrentVersion\Run` 的精确 value name `Links Workplace`。独立 backend readback 记录其数据在去除尾空白后指向安装 EXE。旧测试 finally 已回滚自己创建的值；本次只读复核时当前 Run / Startup / Task Scheduler 中没有残留的 Links/NTU 自动启动项，已卸载 MSI 的 ARP/EXE 也不存在。没有启动应用、读取 active AppData、真实 DB 或 REAL_HOLD。
- 根因：应用运行时由 autostart plugin 写入 HKCU Run；0185 的 MSI WiX 中没有对应的 uninstall action，Windows Installer 不会自动清理由应用运行时创建的 registry value。WiX 标准单值 `RemoveRegistryValue` 只覆盖 install 阶段；删除整棵 Run key 会误伤其它应用，因此不安全。NSIS 生成脚本已经在非升级卸载分支精确删除 `${PRODUCTNAME}` 对应 Run value，本次保持不变。
- 修复已在当前工作区实现：MSI 嵌入小型 x64 Rust DLL custom action，仅在 `REMOVE="ALL" AND NOT UPGRADINGPRODUCTCODE` 执行、以安装用户身份访问 64 位 HKCU Run，只读取/处理精确 `Links Workplace` value；仅当 value data（允许插件尾空白/外层引号）与 MSI `[INSTALLDIR]links-workplace.exe` 完全匹配时删除。值缺失/target 不同/类型不支持时安全 no-op；不会删除其他 Run values、整棵 key、其它 startup 入口或任何用户数据。代码未检查目标 EXE 是否还存在，因此 EXE 已提前缺失时仍能清理。
- 自动验证：cleanup decision A–F 的 6 个 Rust 测试 PASS；相关 architecture tests 10/10 PASS；完整 `npm run verify`：1155 UI PASS / 15 skipped；Cargo：113 passed / 2 ignored + 6 cleanup tests PASS；fmt 与 clippy PASS。`0185` 的失败记录保持不可变，不改写成 PASS。
- 当前实现提交、生产 build、新 MSI/NSIS 与安装态测试结果稍后补入。本次不会重装已卸载的旧 MSI；只对新候选执行 fresh MSI OFF/ON 与 NSIS OFF/ON uninstall 验证。Phase 5.2 仍未完成；NO PUSH / TAG / RELEASE。

### 新 cleanup 候选与一次管理员验证（2026-10-03）

- 源码候选：`c45953e44c635b8fe18b4878e52653977f99f9c8`；生产构建于 2026-10-01 00:12（Asia/Shanghai）完成，`npm run tauri build` PASS。后续文档提交不改变产物源码来源。
- MSI ProductCode 从实际候选派生：`{7EC5FA8B-B416-497B-B8AB-484BA198DEA8}`；稳定 UpgradeCode 保持 `{2F689303-B82C-571D-BCD4-3DDF71E745AF}`。只读 MSI 表确认 deferred uninstall action 与嵌入 DLL 存在；WiX DLL SourceFile 使用 `$(sys.SOURCEFILEDIR)`，修正先前两次打包路径失败。
- 以下均为本次 production build 的新产物，不复用 0185 旧候选。签名为构建实际生成的 sidecars，未宣称完成独立密码学验签或 Updater E2E。

| 文件 | bytes | SHA-256 |
| --- | ---: | --- |
| Links Workplace_2.0.0_x64_en-US.msi | 54681600 | `63DF3EA7B0295F26FCA86AB309ACCAF621B507A859029D5661B7C6C61C3AF1C8` |
| Links Workplace_2.0.0_x64_en-US.msi.sig | 428 | `182EFE8EDC469D0B2BCBE075E1F3A154D407F6F7E3DF5DB01354D80FF9070A44` |
| Links Workplace_2.0.0_x64-setup.exe | 52465987 | `702E53C49AC6F6271644140926FCCBF9EB0E1037F9BA4183BA3AEE5602E5B86C` |
| Links Workplace_2.0.0_x64-setup.exe.sig | 428 | `58B03A461E47DFA563679322036C407E85679FAB7E74062EA7BEE52B6BB14136` |

- 原始产物目录：`src-tauri/target/release/bundle/msi/` 与 `src-tauri/target/release/bundle/nsis/`（ignored）。隔离 staging：`D:\AI_Workspace\ReleaseTest\Phase-5-2\scenario-local\autostart-cleanup-c45953e44c63\input\`；四个文件复制后的 SHA-256 再次全部一致。
- 唯一管理员脚本：`D:\AI_Workspace\ReleaseTest\Phase-5-2\scenario-local\autostart-cleanup-c45953e44c63\scripts\run-autostart-cleanup-matrix.ps1`；SHA-256：`6B67BF8AC0C04142AA0B171868C6DB7997DF991AFB8EFBFF8BB9F6FD3E0345D3`。PowerShell 5.1 parse、scenario 内/外路径保护、旧 ARP 双视图快照与变化拒绝自检 PASS。这些不替代真实安装验证。
- 第一次管理员执行在安全预检处停止：发现 NTU Course Assistant 1.3.1 的 HKCU ARP 项在 32/64 view 各有镜像，UninstallString 指向旧产品自己的 `uninstall.exe`；`cases=0`，没有运行候选安装/卸载，不是产品 cleanup PASS/FAIL。
- 脚本现在只接受该精确 1.3.1 NSIS 形态并保存 ARP 快照；每个场景后检查它未改变。若发现 Links Workplace ARP、非该版本/非 NSIS 的 NTU 项、related MSI、正在运行的相关程序等，仍会停止。脚本不会启动旧程序或访问其 AppData。
- 修订脚本 SHA-256：`6B67BF8AC0C04142AA0B171868C6DB7997DF991AFB8EFBFF8BB9F6FD3E0345D3`；PowerShell 5.1 parse 与旧 ARP snapshot / mutation guard 自检 PASS。两次原始失败预检结果均保留在候选 `results` 目录，未覆盖。
- 四场景尚未运行：MSI OFF / ON、NSIS OFF / ON fresh install→uninstall，均 **PENDING_ADMIN_EXECUTION**。
- 工作区存在用户无关 untracked 脚本，保留且不提交。Phase 5.2 尚未关闭；Phase 5.3 NOT STARTED；NO PUSH / TAG / RELEASE。

### 独立 Windows synthetic bootstrap 验证

场景根：`<ReleaseTest>/Phase-5-2/scenario-local/c7d3dfbf8fec4be9b274db5fc7b0f99a/`。每个场景有自己的 ownership、fixtures、baseline hashes、result/log，不引用 S04/S05/reinstall live-state。

外部 CLI 直接编译当前冻结的 `models.rs`、`db.rs`、`release_data_migration.rs`；不是 mock，不修改产品源码，不重建生产 EXE/installer。CLI 从独立 scenario root 调用实际 production `prepare_release_database`。**这不等同于启动安装态 Links Workplace / 完整 GUI E2E。**

| 场景 | 实际结果 | 证据 |
| --- | --- | --- |
| 独立有效 legacy schema 5 + Links schema 8 | **Bootstrap PASS**：CONFLICT / multiple_sources，exit=2；两库 hash 不变，无 marker / activation / 自动合并 | `conflict/result.json` 与 stdout/stderr |
| 独占 Windows file handle 占用 synthetic source | **Bootstrap PASS**：source_validation / database_validation 安全失败，exit=2；无 target / marker / 半激活 | `db-lock/locked.stderr.log` |
| 释放 lock 后重试 | **Bootstrap PASS**：schema 5→8，3 migrations；source hash 不变；target integrity=ok、FK=0；backup valid，marker 存在 | `db-lock/result.json` |
| 再次执行 bootstrap | **PASS**：RESULT=EXISTING；target hash 不变 | `db-lock/idempotent.stdout.log` |

Conflict installed-app launch、DB Lock installed-app UI recovery 与 Running Legacy installed-app E2E：**DEFERRED / NOT TESTED — USER ACCEPTED under the time-boxed harness policy**。冻结二进制采用 Windows known-folder AppData，无 scenario-root override；单账户下不能把 env LOCALAPPDATA 当作已验证的隔离机制，不能为测试启动至 S04 live state 或 REAL_HOLD。不改 host known-folder registry、不新增产品测试入口。未证明产品缺陷。Running Legacy 的 NSIS guard 静态确认：验证旧身份后 FindProcessCurrentUser，运行时提示关闭并 Abort，无 force kill；静态审查不能替代真实旧进程 E2E。

### Autostart 与 uninstall cleanup

- 官方 Tauri autostart 2.5.1 使用 auto-launch 0.5.0。外部 CLI 复用同一个已编译 Windows backend，临时唯一 `LinksRC-*` Run 名称：OFF→ON→OFF、真实 HKCU registry readback **PASS**；Run / StartupApproved 测试项已清理。证据：`autostart-result.json`。未借此宣称安装态 Settings UI / Login PASS。
- 安装态 UI 与系统一致：**PENDING_MANUAL**；logout/login：**PENDING_MANUAL**。
- 0185 MSI cleanup **FAIL（已确认产品缺陷）**；新 candidate build PASS；四条 fresh install/uninstall（MSI OFF/ON、NSIS OFF/ON）尚未执行。合并管理员脚本已准备并静态验证；MSI ProductCode 必须由候选 MSI 动态读取，不复用 0185 ProductCode。
- 新验证只操作 scenario-owned 安装目录、installer 与唯一临时测试 Run 值；不启动业务 app，不读取 active AppData/用户数据库/REAL_HOLD，不安装旧包。脚本会在结束时恢复自己创建的测试 Run 项，并验证其它 sentinel Run values 未变。
- 当前旧 MSI 哈希/ProductCode 只属于失败复现证据，不再作为候选。新 MSI、NSIS、签名 sidecars、文件大小/SHA-256、UpgradeCode 与 build time 待生产构建后补记。

Phase 5.2 尚未完成；当前修复只有在新候选的自动门禁、production build、四条 fresh installer cleanup 与资产检查全部真实通过后才能关闭相关门禁。完成可执行门禁并明确记录剩余覆盖缺口后，才可记 **COMPLETE WITH ACCEPTED DEFERRED COVERAGE** 并继续已授权 Phase 5.3。当前 Phase 5.3 **NOT STARTED**。NO PUSH / TAG / RELEASE。未知 untracked 用户文件保留，不混入阶段提交。

当前覆盖矩阵见 [Release checklist](v2-release-checklist.md)。

## 以下为 2026-09-28 历史审计快照

下列历史状态、产物哈希与隔离策略只代表当时结果；不能替代上方当前状态及冻结候选实测。

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

## 安全边界与隔离说明

- 本机未使用 Windows Sandbox/VM。后续用户批准的 installer 检查采用单账户、scenario-owned synthetic harness；不能把它描述为隔离 VM 测试。
- 不读取、复制、迁移或删除真实用户数据库及凭据，不触碰 `REAL_HOLD`。本次 MSI cleanup 脚本只检查和操作其显式拥有的安装目录及精确 `Links Workplace` 自启动值。
- 旧的 Sandbox 阻塞记录已被用户批准的单账户测试策略取代，不再作为当前继续条件。登录后自启动仍未做真实 logout/login 验证。

## 最终状态

- Phase 5.1：COMPLETE。
- Phase 5.2：IN PROGRESS；MSI uninstall 自启动 cleanup 缺陷已在 `0185cd7` 真实复现并确认，修复代码与自动验证 PASS；新 candidate production build 和管理员安装态 cleanup 矩阵待完成。
- MSI-S04-R1（official 1.3.0 MSI → 2.0 MSI）：PASS，保持封板。
- MSI-S05（official 1.3.1 MSI → 2.0 MSI）：DEFERRED / NOT TESTED — USER ACCEPTED。
- MSI uninstall/reinstall 矩阵：DEFERRED / NOT TESTED — USER ACCEPTED；与本次独立 uninstall cleanup 缺陷分开记录。
- 新 candidate MSI/NSIS fresh OFF/ON → uninstall cleanup：PENDING；需一次合并管理员验证，动态从 candidate MSI 派生 ProductCode。
- Conflict 与 DB Lock：production bootstrap synthetic tests PASS；installed-app E2E 按已接受边界未执行。
- Autostart backend OFF→ON→OFF：PASS；Settings UI 与 logout/login：PENDING_MANUAL。
- Synthetic Installer Migration E2E：逻辑/测试覆盖 PASS；未等同于完整安装态迁移验收。
- Real User Data Activation：NOT EXECUTED。
- Updater E2E：NOT STARTED。
- Phase 5.3：NOT STARTED。
- Push / tag / Release：NO。
