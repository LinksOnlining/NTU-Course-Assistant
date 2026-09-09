# Phase 1 总验收：PASS

日期：2026-09-09。Phase 1.1–1.4 全部完成；停止等待用户确认 Phase 2。

## Phase 1.4 UI 优化

- 顶部区域明确区分应用名称、桌面原型、测试教学周和测试数据说明；界面不会把 fixture 课程表示为真实南通大学安排。
- 课程位置和高度公式未改。正常卡片保持课程名、时间、教室、教师层级；少于 75 分钟隐藏教师，45 分钟及以下只显示课程名和时间，完整文本仍在 `title` 和 `aria-label`。
- lane 核心算法未改。lane 0–2 使用三种固定、低饱和度色彩区分；卡片焦点、边界和阴影增强，未引入随机配色或主题系统。
- 时间轴固定为稳定宽度；首末小时文字锚定在轴内；小时和半小时网格共同解释大段空闲。`.timetable-scroll` 仍是唯一滚动容器，页面本身无纵横溢出。
- 小字号时间轴文字和卡片次要信息经 WCAG 对比度公式复核，分别约为 5.03:1 和 4.93:1；系统字体、键盘焦点、完整 `aria-label`/`title` 均保留。
- Tauri 默认尺寸保持 1280×800；最小尺寸配置从 640×480 调整为 720×520，以容纳顶部信息和可操作的横向课程表。

## 最终自动验证

| 检查 | 结果 |
| --- | --- |
| npm run typecheck | PASS |
| npm run test:unit | PASS，39 项，0 失败/跳过 |
| npm run test:arch | PASS，23 项，0 失败/跳过 |
| npm run test:ui | PASS，81 场景中 75 项通过，6 项只在非 900 宽度按条件跳过 |
| 尺寸/缩放矩阵 | PASS，1280×800、1000×700、900×600 分别覆盖 deviceScaleFactor 1、1.25、1.5，共 9 组 |
| UI 几何 | PASS，top、height、240 分钟空闲、七天固定列、周过滤、overlap lane、短课 45px、首末刻度、单滚动容器及 sticky 均有断言 |
| npm run lint | PASS，oxlint `--deny-warnings` |
| npm run format:check | PASS，Prettier 3.9.6 |
| npm run build | PASS，TypeScript + Vite，24 个模块 |
| npm run verify | PASS，包含全部 typecheck/test/lint/format/build |
| cargo fmt --manifest-path src-tauri/Cargo.toml --check | PASS |

## 真实 Windows Tauri 验收

`npm run tauri dev` 完成 Rust dev 构建并运行 `src-tauri\\target\\debug\\ntu-course-assistant.exe`。本轮按类名 `Tauri Window` 和标题“大学课程表”精确定位真实窗口，避免把同进程的 `Tao Thread Event Target` 辅助窗口误作产品窗口。

宿主 `GetDpiForWindow` 为 192，即 Windows 200% DPI。真实窗口客户区依次调整并读回为 1280×800、1000×700、900×600；三种尺寸均保持响应。最大化状态为 true，恢复后回到 900×600；最小化状态为 true，再恢复后回到 900×600。最终向真实 Tauri 窗口发送标准 `WM_CLOSE`，项目 exe 在 5 秒内正常退出，开发会话随之结束。

本次仅对该进程设置 WebView2 本地调试端口并连接其唯一页面 `http://localhost:1420/`，直接验证真实桌面 WebView，而非另开浏览器代替。900×600、DPR 2 下得到：

- CSS 视口 900×601，七个星期列存在，页面本身无双滚动条；
- `.timetable-scroll` 为 1140×946 内容、862×444 客户区，纵横方向均可滚动；
- 设置 `scrollTop=300`、`scrollLeft=220` 后读回一致；
- sticky 星期表头纵向误差 0，sticky 时间轴横向误差 0；
- 滚动前后截图确认标题无裁切、课程卡片无溢出、横向滚动可到周日、纵向滚动可到晚间课程；
- 控制台和 pageerror 均为空，Vite 未出现 EBUSY。

Rust 保留既有 `linker_messages` 非阻断警告；它只报告 MSVC 创建库/对象文件，编译与窗口运行正常。真实桌面检查过程中曾发现 Windows 进程辅助窗口会干扰 `MainWindowHandle`，最终证据均使用精确的 Tauri 窗口句柄重测，早期无效截图和错误断言未计为 PASS。

## Phase 1 产品状态

当前产品是可在 Windows 11 独立运行的课程表桌面原型，具备最小 Course 模型、严格时间计算、七天显示、07:00–22:00 时间轴、真实时间比例、空闲时段、重叠分栏、短课降级和小窗口滚动。当前课程及作息均为测试数据。

