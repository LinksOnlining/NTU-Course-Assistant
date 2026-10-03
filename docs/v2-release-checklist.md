# Links Workplace 2.0 — Release Checklist

更新：2026-10-03。当前产品决策：**CLEAN-START RELEASE**。

## 发布范围

- Links Workplace 2.0 不自动升级或迁移 NTU Course Assistant 1.x；安装前用户须自行卸载 1.x。
- 唯一应用身份：`com.links.workplace.desktop`；schema 8 是唯一可打开的既有数据库版本。
- 数据库缺少时创建 fresh schema 8；已存在且 schema 非 8 时只读拒绝，内容保持不变。
- 当前公开 v1.x Release 与本机旧数据不属于 Links 2.0 升级来源。

## 旧兼容性 Gate

| 旧 Gate | 当前状态 | 处理 |
|---|---|---|
| MSI v1.3.0 → 2.0（MSI-S04） | **OBSOLETE / NOT APPLICABLE BY PRODUCT SCOPE CHANGE** | 不作为 Release Gate，不再运行 |
| MSI v1.3.1 → 2.0（MSI-S05） | **OBSOLETE / NOT APPLICABLE BY PRODUCT SCOPE CHANGE** | 不再标记 DEFERRED；不再运行 |
| NTU 1.x preserved / NTU ARP expected | **OBSOLETE / NOT APPLICABLE BY PRODUCT SCOPE CHANGE** | NTU 可不存在，测试不检查旧身份 |
| Legacy DB migration / conflict / running legacy app | **OBSOLETE / NOT APPLICABLE BY PRODUCT SCOPE CHANGE** | 2.0 不支持旧身份发现或 schema 迁移 |
| 旧 `run-candidate-cleanup-matrix.ps1` | **OBSOLETE BY PRODUCT SCOPE CHANGE** | 停止维护与执行；结果只作历史记录 |

历史 `80ca1efe` 自启动 MSI Custom Action 修复继续保留；`c45953e` MSI_OFF 1603 结果与其他旧测试输出不得删除或改写。

## 1.3 冷归档与主机清理

| 门禁 | 状态 | 证据 |
|---|---|---|
| Legacy-1.3 Final Archive | **PASS** | 42 payload files；42/42 SHA-256；8 个 SQLite metadata 验证记录；所有 43 文件只读 |
| REAL_HOLD / recovery evidence | **PROTECTED** | 不读业务正文、不修改、不删除 |
| Active legacy local state | **BLOCKED / NOT REMOVED** | 精确删除调用在执行前被安全策略阻止；没有尝试替代删除方式 |

## Phase 5.2 — 2.0-only fresh install / uninstall

Baseline：Links Workplace absent；NTU irrelevant；无关 Windows Run 项快照受保护。各场景需独立运行，不使用旧 installer 做升级。

| Gate | 状态 | 要求 |
|---|---|---|
| MSI fresh install / schema 8 | PENDING | Fresh install 成功；新 DB schema 8；主程序、单实例、Tray exit 正常 |
| MSI uninstall / Autostart OFF | PENDING | 卸载 exit 0；Links ARP、EXE、shortcut、目录不存在；无关 Run 项不变 |
| MSI install / Autostart ON / uninstall | PENDING | 精确 Links Run value 存在且指向本产品 EXE；卸载后删除 |
| NSIS fresh install / schema 8 | PENDING | Fresh install 成功；新 DB schema 8；主程序、单实例、Tray exit 正常 |
| NSIS uninstall / Autostart OFF | PENDING | 卸载成功；Links ARP、EXE、shortcut、目录不存在；无关 Run 项不变 |
| NSIS install / Autostart ON / uninstall | PENDING | 精确 Links Run value 存在且指向本产品 EXE；卸载后删除 |
| Installer ownership / shortcuts / ARP | PENDING | 仅验证 Links Workplace；绝不要求 NTU 旧产品状态 |

详细操作记录见 `docs/v2-phase-5-2-clean-start-verification.md`。

## Phase 5.3 — 后续 Gate

| Gate | 状态 |
|---|---|
| Isolated local updater channel / signature verification | NOT STARTED |
| Download → install → restart | NOT STARTED |
| Fresh schema 8 数据保留 | NOT STARTED |
| AI / Weather / UI 回归 | NOT STARTED |
| Synthetic cleanup / final build / artifact manifest | NOT STARTED |

## 当前结论

- Phase 5.1 的自动身份迁移方案被当前 clean-start 决策取代；旧迁移报告仅为历史证据。
- Phase 5.2：**CLEAN-START IMPLEMENTATION IN PROGRESS**；不得提前标记 COMPLETE。
- Phase 5.3：**NOT STARTED**。
- **NO PUSH / NO TAG / NO GITHUB RELEASE**。所有门禁通过后只停在 `RELEASE_READY`，等待 Ethan 明确授权。
