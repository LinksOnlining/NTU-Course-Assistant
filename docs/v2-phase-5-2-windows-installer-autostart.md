# Phase 5.2 — Windows Integration & Installer Upgrade

> **SCOPE SUPERSEDED：**2026-10-03 产品决策将 2.0 改为 clean-start release。下文 S04/S05、NTU baseline、legacy migration 和旧 cleanup matrix 只保留为不可变历史证据，不再是当前 Gate；统一状态为 **OBSOLETE / NOT APPLICABLE BY PRODUCT SCOPE CHANGE**，不是 PASS、FAIL 或 DEFERRED。不要继续运行或维护旧 matrix。当前仅执行 MSI/NSIS 2.0 fresh install/uninstall/autostart 检查，见 `docs/v2-phase-5-2-clean-start-verification.md`。

## 当前有效状态（2026-10-03）

缺陷复现基线：`0185cd722c1c072730190a716a4376e4c22ecbcb`；Phase 5.2：**IN PROGRESS — c45953e 的 MSI_OFF uninstall 1603 已确认是产品 CA 缺陷；根因已在 `80ca1ef` 修复；自动门禁与新 production build PASS；替代候选四格管理员 cleanup matrix PENDING**。

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

### 历史候选 c45953e（首次真实卸载失败，已被新候选替代）

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
- 管理员脚本：`D:\AI_Workspace\ReleaseTest\Phase-5-2\scenario-local\autostart-cleanup-c45953e44c63\scripts\run-autostart-cleanup-matrix.ps1`；当前 SHA-256：`323BD05A7F6717B762A98F2C450C2D0E197294CFAD92E6CE1C1C5742B53F71C1`。scenario 路径保护、candidate identity 与 ARP 镜像去重逻辑均有自检；自动检查不替代真实安装验证。
- 第二次管理员尝试结果 `cleanup-matrix-result-20261003-070944-366.json`：预检看到两条相同 HKCU NTU Course Assistant 1.3.1 记录（Registry32/Registry64），随后在候选身份校验处停止；`cases=[]`、ProductCode/UpgradeCode 未读取写入结果，`msi-logs` 不存在。脚本顺序证明没有进入 `msiexec`：`CANDIDATE_MSI_EXECUTED=False`、`MSI_INSTALL_EXIT_CODE=NOT_RUN`；产品判定为 **NOT TESTED IN THIS ATTEMPT**，不是产品 FAIL。
- 根因是 PowerShell MSI COM helper 的 `Execute()` / `Close()` 调用结果未抑制，旧函数返回 `Object[]`（最小复现捕获 3 项：空值、`Links Workplace`、空值），导致候选字符串身份比较误报。现在用 `$null = ...` 抑制 COM 返回并返回单一字符串；`Read-CandidateMsiIdentity` 每次从实际 MSI Property / Upgrade 表读取 ProductName、ProductVersion、ProductCode、UpgradeCode、Manufacturer，ProductCode 来源为 `LIVE_MSI_PROPERTY`，没有硬编码旧 ProductCode。
- 候选身份已直接从实际 MSI 读取并通过校验：`Links Workplace` / `2.0.0` / ProductCode `{7EC5FA8B-B416-497B-B8AB-484BA198DEA8}` / UpgradeCode `{2F689303-B82C-571D-BCD4-3DDF71E745AF}` / Manufacturer `links`。文件为 `input\Links Workplace_2.0.0_x64_en-US.msi`，54,681,600 bytes，SHA-256 `63DF3EA7B0295F26FCA86AB309ACCAF621B507A859029D5661B7C6C61C3AF1C8`，与 candidate manifest 一致。
- `input\candidate-manifest.json` 将产品源码明确记为 commit `c45953e44c635b8fe18b4878e52653977f99f9c8`（Git commit subject：`fix: resolve WiX cleanup DLL source path`）。`autostart-cleanup-c45953e44c63` 是 scenario id / 目录名，不是 commit 或 artifact id；candidate source commit 不靠目录名推断。
- 用户管理员终端此前观察的两条 NTU ARP 是同一 HKCU uninstall key 在 32/64 registry view 的镜像：逻辑记录去重为一条并保留两个 view；其 1.3.1 NSIS `uninstall.exe` 形态是允许保留的 pre-install baseline，Links Workplace 应 absent。当前 Codex shell 的 profile 是 `C:\Users\LinYu` 且此 HKCU 未枚举到该 NTU ARP；因此未将旧 `PREEXECUTE_PASS` 结果（它早于当前脚本，且 result 中 preflight ARP 为空）计为真实机器 preflight PASS。需在用户实际管理员 PowerShell 中运行下一次合并命令，实时确认 baseline 后才会执行四个安装/卸载场景。
- 当前修订后验证：Windows PowerShell 5.1 与 PowerShell 7 parse PASS；两者 `-SelfTest` 均输出 `CANDIDATE_IDENTITY=PASS`、`LEGACY_BASELINE=PASS`、`IDENTITY_REGRESSION=PASS`；实际 MSI identity helper / metadata / manifest hash PASS。当前上下文无法读取用户管理员终端中的真实 HKCU baseline，故**真实 `PREEXECUTE_ONLY` 与四场景仍 PENDING_ADMIN_EXECUTION**。
- 四场景尚未运行：MSI OFF / ON、NSIS OFF / ON fresh install→uninstall，均 **PENDING_ADMIN_EXECUTION**。原始结果均保留，没有覆盖或删除。
- 工作区存在用户无关 untracked 脚本，保留且不提交。Phase 5.2 尚未关闭；Phase 5.3 NOT STARTED；NO PUSH / TAG / RELEASE。

