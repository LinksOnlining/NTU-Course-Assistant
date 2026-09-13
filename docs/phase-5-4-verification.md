# Phase 5.4 / Phase 5 总验收

## 状态

**PASS**（2026-09-13）。Phase 5.1–5.4 均已完成；本记录同时作为 Phase 5 总验收。

## 实现

- SQLite 从 schema 3 安全迁移到 4，新增最小 `handled_reminders(occurrence_key, handled_at_milliseconds)`；迁移不会修改课程、作息或设置。
- scheduler 真正 due 并完成 notification delivery attempt 后才写 handled。通知 adapter 失败仍标记 handled，维持 at-most-once attempt；handled SQLite 写失败只记录错误，当前 session 的内存去重仍有效。
- React 在启动、课程/设置变化、窗口恢复、焦点恢复和页面重新可见时，调用 TypeScript reminder core 重建 absolute-time plan；持久 handled key 会在刷新 Rust scheduler 前排除。
- Rust 不读取 Course 或重算教学周/日期。它保留单 worker/channel 模型，并以最长一分钟的阻塞等待复核 wall-clock，处理应用存活期间的休眠、唤醒和明显系统时间跳变，不使用 busy polling。
- handled 记录在后续写入时删除超过 400 天的历史；已处理 occurrence 不会再成为未来课程实例。

## 自动验证

- TypeScript：105 项 unit PASS，覆盖重启后 future/catch-up、已处理 key 排除、稳定 occurrence identity 与同时课程。
- Architecture：39 项 PASS，确认 React 仍只经 services 调用 Tauri，core 保持纯逻辑。
- UI：297 个场景中 282 PASS、15 个既有条件 skip。
- Rust：28 项 PASS，覆盖 0→4、1→4、2→4、3→4 migration，future schema 拒绝、handled 幂等/清理、due 后 persistence failure、catch-up、already-started、same-trigger 与 session 去重。
- `npm run verify`、`cargo fmt -- --check`、`cargo clippy --all-targets -- -D warnings` 均 PASS。

## Desktop 验收

- 真实 Tauri Windows 独立窗口将既有 AppData 数据库自动从 schema 3 升级到 4。
- 短时 due 计划已产生 notification delivery attempt 并写入 handled key；关闭进程后重新启动，key 仍存在且从重建计划中排除，另一条未来计划继续正常等待并在到期后写入 handled。
- 窗口标题、响应和 scheduler 状态正常，Rust 日志无 panic 或 notification adapter error。
- 未强制让开发机进入系统睡眠。以真实 Tauri 的恢复订阅和 Rust 可控 clock-recheck seam 验证 wake 前、catch-up window、课程已开始、已处理和 time-jump 路径；一分钟 wall-clock 复核是运行中窗口未产生恢复事件时的安全上限。
- 本地 NSIS 包重新构建、安装并运行；安装态应用仍能对短时 due 发送 notification delivery attempt 并写入 handled key。验收后已卸载测试应用并清理临时 handled 记录。

## 已知边界

- 这是运行中应用的提醒系统。完全退出后不会作为后台服务持续计时；下次启动会重建 future/catch-up 计划。
- 正常条件下 handled 跨重启去重；若 notification attempt 后 SQLite handled 写入失败，当前 session 仍不重复，但下一次重启可能再尝试一次。系统不宣称 exactly-once。
- 不创建 Windows Service、托盘或自启动。
