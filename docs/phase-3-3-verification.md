# Phase 3.3 验证记录

日期：2026-09-10
结论：**Phase 3.3 PASS**

## 范围与结果

本阶段把 Phase 3.2 的开发候选列表升级为正式预览与修正流程，只生成内存中的 CourseProposal。没有创建正式 Course，没有 insert/update/delete `courses`，也没有进入 Phase 3.4。

- 预览顶部显示总候选、固定安排、非固定实践及 ready/warning/blocking 动态统计；支持四种状态筛选。
- 每个候选显示课程名、星期、节次、实际时间、周数、教室、教师、状态及来源页/坐标；来源原文仅在当前候选的折叠区展示。
- 候选可修正名称、教师、教室、星期、开始/结束节次和周数。实际时间只读，由当前作息严格映射。
- parser 原始候选保持不变，用户保存的值位于独立覆盖层。取消单条修改零变化；取消整批导入清除 extraction、候选覆盖及提案并返回课程表。
- test-only 作息继续产生 blocking。预览内可打开作息设置；保存后同一批候选自动重算，无需重新选择 PDF。
- 三条实践允许 weekday/startPeriod/endPeriod 为 null 并保持 blocking；用户明确补齐后重新评估，不猜测字段。
- blocking 阻止“进入最终确认”；warning 允许继续。首版不允许部分导入。当前按钮只显示无写入提案摘要。

## 纯逻辑与数据契约

`src/core/import-proposal.ts` 提供：

- `applyImportCandidateEdit`：将修正覆盖到候选视图，不 mutation 原对象。
- `prepareCourseProposal`：用已确认 PeriodTime 映射节次，通过 `validateCourseInput` 统一校验，返回无正式 ID 的 CourseProposal 与动态 issues。
- `evaluateImportCandidates`：批量计算状态和统计，并检查重复、现有课程冲突及候选间冲突。

CourseProposal 只保留 `candidateId` 与已校验的课程字段，不含 `Course.id`。正式 UUID 及写入事务留给 Phase 3.4。

精确重复键为 name + weekday + startTime + endTime + weeks；同名但时间或周数不同不视为重复。重叠复用现有 `coursesOverlap`，只添加 warning，不自动合并或删除。issues 继续按 code + field 稳定去重。

## 自动验证

执行并通过：

- `npm run typecheck`
- `npm run test:unit`：94/94 PASS
- `npm run test:arch`：36/36 PASS
- `npm run test:ui`：288 个场景，274 PASS，14 SKIP；私有真实样本交互只在 1280×800/100% 项执行一次，其他设备项跳过，原有窗口/DPI 矩阵继续全跑
- `npm run lint`
- `npm run format:check`
- `npm run build`
- `npm run verify`
- `cargo test`：12/12 PASS
- `cargo fmt -- --check`
- `cargo clippy --all-targets -- -D warnings`

新增测试覆盖：确认作息提案、test-only 阻断、实践补齐、教室缺失 warning、非法候选、编辑取消、精确重复、同名不同周数、已有课程/候选冲突、确定性、预览层零存储依赖、18 条真实候选统计、筛选、作息重算、三条实践修正、warning 允许继续、最终摘要和整批取消。

## 真实 Windows Desktop

实际执行 `npm run tauri dev`，Rust 编译完成，进程具有标题为“大学课程表”的独立主窗口、非零窗口句柄且持续响应。桌面控制插件本轮没有暴露原生应用接口，因此交互验收通过 WebView2 本机调试端口连接同一个 Tauri 窗口完成；没有使用独立浏览器替代桌面应用。

真实两页样本验收结果：

- 读取后显示 18 个候选：15 条固定安排、3 条非固定实践。
- 已保存 12 节用户作息下，初始为 13 ready、2 warning、3 blocking，提案 15/18。
- 一条候选改名后取消，原名称与状态保持不变。
- 一条实践明确补齐教师、教室、周三、第 6–8 节后转为 ready，提案变为 16/18；另外两条实践仍 blocking，“进入最终确认”保持禁用。
- 整批取消后预览关闭、课程表恢复，用户课程仍为 0；WebView 没有 page error 或 console error。
- 在 Windows 200% DPI 实际截图检查中，宽屏双栏、滚动、状态色、表单和详情可读，没有溢出或遮挡。
- 验收前后数据库完全一致：`courses=0`、`period_times=12`、`user_version=2`，12 条 period/start/end 内容逐项相同。
- 使用正常窗口关闭请求退出，Tauri 与 Vite 进程均正常结束。

真实 PDF、姓名、学号、完整提取文本和临时截图未加入 Git；临时检查文件已清理。

## 阶段边界

尚未完成：

- 创建正式 Course ID。
- 最终确认后的 SQLite 事务写入。
- 导入失败回滚、重复处理策略的最终用户选择。
- Phase 3.4 与 Phase 3 总验收。

按 Phase 3 Git 规则，本阶段不 commit、不 tag、不 push。工作区保留 Phase 3 改动并停止等待用户确认。
