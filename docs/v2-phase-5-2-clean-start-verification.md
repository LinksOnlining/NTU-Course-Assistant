# Phase 5.2 — Links Workplace 2.0 Clean-start Verification

更新：2026-10-03

## 当前决策与边界

- Links Workplace 2.0 是 **CLEAN-START RELEASE**。NTU Course Assistant 1.x → 2.0 自动升级/数据迁移及 schema 5/6/7→8 迁移均不支持。
- NTU ARP 不存在是合法状态；旧 NTU 安装、shortcut、AppData 和历史产品状态不属于 2.0 installer gate。
- 旧 S04/S05、MSI reinstall 与 legacy cleanup matrix 统一为 **OBSOLETE / NOT APPLICABLE BY PRODUCT SCOPE CHANGE**，不是 PASS、FAIL 或 DEFERRED。相关旧结果仅作为历史证据，不继续执行或维护。
- 当前分支 `v2/workspace-rebase`，起始 HEAD `ffef91e4a10c4a9e2a2dea307313481072f736c8`。保留既有 `80ca1efe` MSI custom-action `MsiGetPropertyW` 修复；`c45953e` MSI 1603 失败证据只作历史记录。
- Phase 5.3、push、tag、GitHub Release 均未开始/执行。

## Final 1.3 cold archive

- 归档目录：`D:\AI_Workspace\ReleaseSafetyBackup\Legacy-1.3-Final-Archive\20261003-115615\`
- Manifest：`legacy-1.3-final-archive-manifest.json`
- Payload：42 个文件；SHA-256 recheck：42/42 匹配；43/43 文件（含 manifest）为只读。
- SQLite metadata audit：8 个数据库验证记录；archive verification：**PASS**。
- Manifest SHA-256：`802091C60CEBD509AD05099DFA018BF3E9A2787A811FE96B98FAD351A4FCC6AF`
- 归档及 REAL_HOLD 不得由本阶段代码或测试修改。当前 active legacy root 清理未完成；一次精确删除请求在执行前被本机安全策略拒绝，未尝试其他方式，也未改动该数据。不得将其描述为 ABSENT。

## 当前实现规则

1. 唯一 v2 Tauri identifier：`com.links.workplace.desktop`；启动只解析自己的 `app_local_data_dir()`。
2. 数据库缺少时创建全新 schema 8；schema 8 可打开；任何已存在 `user_version != 8` 的数据库只读拒绝且字节不变。
3. 不扫描 `com.ntu-course-assistant.desktop`，不做旧库复制、备份、marker、冲突解析或自动恢复。
4. NSIS 不执行 NTU 卸载 hook；MSI UpgradeCode 按产品决策保持 `2f689303-b82c-571d-bcd4-3ddf71e745af`；MSI Wix fragment 仅保留 Links 自启动精确值清理。NTU 旧 shortcut 清除逻辑不再打包。
5. `80ca1efe` 修复的 Links 自启动 uninstall custom action 必须保留。

## 2.0-only 安装态验收矩阵

测试基线：Links Workplace absent；NTU irrelevant；记录并保护无关 Windows Run 项；不得读取真实用户数据库正文、凭据或 REAL_HOLD。

| 场景 | 状态 | 通过标准 |
|---|---|---|
| MSI Fresh / Autostart OFF | PENDING | 安装成功；首次 DB 为 schema 8；设置保持 OFF；单实例与托盘退出正常；卸载 exit 0 |
| MSI Fresh / Autostart ON | PENDING | Links 精确 Run value 指向 `links-workplace.exe`；卸载 exit 0 后该值删除 |
| NSIS Fresh / Autostart OFF | PENDING | 安装/卸载成功；无 Links Run value；单实例与托盘退出正常 |
| NSIS Fresh / Autostart ON | PENDING | Links 精确 Run value 存在；卸载成功后删除 |
| MSI / NSIS cleanup | PENDING | 卸载后 Links ARP、EXE、shortcut、应用目录及自启动按预期移除；无关启动项不变 |
| Active legacy user-data cleanup | BLOCKED | 安全策略拒绝了精确删除请求；未改动数据，等待用户可执行的安全处理方式 |

每个 installer 场景使用独立标识/结果目录。不得检查或要求 NTU ARP、NTU install path 或旧 installer；不得启动旧版本做升级。

## 自动验证（本轮代码阶段）

- `tests/architecture/windows-installer-identity.test.mjs`：PASS（4/4）。
- `cargo test --manifest-path src-tauri/Cargo.toml`：PASS（Rust lib 98 passed / 1 ignored；installer cleanup 7 passed）。
- schema gate regression：schema 0–7 与 9 均由 `open` / `connect` 拒绝，测试库文件字节保持不变。
- `npm run verify`、fmt/clippy 与 production build：待完整代码和文档整理完成后运行。

## Final gate

当前 Phase 5.2 状态：**CLEAN-START IMPLEMENTATION IN PROGRESS**。仅当自动验证、production build、2.0-only MSI/NSIS 新装与 OFF/ON 卸载矩阵均 PASS 后，Phase 5.2 才可收口。随后才进入 Phase 5.3 updater E2E。发布前禁止 push、tag 或 Release。
