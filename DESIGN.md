# 基础设计（Phase 0 提议）

实施状态（2026-09-09）：Phase 1.1 工程空壳已通过真实桌面运行与 HMR 验证，停止等待用户确认 Phase 1.2。下述 Course、时间轴、存储和导入设计仍未实现。真实 PDF 检查见 docs/pdf-sample-review.md；该文件没有实际钟点，需要经确认的作息配置。

## 技术方案

采用 Tauri 2 + React + TypeScript + Rust，Vite 构建前端、npm 管理前端依赖。选择基于 Windows 11、时间轴 UI 开发效率和本地系统集成需要。采用系统 WebView2，安装包与内存优势是选型预期，具体体积、CPU、内存必须由实际构建测量，不承诺数字。

Rust 仅负责桌面宿主及必要系统 IO；不引入服务器、全局状态库、UI 大组件库或 ORM。相比 Electron，该选择符合复用系统 WebView 的方向；相比切换 C#/WinUI，保留用户优先评估的 Web UI 技术栈，避免同时改变语言和 UI 开发方式。代价是维护 TypeScript/Rust 两套工具链。

Phase 1 仅内存测试数据。Phase 2 使用 SQLite 本地文件，少量表与事务，Rust 存储边界提供受限 CRUD 命令；React 不拼 SQL。选择 SQLite 是为了后续导入批量写入的事务性，不是为了建立复杂数据库。数据库放应用数据目录，不放安装目录或 Git 仓库。

PDF.js 是 Phase 3 文本型 PDF 提取候选，需真实南通大学样本验证；它不等于课程识别器。学校规则单独解析文本和位置。扫描件首版提示暂不支持，不假装识别成功。当前不安装 PDF 依赖。

## 职责和数据流

React UI → 纯课程/时间轴逻辑；需要外部能力时通过 adapters → Tauri Rust → 本地存储/系统功能。

未来导入：PDFImporter / NTUImporter → ImportCandidate[] + 字段异常 → 统一校验 → 预览及修正 → 用户确认 → Course[] → 存储事务。

ImportCandidate 可以缺字段，携带原文、来源位置和问题列表；Course 是已通过校验的正式记录。取消预览不写库，存在阻断异常的行不得静默写入。首版拟只允许全部待导入行通过后确认；部分导入需用户显式选择有效行。

统一是数据契约统一，不是把不同来源强行写成同一种解析器；不建设通用插件框架。

## 最小 Course 模型

以下为文档契约，尚未创建 TypeScript 源文件。

```ts
interface Course {
  id: string;
  name: string;
  teacher: string | null;
  classroom: string | null;
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  startPeriod: number;
  endPeriod: number;
  startTime: string; // HH:mm，当地墙上时间
  endTime: string;   // HH:mm
  weeks: number[];  // 明确周数，例如 [1, 3, 5]
}
```

一条 Course 表示同名课程的一个固定上课安排。同一课程星期、时段或教室不同则分成多条，不增加课程目录/教学班等实体。单双周归一化为明确周数。

校验：id 唯一、名称非空；节次为正整数且起始不大于结束；时间格式有效且开始早于结束；星期在 1–7；周数非空、正整数、去重排序，并在学期周数配置范围内。首版不支持跨午夜课程。教师/教室确实未知使用 null 并提示，不能编造；时间、星期、周数不确定则留在导入候选中。

独立配置：TermConfig（第一教学周周一日期、总周数、时区 Asia/Shanghai），PeriodTime[]（节次、HH:mm 开始/结束）。尚未核实的学校作息绝不作为官方默认值。Phase 1 仅明确标注的测试配置和测试教学周。

节次仅作为来源信息；展示和提醒使用已确认的实际时间。仅有节次时通过已确认作息映射；来源同时给出节次与时间而冲突时提示用户核对，不静默覆盖。修改作息不暗中改动已有课程时间，后续需要显式预览受影响课程。

## 时间轴布局

七列对应周一至周日，垂直轴连续按分钟计算。top = (开始分钟 - 轴起点分钟) × 每分钟像素；height = (结束分钟 - 开始分钟) × 每分钟像素。课间、午休不压缩、不折叠。

同一天且教学周交集非空、时间区间重叠才算冲突；边界相接不是冲突。重叠安排在对应时段并排显示并提示，避免遮挡。短课不通过提高卡片最小高度破坏比例，完整信息可通过聚焦/点击查看。

优先课程名和时间，其次教室、教师。采用基础 CSS、系统字体、克制的色彩、清晰边界和键盘焦点。小窗口允许日列横向滚动和时间轴纵向滚动，不能挤到文字不可读。

## 后续系统功能约束（仅设计）

提醒在 Rust 侧调度，不能仅依赖 WebView 计时器；Phase 5 引入必要托盘驻留及单实例，退出程序后不承诺提醒。按学期日期、周数、星期、真实时间计算提前 15 分钟，重启去重，唤醒后重算且不提醒已结束课程。不设计关机唤醒服务。

Windows 通知必须在实际安装的应用中验收；开发态不能代表正式身份及图标。自启动 Phase 6 默认关闭，用户启用后按当前用户登录启动，读取系统实际注册状态；不创建系统服务。

教务系统数据可行性未知；Phase 4 先查公开官方入口和可合法获得的数据，再研究用户已登录页面导出、HTML/JSON。不能假设应用可直接读取任意浏览器 Cookie。

## 选型依据（2026-09-08 核查）

- [Tauri Windows 前置条件](https://v2.tauri.app/start/prerequisites/)：Rust、Microsoft C++ 工具与 WebView2。
- [Tauri 通知](https://v2.tauri.app/plugin/notification/)：Windows 安装态限制。
- [Tauri 自启动](https://v2.tauri.app/plugin/autostart/)：启用、关闭、状态查询能力。
- [PDF.js](https://mozilla.github.io/pdf.js/)：PDF 解析与渲染候选。
