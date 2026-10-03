# Links Workplace 2.0 — Release checklist

更新：2026-10-03。当前替代候选源码：`80ca1efe78205240570c6a1483517407946a68a6`；`0185` 保持原始 autostart 缺陷复现基线，`c45953e` 的 MSI_OFF uninstall 1603 作为不可变失败证据。

不得把 bootstrap harness、静态审查或 registry backend 验证写成真实安装态 GUI E2E PASS。

| 门禁 | 当前状态 | 说明 |
| --- | --- | --- |
| MSI v1.3.0 → 2.0（MSI-S04-R1） | PASS | Immutable evidence：旧产品清理、schema 5→8、backup、marker、源不变、3 launches；封板，不依赖 live state |
| MSI v1.3.1 → 2.0（MSI-S05） | DEFERRED / NOT TESTED — USER ACCEPTED | S04 archive/S05 preparation harness instability；candidate executed=FALSE；product defect NOT ESTABLISHED |
| MSI uninstall/reinstall | DEFERRED / NOT TESTED — USER ACCEPTED | TEST HARNESS RETAINED STALE S04 LIVE-STATE DEPENDENCY；uninstall/reinstall executed=FALSE；product defect NOT ESTABLISHED |
| 独立新旧有效库 Conflict | Bootstrap PASS；installed-app E2E DEFERRED / NOT TESTED — USER ACCEPTED | 真实 production function 拒绝多个源，两库 hashes 不变；native app 无安全 scenario-root 隔离，不使用 S04 live state |
| DB Lock / 释放后恢复 | Bootstrap PASS；installed-app E2E DEFERRED / NOT TESTED — USER ACCEPTED | 独占 source 安全失败，无半激活；释放后 5→8、valid backup/marker、EXISTING 幂等 PASS |
| Running Legacy App | DEFERRED / NOT TESTED — USER ACCEPTED | 无独立 known-folder 测试运行态；NSIS 关闭旧进程 guard 仅静态审查，不能记 E2E PASS |
| Autostart OFF/ON/OFF | Official Windows backend PASS；installed Settings UI PENDING_MANUAL | 唯一临时 Run value，系统 readback 与清理 PASS；不改已有用户项 |
| Autostart logout/login | PENDING_MANUAL | 未进行真实登录启动；不得记 PASS |
| MSI uninstall cleanup | **c45953e MSI_OFF 1603 PRODUCT DEFECT CONFIRMED; FIX `80ca1ef` + AUTO GATES PASS; NEW CANDIDATE ADMIN MATRIX PENDING** | 根因：CA 使用 null buffer 探测 `MsiGetPropertyW` 却强求 `ERROR_MORE_DATA`，实际返回 `ERROR_SUCCESS` 并在触碰 HKCU 前失败；有效缓冲区探测已修复。不可变失败日志/只读现场及替代候选 manifest 见 Phase 5.2 evidence |
| NSIS uninstall cleanup | PENDING ADMIN MATRIX / NOT EXECUTED | 已检查生成脚本在非升级卸载时删除精确 `Links Workplace` Run value；新候选 fresh OFF/ON 安装卸载测试与 MSI 合并执行 |
| 安装器用户数据保留 | PENDING | Bootstrap 不等同卸载保留验证；不读取/删除当前 active AppData |
| REAL_HOLD / recovery protection | 4/4 hash verification PASS | 只读核验；不修改 HOLD / recovery backup；不访问真实 credentials |
| Phase 5.3 Updater E2E | NOT STARTED | Phase 5.2 收口后继续 |
| Phase 5.3 synthetic cleanup / 真实数据恢复与最终迁移 | NOT STARTED | 先核实权威备份与 ownership；不破坏 REAL_HOLD |
| 最终 RC matrix / build verification / artifacts | PENDING | 不沿用未验收产物作为最终发布宣称 |

用户已批准无法快速稳定完成的纯 harness 场景透明延期；以上延期不表示测试 PASS，也不表示已证明产品 FAIL。任何真实产品缺陷必须修复与回归，不能借此豁免。

真实 MSI uninstall cleanup 两个缺陷均有独立证据：0185 旧产品卸载 exit=0 但留下精确 Run value；c45953e 新候选 MSI_OFF uninstall exit=1603，已由 CA 日志与只读 `MsiGetPropertyW` API probe 定位为缓冲区探测逻辑错误。`80ca1ef` 修复及自动门禁/production build 已 PASS。当前 candidate 四格安装态 cleanup 需从管理员 PowerShell 单次执行；入口先核验用户和 legacy NTU ARP，再 major-upgrade/卸载仅限失败的 c45953e scenario-owned 测试包，执行 final PreExecuteOnly 与 MSI/NSIS OFF/ON 矩阵。身份或受保护 baseline 不匹配时安全停止。当前 Phase 5.2 **IN PROGRESS — NEW BUILD PASS — WAITING FOR ADMIN CLEANUP MATRIX**；不能提前记 COMPLETE。

NO PUSH / NO TAG / NO RELEASE，直到 Ethan 最终明确授权。
