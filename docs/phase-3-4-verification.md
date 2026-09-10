# Phase 3.4 与 Phase 3 总验收记录

日期：2026-09-10
结论：**Phase 3.4 PASS；Phase 3 PASS**

## 完成范围

本阶段把 Phase 3.3 的 `CourseProposal[]` 接到正式确认和 SQLite 原子批量写入，完成整个 PDF 导入闭环。

- 最终确认页逐条显示名称、星期、节次、实际时间、周数、教室、教师及警告，并汇总普通、警告、重复和冲突数量。
- blocking 候选不能进入确认；warning 和真实时间冲突允许继续。返回修改保留全部候选覆盖值，整批取消清空 PDF 会话且零写入。
- `prepareImportPlan` 是纯函数：精确重复键为 name + weekday + startTime + endTime + weeks；已有课程和同批后续重复均跳过，同名但安排不同继续导入。计划顺序和结果确定，不生成 ID。
- 只为最终待写入项生成标准 UUID，并再次调用 `validateCourseInput`。失败重试保留同一批 Course 和 ID，不重复生成。
- 前端以一次 `import_courses` 调用提交整个批次。Rust 对所有 Course 复校后开启一个 SQLite transaction；任何一条失败都会回滚全部写入，成功返回实际插入的 Course[]。
- React 仅在 Rust 成功后合并返回课程；失败时课程表不变、确认页和修改内容保留，可直接重试。成功后关闭预览并显示导入及跳过数量。
- schema 未调整，`user_version` 保持 2；PDF 原文、候选来源和个人信息不写入数据库。

## 自动验证

全部执行并通过：

- `npm run typecheck`
- `npm run test:unit`：98/98 PASS
- `npm run test:arch`：37/37 PASS
- `npm run test:ui`：288 个场景，274 PASS、14 SKIP。跳过项仅为真实私有样本在非指定设备项目的条件跳过及既有设备条件；真实样本流程在 1280×800/100% 执行一次
- `npm run lint`
- `npm run format:check`
- `npm run build`
- `npm run verify`
- `cargo test`：17/17 PASS
- `cargo fmt -- --check`
- `cargo clippy --all-targets -- -D warnings`

新增或扩展的测试覆盖：

- 现有课程和批内精确重复、同名不同安排、冲突保留、稳定顺序及纯函数输入不变。
- 最终 UUID 仅为待写入项生成，重复 ID 在进入存储前失败。
- 确认页返回和取消、请求期间控件锁定、存储失败留页、课程表零变化、同批重试成功、再次导入全部跳过。
- Rust 批量成功、空批、非法 Course 零写入、唯一约束触发全批回滚，以及关闭连接后重开逐条一致。
- 架构检查确认 React 不接触 SQL，预览与 core 不调用存储，批量导入跨越一个前端 service 和一个 Rust command。

## 真实 Windows Tauri 验收

验收使用 `npm run tauri dev` 打开的真实 Windows 独立窗口。进程标题为“大学课程表”，主窗口句柄非零并持续响应；WebView2 调试连接仅操作该原生窗口中的页面，没有用独立浏览器替代 Desktop PASS。

开始前关闭应用并完整备份 AppData SQLite 主文件、WAL 和 SHM。基线为：

- `courses=0`
- `period_times=12`
- `user_version=2`
- `integrity_check=ok`

首次导入同一份两页真实样本：

- 提取并显示 18 个候选，其中固定安排 15、非固定实践 3。
- 在已保存作息下明确补齐三条实践的星期、第 6–8 节、教师和测试教室后，blocking 为 0。
- 最终计划为 18 条写入、0 条重复；统计为普通 14、警告 4、冲突 1。
- 一次确认后 `load_courses` 返回 18；当前测试第 3 周立即显示 12 张用户课程卡片，作息仍为 12 条，页面和控制台没有错误。

正常关闭并重新启动 Tauri 后：

- Rust 以 schema 2 打开同一数据库，`load_courses` 仍返回完整 18 条，当前周课程继续显示。
- 再次选择同一 PDF，并对三条实践填入完全相同的安排；最终计划显示重复 18、待写入 0、冲突 0。
- 确认后提示“已导入 0 条课程安排，跳过 18 条重复课程”，数据库仍为 18，`period_times` 仍为 12。

验收结束后正常关闭应用，恢复原始 AppData 数据库并复核 `courses=0`、`period_times=12`、`user_version=2`、`integrity_check=ok`。临时探针、自动化脚本、数据库备份和截图均已清理；真实 PDF 及其姓名、学号、全文或副本未进入 Git。

## Phase 3 总结

Phase 3.1–3.4 已完整覆盖：

1. 文字型 PDF 的页码、坐标和中文提取。
2. NTU 表格结构识别并生成 15 条固定与 3 条实践候选。
3. 用户预览、字段修正、作息映射、统一校验和无 ID 提案。
4. 最终确认、重复跳过、冲突提示、UUID、SQLite 单事务写入、失败回滚、立即显示和重启恢复。

本阶段未实现教务系统导入、提醒、自启动、托盘或安装包。下一阶段是 Phase 4；当前停止等待用户确认。
