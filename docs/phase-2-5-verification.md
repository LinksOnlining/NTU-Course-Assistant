# Phase 2.5 验证记录

日期：2026-09-09。状态：**PASS**。

本阶段只增加节次配置、纯映射和时间轴信息表达，没有实现 PDF、教务导入、提醒、自启动、托盘或安装包。

## 实现边界

- `PeriodTime` 保持纯类型；`TEST_PERIOD_TIMES` 明确标记为 test-only，补齐第 1–11 节，不代表南通大学正式作息。
- `src/core/period-time.ts` 提供配置校验、单节映射、节次范围转时间范围和时间范围精确反查。节次必须为正整数、唯一且递增；时间使用严格 HH:mm、开始早于结束、相邻节次不得重叠。正常课间合法并保留。
- 反查只接受配置边界的精确匹配。`08:00–09:35` 可映射为第 1–2 节，`08:10–09:20` 返回 null；不会近似猜测。
- TimeAxis 继续使用 07:00–22:00 连续分钟轴。节次 top 和 height 均通过真实时间与 `pxPerMinute` 计算；小时线、午休和大段空闲保持原比例。
- 卡片在 Course 已有节次时显示“第 N 节”或“第 N–M 节 · HH:mm–HH:mm”。手动添加课程仍保存 null 节次，因此只显示时间。旧 fixture 中与测试作息不一致的节次改为 null，课程实际时间和布局几何没有改变。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| npm run typecheck | PASS |
| npm run test:unit | PASS，72 项 |
| npm run test:arch | PASS，29 项 |
| npm run test:ui | PASS，225 场景中 219 项通过、6 项按既有条件跳过 |
| UI 节次定位 | PASS，第 1 节 top=60px、高=45px；第 2 节 top=110px；第 1/2 节间隔 5px、第 2/3 节间隔 20px；第 6 节 top=420px |
| UI 几何回归 | PASS，原课程 top/height、240 分钟空闲、overlap lane、短课及七天列保持通过 |
| npm run lint / format:check | PASS |
| npm run build | PASS，32 个模块 |
| npm run verify | PASS |
| cargo test / fmt / clippy | PASS，9 项 Rust 测试；无 Rust 回归 |

首次全量 UI 回归发现末小时标签因新增兄弟元素不再命中 `last-child`。将精确选择器改为 `time:last-of-type` 后，9 组尺寸/DPI 的首末刻度、节次和 sticky 回归全部通过；没有放宽几何断言。

## 真实 Windows Tauri 验收

实际执行 `npm run tauri dev`，确认运行项目 exe 的 `Tauri Window` 独立窗口，标题“大学课程表”。直接检查真实 WebView，设备像素比为 2（200% DPI），客户区为 1280×780。

- 左侧显示第 1–11 节，每节包含开始与结束时间，文字没有水平或垂直溢出。
- 实测第 1 节 top=60px、高=45px；第 2 节 top=110px，间隔 5px；第 3 节前保留 20px 课间；第 6 节 top=420px。
- 原“机械设计基础”仍为 top=60px、height=120px，证明课程位置没有因节次 UI 改变。
- 纵向滚动 350px、横向滚动 220px 后，星期表头保持顶部 sticky，时间轴保持左侧 sticky；页面和控制台无错误。
- 通过标准 `WM_CLOSE` 正常关闭，项目进程及 1420/9223 端口均清理。

Phase 2.5 满足全部完成标准。停止等待用户确认，不进入 Phase 3。
