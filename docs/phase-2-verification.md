# Phase 2 验证记录

日期：2026-09-09。

## Phase 2.1：PASS

本阶段只实现课程输入校验与添加课程。编辑、删除、SQLite、PDF、教务导入、提醒和其他后续能力均未进入。

### 实现边界

- 顶部“添加课程”打开独立表单，字段包含课程名称、教师、教室、星期、开始/结束时间和上课周数。错误显示在对应字段旁；取消关闭表单且不产生课程。
- `src/core/course-input.ts` 是外部输入转为 `Course` 的统一边界。名称 trim 后必填，教师/教室空值归一化为 null，星期限制为 1–7，时间复用 Phase 1 严格 HH:mm 与同日区间校验。
- `src/core/weeks.ts` 支持 `1-16`、`7,15`、`1-4,7,10-12`，输出 1–30 范围内排序去重的只读数字数组；0、负数、倒置范围、空段和非法字符均明确报错。
- 当前测试轴为 07:00–22:00。超出范围的课程明确提示并阻止保存，不裁切或篡改时间。
- 新课程 ID 使用标准 `crypto.randomUUID()`。没有引入依赖。用户不填写节次；在正式学校映射可用前，新增课程的节次字段为 null。
- fixture 继续保留给自动化验证，卡片以 `data-source`、可见“用户添加”标签和完整可访问名称区分来源。新增课程仅保存在 React 内存中，页面明确提示关闭后丢失。

### 自动验证

| 检查 | 结果 |
| --- | --- |
| npm run typecheck | PASS |
| npm run test:unit | PASS，63 项 |
| npm run test:arch | PASS，26 项 |
| npm run test:ui | PASS，117 场景中 111 项通过、6 项按既有非小窗口条件跳过 |
| UI 添加流程 | PASS，打开、空提交、字段错误、合法保存、正确星期、取消、长中文名均覆盖 |
| UI 几何 | PASS，新增课程 14:00 相对 07:00 为 420px，90 分钟课程高度为 90px；Phase 1 原有 top/height/240 分钟空闲/overlap/七列断言保持通过 |
| npm run lint | PASS，0 warning |
| npm run format:check | PASS |
| npm run build | PASS，28 个模块 |
| npm run verify | PASS |

### 真实 Windows Tauri 验收

`npm run tauri dev` 实际完成 Rust dev 构建并运行 `src-tauri\\target\\debug\\ntu-course-assistant.exe`。通过类名 `Tauri Window` 和标题“大学课程表”确认真实独立窗口；本机窗口 DPI 为 192（200%），未使用独立浏览器代替桌面验收。

直接连接真实 Tauri WebView 后录入：机械设计基础、周三、14:00–15:30、1–16 周、JX02-407、测试教师。保存成功，卡片来源为 user，文本完整；相对周三列顶部为 420px，高度为 90px，页面错误和控制台错误均为空。

向真实窗口发送正常 `WM_CLOSE` 后项目进程在 5 秒内退出。重新执行 `npm run tauri dev`，真实 WebView 中用户课程数量为 0，证明 Phase 2.1 当前确为内存状态且没有伪装持久化。随后再次正常关闭，1420/9223 端口及项目进程清理完毕。
