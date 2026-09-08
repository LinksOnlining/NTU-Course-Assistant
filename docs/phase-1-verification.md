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
