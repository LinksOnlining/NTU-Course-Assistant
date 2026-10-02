# Links Workplace 2.0 — Release checklist

更新：2026-10-03。新产物源码候选：`c45953e44c635b8fe18b4878e52653977f99f9c8`；0185 保持缺陷复现基线。

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
| MSI uninstall cleanup | **0185cd7 PRODUCT DEFECT CONFIRMED; FIX AUTOMATED PASS; CANDIDATE UAC PENDING** | 真正卸载 exit=0 后，Links Workplace 的 HKCU Run value 仍存在；修复已加入 MSI-only exact-path deferred cleanup，候选安装态验证待一次管理员执行 |
| NSIS uninstall cleanup | PENDING UAC / NOT EXECUTED | 已检查生成脚本在非升级卸载时删除精确 `Links Workplace` Run value；新候选 fresh OFF/ON 安装卸载测试待一次管理员执行 |
| 安装器用户数据保留 | PENDING | Bootstrap 不等同卸载保留验证；不读取/删除当前 active AppData |
| REAL_HOLD / recovery protection | 4/4 hash verification PASS | 只读核验；不修改 HOLD / recovery backup；不访问真实 credentials |
| Phase 5.3 Updater E2E | NOT STARTED | Phase 5.2 收口后继续 |
| Phase 5.3 synthetic cleanup / 真实数据恢复与最终迁移 | NOT STARTED | 先核实权威备份与 ownership；不破坏 REAL_HOLD |
| 最终 RC matrix / build verification / artifacts | PENDING | 不沿用未验收产物作为最终发布宣称 |

用户已批准无法快速稳定完成的纯 harness 场景透明延期；以上延期不表示测试 PASS，也不表示已证明产品 FAIL。任何真实产品缺陷必须修复与回归，不能借此豁免。

真实 MSI uninstall cleanup 失败是产品缺陷，不是 harness false positive：不可变证据位于 `D:\AI_Workspace\ReleaseTest\Phase-5-2\scenario-local\c7d3dfbf8fec4be9b274db5fc7b0f99a\cleanup-execution\result.json`。修复与自动测试已完成；新候选 production build PASS；四项产物大小/hash 与一次管理员脚本已记录；MSI/NSIS fresh OFF/ON uninstall 真实验收待管理员执行。当前 Phase 5.2 **IN PROGRESS — BUILD PASS — WAITING FOR ADMIN CLEANUP EXECUTION**。收口后可记 **COMPLETE WITH ACCEPTED DEFERRED COVERAGE**，逐项列出缺口；当前不能提前记 COMPLETE。

NO PUSH / NO TAG / NO RELEASE，直到 Ethan 最终明确授权。