### c45953e MSI_OFF uninstall 1603 根因与替代候选（2026-10-03）

- 不可变失败记录：`D:\AI_Workspace\ReleaseTest\Phase-5-2\scenario-local\autostart-cleanup-c45953e44c63\results\cleanup-matrix-result-20261003-073909-595.json`；失败后只读状态：`MSI_OFF_POST_FAILURE_STATE.json`。c45953e MSI fresh install exit=0，随后 MSI_OFF uninstall exit=1603；不是 harness false positive。分类为 **C — AUTOSTART CLEANUP LOGIC DEFECT**（CA 内部属性读取逻辑，发生在 HKCU 访问前）；DLL 加载 / entrypoint 成功，故排除 B。原 verbose log 记录 64-bit impersonated CA server，但没有输出具体 Windows identity；此次故障早于 HKCU 操作，因此不是 D。deferred `RemoveLinksWorkplaceAutostart`（CA type 9217 / 0x2401）真实返回 1603。
- 根因证据：只读 `MsiOpenPackageEx(..., MSIOPENPACKAGEFLAGS_IGNOREMACHINESTATE)` 复现确认：旧 CA 对 `MsiGetPropertyW(ProductName, null buffer, size=0)` 的探测收到 `ERROR_SUCCESS=0`、required chars=15；同 API 使用有效的 1-NUL 输出缓冲区才返回 `ERROR_MORE_DATA=234`。旧实现错误要求 234，因此在访问 HKCU 前立即映射为 MSI 1603。Microsoft 文档明确禁止以 null 缓冲区探测大小，并说明应传有效空字符串缓冲区：[MsiGetPropertyW](https://learn.microsoft.com/en-us/windows/win32/api/msiquery/nf-msiquery-msigetpropertyw)。只读复现使用 `MsiOpenPackageEx` 的 `MSIOPENPACKAGEFLAGS_IGNOREMACHINESTATE`，该受限句柄不会改变机器状态：[MsiOpenPackageEx](https://learn.microsoft.com/en-us/windows/win32/api/msi/nf-msi-msiopenpackageexa)。
- 最小修复提交：`80ca1efe78205240570c6a1483517407946a68a6`（`fix: read MSI deferred action data with valid buffer`）。改为有效空缓冲区探测；保留精确 Links Run value ownership 校验、HKCU 用户上下文及真实错误返回，并将 CA 内部阶段、Windows identity 与状态写入 MSI 日志。新增跨用户同名路径不删除的测试；cleanup tests 7/7 PASS。
- 失败后现场未被脚本恢复/清理。只读快照位于 `MSI_OFF_POST_FAILURE_STATE.json`；它记录 c45953e ProductCode `{7EC5FA8B-B416-497B-B8AB-484BA198DEA8}` 仍安装、程序/安装目录/快捷方式仍在、Links Run value 不存在、相关进程不在。NTU ARP 在 Codex 当前 profile 与先前管理员预检 profile 间存在可见性差异；没有据此宣称 NTU 状态一致，也未访问/改动 NTU 文件、用户 DB、凭据或 REAL_HOLD。新管理员脚本会在写入前严格核验账户、旧测试包路径及 NTU 1.3.1 ARP 基线，不匹配即停止。
- 替代候选：branch `v2/workspace-rebase`，source commit `80ca1efe78205240570c6a1483517407946a68a6`。MSI ProductCode `{6CB1D810-FDA9-4C09-A631-62236A264E82}`；UpgradeCode 保持 `{2F689303-B82C-571D-BCD4-3DDF71E745AF}`。MSI 只读元数据确认 MajorUpgrade UpgradeCode 连续；计划中的一次受保护管理员执行只会通过新 MSI major-upgrade 移除失败旧测试包，不重测 c45953e，不启动应用，不访问 DB。
- 本候选 `npm run verify`：PASS（Playwright 1155 passed / 15 skipped）；`cargo test`：113 passed / 2 ignored；`cargo fmt --check` 与 `cargo clippy --all-targets -- -D warnings`：PASS；`npm run tauri build`：PASS。PowerShell 5.1 / 7 parse、matrix `-SelfTest`、候选 `-ValidateOnly`（两种 PowerShell 均通过）：PASS。`ValidateOnly` 结果为 `results\candidate-cleanup-orchestration-20261003-082624-194.json`；另一次早期 PS7 自测路径失败已修复，失败记录保留且未执行 installer/registry。最终 runner SHA-256：`AB077F2B1F29C41B8E249DF748FBDAA10FF0940C485A73DAA1A9494382B7D94E`；copied matrix SHA-256：`E212AB20D2B16EAE57E0BC1739F3323E908471D27707DF5549B48973DBCD475D`；manifest SHA-256：`B1F1542F618408C73DB70E4F3F619CF9CEB58276C1E1990D017C6919914A271C`。静态验证没有执行 installer 或改动注册表。

| 新候选产物 | bytes | SHA-256 |
| --- | ---: | --- |
| `Links Workplace_2.0.0_x64_en-US.msi` | 54685696 | `696B3478CE478AB5354F3F0BD14A29893A5F1476383437E2147C67100D2C0610` |
| `Links Workplace_2.0.0_x64_en-US.msi.sig` | 428 | `D48DD9B20675FBEA34509E8A93D6D7A3CC26CEA159AF9965AB91BBB368C8E914` |
| `Links Workplace_2.0.0_x64-setup.exe` | 52468077 | `BA8D3BF475F85BCD9A5A1C8E73DEB525955D0E2A5509EDAB7A0D52CE3E3E49D1` |
| `Links Workplace_2.0.0_x64-setup.exe.sig` | 428 | `20D913A0FFFF4307D6FD09AFFC4C80760E6DA444F3EA9C90CEBD223D616D7F47` |

- 外部 staging：`D:\AI_Workspace\ReleaseTest\Phase-5-2\scenario-local\autostart-cleanup-80ca1ef7823b\`；产物构建时间为 2026-10-03 08:10–08:11（Asia/Shanghai），复制产物 SHA-256 与构建输出一致；`.sig` 是本次 Tauri build 生成的 sidecar，本阶段未单独做密码学验签。唯一管理员入口：`scripts\run-candidate-cleanup-matrix.ps1 -Execute`（SHA-256 `AB077F2B1F29C41B8E249DF748FBDAA10FF0940C485A73DAA1A9494382B7D94E`），先做只读 ownership / identity / hash / NTU ARP preflight；随后只对旧 c45953e 测试包做一次 major upgrade，再卸载新包，确认旧/新 Links 产品及 Links shortcuts/Run 项消失、NTU ARP 与其它 Run values 不变；之后自动执行 `PreExecuteOnly` 和 `MSI OFF/ON + NSIS OFF/ON` 四格 cleanup。每格验证 exit=0、ARP/EXE/shortcuts/Run 清理和 unrelated Run values 保留；MSI logs 还要确认 WindowsIdentity 为授权测试账户，以及 OFF 幂等/ON 精确删除消息。脚本不停止任何进程、不手删注册表、不启动 app、不读取 DB/credentials、不触碰 REAL_HOLD。
- 状态：新候选实际安装态矩阵 **PENDING_ADMIN_EXECUTION**；仅自动构建与静态预检通过，不能宣称 installer cleanup PASS。当前 Codex PowerShell 为非提升上下文，仍可见失败的 c45953e Links MSI，且没有枚举到 legacy NTU ARP；该上下文未执行任何安装器，管理员脚本会在受保护 baseline 不匹配时停止。Phase 5.2 未关闭，Phase 5.3 NOT STARTED，NO PUSH / TAG / RELEASE。
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
- 0185 基线的 autostart cleanup 缺陷已由下方 MSI custom action 修复；但其首个 cleanup 候选 `c45953e` 的 MSI_OFF fresh uninstall 真实返回 1603，见下方根因和替代候选记录。新候选四格 fresh install/uninstall（MSI OFF/ON、NSIS OFF/ON）仍待管理员执行。
- 新验证只操作 scenario-owned 安装目录、installer 与唯一临时测试 Run 值；不启动业务 app，不读取 active AppData/用户数据库/REAL_HOLD，不安装旧包。脚本会在结束时恢复自己创建的测试 Run 项，并验证其它 sentinel Run values 未变。
- `c45953e` MSI/ProductCode 只保留为失败复现证据，不再作为候选。当前候选为 `80ca1ef`，新 MSI/NSIS 与 sidecars 的大小、SHA-256、ProductCode、UpgradeCode、build time 已记录于下节；真实安装态 cleanup 仍待管理员矩阵。

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
- Phase 5.2：IN PROGRESS；`0185cd7` 原始自启动清理缺陷已修复；`c45953e` 的 MSI_OFF uninstall 1603 根因已在 `80ca1ef` 修复，full verify / Rust checks / production build PASS；当前替代候选四格管理员 cleanup matrix PENDING。
- MSI-S04-R1（official 1.3.0 MSI → 2.0 MSI）：PASS，保持封板。
- MSI-S05（official 1.3.1 MSI → 2.0 MSI）：DEFERRED / NOT TESTED — USER ACCEPTED。
- MSI uninstall/reinstall 矩阵：DEFERRED / NOT TESTED — USER ACCEPTED；与本次独立 uninstall cleanup 缺陷分开记录。
- `80ca1ef` 新候选 MSI/NSIS fresh OFF/ON → uninstall cleanup：PENDING_ADMIN_EXECUTION；先以新 MSI major-upgrade 仅替换失败的 `c45953e` 测试包并卸载新包，再运行 PreExecuteOnly 与四格矩阵；动态核对 ProductCode。
- Conflict 与 DB Lock：production bootstrap synthetic tests PASS；installed-app E2E 按已接受边界未执行。
- Autostart backend OFF→ON→OFF：PASS；Settings UI 与 logout/login：PENDING_MANUAL。
- Synthetic Installer Migration E2E：逻辑/测试覆盖 PASS；未等同于完整安装态迁移验收。
- Real User Data Activation：NOT EXECUTED。
- Updater E2E：NOT STARTED。
- Phase 5.3：NOT STARTED。
- Push / tag / Release：NO。