尚不具备用户真实课程、保存、添加/修改/删除、PDF 或教务系统导入、提醒、自启动、托盘、云同步、账号系统和正式安装包。这些不属于 Phase 1，未以占位实现提前进入 Phase 2。

---

# Phase 1.3 七天课程表时间轴 UI：PASS

日期：2026-09-09。仅完成 Phase 1.3；停止等待用户确认 Phase 1.4。

## 实现范围

- `src/core/timetable-layout.ts` 的 `layoutCourses` 按当前教学周过滤，固定返回周一至周日七组数据；同一天按开始/结束时间稳定排序，并为重叠及链式重叠课程分配横向 lane。返回值仍是分钟几何，不包含 DOM 或 CSS。
- `Timetable`、`TimeAxis`、`DayColumn`、`CourseCard` 负责渲染 07:00–22:00 测试时间轴。课程卡片 `top = offsetMinutes × pxPerMinute`，`height = durationMinutes × pxPerMinute`；数组顺序和节次不参与位置计算。
- 页面只有 `.timetable-scroll` 一个双向滚动容器。星期表头使用 `position: sticky; top: 0`，时间轴使用 `position: sticky; left: 0`；900×600 时七列保持最小宽度并横向滚动。
- `src/fixtures/courses.ts` 覆盖早/中/晚、10:00–14:00 四小时空闲、相邻、重叠链、超长中文标题、空星期、周一和周日。配置及页面均明确标注为测试数据，不代表南通大学正式课表或作息。
- 课程卡片优先显示课程名、时间、教室、教师；长标题两行截断，完整内容保留在 `title` 和 `aria-label`。未加入正式交互、当前时间线或 Phase 2 功能。

## 实际检查

| 检查 | 结果 |
| --- | --- |
| npm run typecheck | PASS，应用和无 DOM core 双重 TypeScript 检查 |
| npm run test:unit | PASS，39 项，0 失败/跳过；新增七列周过滤、真实分钟几何和重叠链 lane 测试 |
| npm run test:arch | PASS，23 项，0 失败/跳过；core/types/config 边界保持纯逻辑 |
| npm run test:ui | PASS，16 项，2 项按非小视口条件跳过；三组项目总计 18 场景 |
| 1280×800 / 100% | PASS，七列、分钟定位、4 小时留白、重叠、长标题、sticky 滚动及控制台无错误 |
| 1280×800 / 125% | PASS，同上 |
| 900×600 / 150% | PASS，同上，并确认 `scrollWidth > clientWidth`、单列宽度至少 149px |
| npm run lint | PASS，oxlint 1.82.0，`--deny-warnings` |
| npm run format:check | PASS，Prettier 3.9.6 |
| npm run build | PASS，TypeScript + Vite 8.2.2，24 个模块；无控制台报错或资源 404 |
| npm run verify | PASS，串联 typecheck、unit、architecture、UI、lint、format 和 build |
| npm run tauri dev | PASS，Rust dev profile 完成并运行 `target\\debug\\ntu-course-assistant.exe`；Vite 未出现 EBUSY |
| 真实 Windows 独立窗口 | PASS，项目 exe 进程 PID 1948，窗口标题“大学课程表”，MainWindowHandle 非零，Responding=True；不是浏览器进程 |
| React HMR | PASS，在运行中的桌面开发会话临时修改并恢复 `App.tsx`，Vite 两次记录 `hmr update /src/App.tsx`，应用进程持续存活 |

Playwright 使用本机 Edge 的真实 CSS 布局引擎核对像素几何。900×600 项验证小窗口横向滚动策略，1280×800 项验证常规窗口；真实 Tauri 回归另行启动项目 exe，因此浏览器验证没有替代 Desktop PASS。桌面控制接口本轮未提供原生窗口表面，桌面存在性以项目 exe、窗口句柄、标题、响应状态和同一开发会话 HMR 交叉确认。

首次从隔离的非登录 PowerShell 启动时，`cargo` 不在该进程 PATH，命令在编译前退出。将本机既有 `%USERPROFILE%\\.cargo\\bin` 仅加入当前命令会话后重新执行成功；没有安装/删除 Rust、修改系统安全设置或持久环境变量。Rust 仍输出既有 `linker_messages` 非阻断警告。

---

# Phase 1.2 最小模型与时间计算：PASS

日期：2026-09-09。仅完成 Phase 1.2；停止等待用户确认 Phase 1.3。

## 实现范围

