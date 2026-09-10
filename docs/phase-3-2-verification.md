# Phase 3.2 验证记录

日期：2026-09-10。状态：**PASS。**

## 实现边界

- 通用 PDF 提取与 NTU 规则分层：`src/services/pdf-import.ts` 只返回 `PdfExtraction`，`src/importers/ntu-pdf/parse.ts` 只消费提取结果并返回 `ImportCandidate[]`。
- `ImportCandidate` 允许字段缺失，保留来源页、原始清洗文本、边界和来源文本块；它不是 Course。`ImportIssue` 携带 code、field、severity 和用户可读信息，并按 code+field 稳定去重。
- 解析器至少需要三个唯一星期表头提供明确坐标证据，自动判断星期列沿 x 轴或 y 轴；证据不足时不默认猜成 x。续页可以复用前页已经确认的表头布局。
- 固定课程根据星期表头相对坐标、节次锚点、文本高度容差、来源顺序和字段标记聚类。没有使用页面绝对尺寸、浮点坐标精确相等、课程名称白名单或页码 2 特例。
- 没有固定节次的实践文本先从星期列聚类中分离，再依照独立文本块、分隔符和原始顺序生成候选。名称和周数可以保留，weekday/startPeriod/endPeriod/resolvedTime 保持 null，并带 blocking issue。
- 候选 ID 由来源信息稳定派生；同一份 `PdfExtraction` 连续解析结果完全相同。固定安排按页码、星期、节次和来源位置排序，实践按 PDF 原始出现顺序排列。
- 周数支持连续区间、单双周、离散周和实践条目中的“共 N 周”时长说明；时长说明不会被误当成实际周次。“未排地点”归一化为 null 并产生 warning。
- test-only PeriodTime 不填充 `resolvedTime`，只产生需要确认正式作息的 blocking issue。解析路径不调用 Course 校验创建、不调用 Tauri command、不读写 SQLite，也没有确认导入按钮。
- 开发坐标预览只展示页码、x/y 和文本长度；候选区展示解析后的课程字段及 issues，不展示整份原文或个人身份字段。

## 去隐私自动测试

提交的最小坐标 fixture 只包含虚构课程、虚构教师和虚构教室，覆盖 x/y 星期轴、证据不足、多行课程名、连续/单双/离散周、正常教室、未排地点、三条非固定实践和轻微坐标漂移。真实 PDF、姓名、学号和整页全文没有进入 Git。

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run test:unit` | PASS，85 项 |
| `npm run test:arch` | PASS，33 项；解析器不依赖 React/Tauri/storage |
| `npm run test:ui` | PASS，279 个场景中 273 项通过、6 项按既有条件跳过 |
| UI 候选摘要 | PASS：总数、固定/实践、ready/warning/blocking 分类和逐条字段/issues 可见；无确认导入按钮 |
| `npm run lint` / `npm run format:check` / `npm run build` / `npm run verify` | PASS |
| `cargo test` | PASS，12 项 |
| `cargo fmt -- --check` / `cargo clippy --all-targets -- -D warnings` | PASS |

## 真实样本逐字段核验

同一用户提供的两页文字型课表通过应用 PDF.js 提取和 NTU parser 验证。原始提取为 238 个块；清理两个只含用户确认无意义的黑色符号的块后，保留 236 个有效坐标文本块。隐私保护下只记录统计和与 `docs/pdf-sample-review.md` 人工基准的比较结果：

- 固定安排 15 条，非固定实践 3 条，总候选 18 条。
- 15 条固定安排的课程名、weekday、startPeriod/endPeriod、weeks、classroom 和 sourcePage 全部逐条匹配人工基准。
- 15 条固定安排的教师均从明确的“教师…/职称”字段边界提取；验证记录不保存教师姓名。
- 两条工程材料安排保持独立；离散的第 7、15 周没有展开成区间；单双周测试按奇偶正确展开；第一页和第二页没有误合并。
- 三条实践按三个独立来源文本块生成，名称及实际周数保留，星期和节次均为 null。没有按目标数量复制、硬切或通过已知课程名白名单识别。
- 同一提取结果连续解析两次完全一致；issues 没有重复字段/code 组合。
- 当前桌面使用自定义 12 节作息，但解析前后 SQLite 只读快照完全一致：`courses=0`、`period_times=12`、`user_version=2`。

## 真实 Windows Tauri 验收

实际执行 `npm run tauri dev`，Rust 编译完成并打开标题为“大学课程表”的独立 Windows 窗口。通过系统文件选择器选择同一真实课表后：

- UI 显示读取成功、2 页、236 个有效文本块和“课程表未修改”。
- 开发候选区显示 18 条，其中固定安排 15、非固定实践 3。桌面当前保存的 12 节自定义作息下为 13 条可继续、2 条仅有“未排地点”警告、3 条实践阻断；另行自动测试确认 test-only fallback 会阻止固定安排获得正式时间。
- 页面仍显示原有 fixture，用户课程保持 0；没有“确认导入”按钮。
- 解析前后 courses、period_times 和 schema 版本均未变化；Tauri 日志没有解析错误或 panic。
- 窗口通过正常关闭退出，`tauri dev` 进程成功结束。

## 尚未完成

- Phase 3.3 的用户预览、字段修正和取消流程。
- 正式 Course 创建、统一校验后的确认导入和 SQLite 写入。
- Phase 3.4 与 Phase 3 总验收。

Phase 3.2 已 PASS。按 Phase 3 Git 规则，本阶段不 commit、不 tag、不 push；工作区保留改动并停止等待用户确认，不进入 Phase 3.3。
