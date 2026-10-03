# Phase 5.2 — Links Workplace 2.0 Clean-start Verification

更新：2026-10-03

## 当前决策与边界

- Links Workplace 2.0 是 **CLEAN-START RELEASE**。NTU Course Assistant 1.x → 2.0 自动升级/数据迁移及 schema 5/6/7→8 迁移均不支持。
- NTU ARP 不存在是合法状态；旧 NTU 安装、shortcut、AppData 和历史产品状态不属于 2.0 installer gate。
- 旧 S04/S05、MSI reinstall 与 legacy cleanup matrix 统一为 **OBSOLETE / NOT APPLICABLE BY PRODUCT SCOPE CHANGE**，不是 PASS、FAIL 或 DEFERRED。相关旧结果仅作为历史证据，不继续执行或维护。
- 当前分支 `v2/workspace-rebase`；clean-start implementation commit `4d89200`，发布门禁/文档 commit `93e7642`。保留既有 `80ca1efe` MSI custom-action `MsiGetPropertyW` 修复；`c45953e` MSI 1603 失败证据只作历史记录。
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
| MSI Fresh / Autostart OFF | BLOCKED / NOT RUN | Host Links app-data identity already exists and is not proven disposable; do not launch installer/app against it |
| MSI Fresh / Autostart ON | BLOCKED / NOT RUN | Same clean-baseline blocker |
| NSIS Fresh / Autostart OFF | BLOCKED / NOT RUN | Same clean-baseline blocker |
| NSIS Fresh / Autostart ON | BLOCKED / NOT RUN | Same clean-baseline blocker |
| MSI / NSIS cleanup | BLOCKED / NOT RUN | No installer scenario was started; host install state was not changed |
| Active legacy user-data cleanup | BLOCKED | Archive is verified, but exact legacy AppData removal was denied before execution by the local safety policy; no alternate deletion path was attempted |

每个 installer 场景使用独立标识/结果目录。不得检查或要求 NTU ARP、NTU install path 或旧 installer；不得启动旧版本做升级。

## 自动验证与 production candidate build

- `tests/architecture/windows-installer-identity.test.mjs`：PASS（4/4）。
- `npm run verify`：PASS；Playwright 1,155 passed / 15 skipped，typecheck、unit/architecture/UI、lint、Prettier 和 frontend build 均 PASS。
- `cargo test --manifest-path src-tauri/Cargo.toml`：PASS（98 passed / 1 ignored；installer cleanup 7 passed）。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：PASS。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`：PASS。
- schema gate regression：schema 0–7 与 9 均由 `open` / `connect` 拒绝，测试库文件字节保持不变。
- `npm run tauri build`：PASS，基于 HEAD `93e7642`；输出为本地 ignored build artifacts，未安装、未提交。

Artifacts 位于 `D:\AI_Workspace\Projects\NTU-Course-Assistant\src-tauri\target\release\bundle\`；主 EXE 位于 `D:\AI_Workspace\Projects\NTU-Course-Assistant\src-tauri\target\release\`。

| Artifact | Size | SHA-256 | Signature |
|---|---:|---|---|
| `Links Workplace_2.0.0_x64_en-US.msi` | 54,480,896 bytes | `107801C924A002284E2538BA4B5C1D9BB2D6AF52D9D21403813F7B7380C10CF9` | `.sig` 428 bytes; `E8B4CE56AB601EEDC8C89A1D176F58F47D5CBC082B7C92ABD0A0D8324DBFE16E` |
| `Links Workplace_2.0.0_x64-setup.exe` | 52,452,884 bytes | `5CD25B3B6E9A901E49BD11FC66EF0086F61EEBDEAF7A59BB92D790D660A584B0` | `.sig` 428 bytes; `AE6A08BE94E74EBB25068B7B25EB06EECA706BD12AC98D260AEBCDC5BAFF77BE` |
| `links-workplace.exe` | 68,273,664 bytes | `4387FBB9D6C35487EC615D047AB5648935FEEB844A9B4AE9B50D83306898AB1E` | Product name `Links Workplace`; version `2.0.0` |

- MSI 元数据：ProductName `Links Workplace`；ProductVersion `2.0.0`；ProductCode `{D7C84E38-146A-4A0F-841A-5F60C55F0099}`；UpgradeCode `{2F689303-B82C-571D-BCD4-3DDF71E745AF}`。
- MSI / NSIS `.sig` 均使用当前配置 updater public key 通过 Minisign 加密校验；对各自文件做 1-byte tamper 后均被拒绝。此项不等于完整 updater E2E，也没有验证发布态 `latest.json`。
- Build log：`D:\AI_Workspace\ReleaseTest\Phase-5-2\2.0-only-cleanup-matrix\results\tauri-build-rc1.log`；verify log：`D:\AI_Workspace\ReleaseTest\Phase-5-2\2.0-only-cleanup-matrix\results\npm-verify-final-01.log`。

## Host clean-baseline gate

- Read-only preflight：Links Workplace / NTU Course Assistant 对应 ARP、安装目录、运行进程、自启动项均未发现。
- 两个 app-local identity roots 仍存在。Links root 中可见数据库、SQLite sidecar、migration marker 和 backups；其来源尚不能证明为 synthetic。未打开、复制、hash 或修改数据库及其内容。NTU identity root 仍存在；此前精确删除请求被本机安全策略在执行前阻止，未尝试替代删除方式。
- 因此没有运行 MSI/NSIS 安装矩阵、installed-state tests、updater E2E 或 synthetic cleanup。需要安全隔离的干净 Windows profile，或用户确认该精确 Links app-data root 是可丢弃的测试数据；在此之前不得对当前状态运行候选安装包。
- 未创建 `cleanup-plan.json` / `cleanup-result.json`，未删除文件；按已批准顺序，清理必须等最终 RC 验证后执行。

## Final gate

当前 Phase 5.2 状态：**IMPLEMENTATION COMPLETE；AUTOMATED VALIDATION PASS；PRODUCTION BUILD PASS；INSTALLED MATRIX BLOCKED；OVERALL PENDING**。阻断项是现存 app-local 数据归属未确认，不是已证明的产品缺陷。不得关闭 Phase 5.2、进入 Phase 5.3 或清理 app data，直到取得隔离测试基线。不得 push、tag 或创建 Release。