- src/types/course.ts：Course 继承 TimeRange，字段 readonly；沿用 classroom 命名，教师/教室可为 null，weekday 为 1–7，weeks 是只读数字数组。没有 UI、数据库或 PDF 字段。
- src/core/time.ts：timeToMinutes、offsetMinutes、durationMinutes、idleMinutes、timeRangesOverlap。
- src/core/timetable-layout.ts：courseTiming 返回分钟偏移/持续量；coursesOverlap 结合相交时间、相同星期及共同周数。
- src/config/timetable.ts：显式 test-only 轴与两条测试节次。像素缩放与正式学校配置尚未实现。
- 时间异常策略：严格 00:00–23:59，不接受缩写、空白或秒；零长度、倒置和跨午夜区间抛 RangeError。offsetMinutes 保留负偏移；courseTiming 对超出轴范围的课程报错，要求后续调用方扩展时间轴。idleMinutes 是有方向的非负空闲量，重叠/逆序返回 0，重叠另由独立函数判断。

## 实际检查

| 检查 | 结果 |
| --- | --- |
| npm run typecheck | PASS，应用及类型反例检查；tsconfig.core.json 不提供 DOM/Node 全局类型 |
| npm run test:unit | PASS，36 项，0 失败/跳过 |
| npm run test:arch | PASS，23 项，0 失败/跳过 |
| npm run build | PASS，TypeScript 与 Vite 构建 |
| npm run verify | PASS，统一包含上述 build + unit + architecture；格式调整后完整重测 |
| Prettier 3.6.2 --check | PASS，src/core、types、config、tests 及修改的 JSON 配置；通过 npm exec 使用，不新增生产依赖 |
| lint | N/A，原工程无 lint 命令；本次以严格类型与 AST 架构检查验证核心边界 |
| npm run tauri dev | PASS，重新启动后 Rust dev 编译完成（16.51 秒），运行 target\debug\ntu-course-assistant.exe |
| 真实独立桌面窗口 | PASS，Computer Use 窗口 id 198634；进程为项目 exe，截图和可访问性文本均显示原“大学课程表”空壳 |
| UI/CSS/Vite/Rust 代码回归范围 | 本轮未修改这些文件；保留 Phase 1.1 watcher 修复，未出现 EBUSY |

单元测试覆盖 00:00/07:00/08:00/12:30/14:30/23:59、60 分钟偏移、45 分钟持续、240 分钟空闲、相邻/重叠/包含/相同区间、跨星期和无共同周数、轴边界及无效输入。输入对象可冻结，函数不修改调用方数据。

架构测试使用 oxc-parser 0.149.0 解析 AST：检查实际 core/types/config 及违规反例，拒绝 React/Tauri/Node 依赖、动态导入、跨层导出、环境全局和 any，允许纯类型契约和同 core 层组合。它是保守的工程边界守卫，不是任意恶意代码的安全沙箱。采用该开发依赖是因为本机 TypeScript 7 包没有旧版 createSourceFile API；未引入生产依赖或完整 lint 框架。

## 发现问题与恢复

首次重新启动时，上一阶段开发会话仍占用 1420，导致新 Vite 启动失败。窗口 UI 关闭调用未成功，于是终止已知旧工具会话并重新执行 npm run tauri dev，成功打开新窗口。没有杀死其他项目进程或修改端口来掩盖问题。

Rust 保留既有 linker_messages 非阻断警告；单元、架构、类型与构建检查均实际通过。Course 的完整外部数据校验属于未来录入/导入边界，本阶段只做类型契约与时间运行时校验，不能声称已支持导入。

---

# Phase 1.1 桌面验证：PASS

日期：2026-09-09。严格限于 Phase 1.1；停止等待确认，不进入 Phase 1.2。

## 根因与最小修复

Vite 默认从项目根目录监听，原配置未排除 Rust 的 target。Windows 在构建、加载 DLL 时可能锁定文件，Vite watcher 因 EBUSY 崩溃。Git ignore 不能替代 Vite watcher 配置。

vite.config.ts 的 server.watch.ignored 显式排除：

- **/src-tauri/target/** 与 **/target/**
- **/src-tauri/gen/**（生成的 Tauri schema）
- **/node_modules/**、**/dist/**、**/.git/**
- **/.local/**（本机临时文件、安装器及样本图）

没有关闭文件监听、HMR 或修改系统安全设置；src 前端源码仍正常监听。配置依据：[Vite server.watch](https://vite.dev/config/server-options.html#server-watch)。

首次重试 Rust 已继续编译至应用，随后报 icons/icon.ico 缺失；补齐原创简单日历 icon.ico/icon.png 后重试成功。除上述监听配置、必要图标和文档外，未增加产品功能。Cargo.lock 是本阶段实际解析出的依赖锁文件。

## 本轮真实验收

| 检查 | 结果与证据 |
| --- | --- |
| npm run build | PASS，TypeScript + Vite 8.2.2；HMR 测试恢复源文件后再次 PASS |
| npm run tauri dev | PASS，Rust dev profile 编译完成（成功重试 20.69 秒），Running target\debug\ntu-course-assistant.exe |
| Rust 输出期间 Vite | PASS，未再出现 EBUSY，编译后仍运行并响应 HMR |
| watcher 实际目录 | PASS，使用项目 Vite createServer + getWatched 检查 8 个监听目录；src 在内，target/node_modules/dist/.git/.local/src-tauri/gen 均不在内 |
| Windows 独立窗口 | PASS，Computer Use 返回进程路径为项目 src-tauri\target\debug\ntu-course-assistant.exe，窗口标题“大学课程表”，窗口 id 132578；置前截图可见标题及工程验证文字 |
| React HMR | PASS，将 src/App.tsx 中“课程表正在准备中。”临时替换为“前端热更新验证成功。”；00:05:55 日志 hmr update /src/App.tsx，同一桌面窗口截图显示新文字 |
| 恢复测试修改 | PASS，00:06:14 日志再次 HMR；同一桌面窗口显示原文字，App.tsx 与测试前字节内容一致 |
| cargo fmt --manifest-path src-tauri/Cargo.toml --check | PASS |
| Git 差异检查 | PASS，无空白错误；输出及本机样本目录保持忽略 |

这是 Desktop PASS，浏览器检查不作为此次桌面验收替代。未测试安装包/release 发布，也没有完成整个 Phase 1。

编译有一条 linker_messages warning：MSVC 输出正在创建库和对象文件，Rust 将其作为链接器消息警告显示；不是编译失败，未抑制警告。

## 当前运行方式

在项目目录执行 npm run tauri dev。若当前终端未包含 Rust 路径，将用户 .cargo/bin 加入当前会话 PATH。本机 C++ 工具链已通过实际编译，不再需要按旧记录重复安装。

## 历史记录（2026-09-08，以下阻碍已解决）
# Phase 1.1 验证记录

日期：2026-09-08。用户“继续你的工作”作为 Phase 1 确认。本小阶段仅建立空壳，不能因环境阻碍提前实现后续小阶段。

| 检查 | 实际结果 |
| --- | --- |
| PDF 打开、中文提取、两页渲染 | PASS，pypdf/pypdfium2，人工核对见样本记录 |
| npm install | PASS，26 包，审计报告 0 漏洞 |
| npm run build | 首次缺少 CSS 类型声明，添加 vite/client 引用后重测 PASS |
| 浏览器空壳冒烟 | PASS，工作区 Playwright + 本机 Edge，1280×800，标题显示，无 pageerror |
| 默认 Playwright Chromium | 未安装，改用本机 Edge 后完成同等检查 |
| Rust 安装 | PASS，stable 1.98.1 MSVC，未持久修改 PATH |
| cargo fmt --manifest-path src-tauri/Cargo.toml --check | 首次缺 rustfmt，安装 rustfmt/clippy 后 PASS |
| tauri info | Rust/WebView2 通过；缺 Visual Studio/MSVC/SDK |
| 最小 Rust 程序编译 | FAIL：link.exe not found，证实系统链接器缺失 |
| C++ Build Tools 安装 | 自动审批拒绝：blocked by policy；未安装成功 |
| Tauri build/check/clippy/桌面运行 | 未执行，链接器前置检查失败 |
| 时间轴/业务测试 | N/A，尚未进入 Phase 1.2/1.3 |
| 阶段结论 | 未 PASS，保留 Phase 1.1，等待环境修复 |

npm 精确版本来自 registry 查询并由 package-lock.json 锁定；Cargo 依赖未解析，尚无 Cargo.lock。环境修复后生成锁文件并完成构建。静态空壳未调用 Tauri API，不安装未使用的 API 包或系统插件。安装包暂关闭，宿主验证后再配置图标和发布产物。

## 恢复步骤

1. 安装 [Microsoft C++ Build Tools](https://aka.ms/vs/17/release/vs_BuildTools.exe)，选择 C++ 桌面开发及 Windows SDK。本次安装被自动审批阻止，需要用户完成。
2. 当前 PowerShell 会话将用户 .cargo/bin 加到 PATH，运行 npm run tauri info 确认工具链。
3. 执行前端和 Rust 检查、Tauri 构建、真实桌面启动，修复问题并记录实际结果。
4. 桌面空壳 PASS 后再开始模型和时间轴，本轮不宣布 Phase 1 完成。

临时安装器、PDF 页面图和编译探针在被 Git 忽略的 .local 中；dist、node_modules、Tauri target/gen 均忽略。原 PDF 保持原位。本轮未达到稳定小阶段，未提交 Git。
