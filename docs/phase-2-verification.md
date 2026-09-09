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

## Phase 2.2：PASS

本阶段只实现已有用户课程的编辑和删除。SQLite、迁移、数据文件、导入、提醒及其他后续能力均未进入。

### 实现与保护

- 用户课程卡片显示带课程名的可访问编辑按钮；fixture 卡片不渲染编辑或删除入口，正常 UI 无法改变测试数据。
- Phase 2.1 的 `CourseForm` 同时支持添加和编辑。编辑时预填名称、教师、教室、星期、时间和压缩后的周数文本；保存继续调用 `validateCourseInput`，并将原课程 ID 传入校验边界，因此不会生成新 UUID。
- 编辑保存按 ID 替换内存记录，星期、时间或周数变化后现有 `layoutCourses` 立即重新布局。当前测试周不在新周数集合时课程从视图隐藏，但记录没有被删除。
- 编辑取消不写状态。删除操作基于 Course ID，先显示包含课程名的应用内确认区域；“保留课程”零修改，确认后才移除记录。
- 删除重叠课程后布局重新计算，剩余课程从两 lane 恢复为 lane 0 / laneCount 1。

### 自动验证

| 检查 | 结果 |
| --- | --- |
| npm run typecheck | PASS |
| npm run test:unit | PASS，64 项 |
| npm run test:arch | PASS，26 项 |
| npm run test:ui | PASS，171 场景中 165 项通过、6 项按既有条件跳过 |
| 编辑流程 | PASS，预填、名称/星期/时间修改、ID 保留、120px 偏移、90px 高度及旧位置清理均有断言 |
| 编辑边界 | PASS，空名称、倒置时间、轴外时间、非法周数均阻止保存；取消后原 ID 和完整可访问文本不变 |
| 删除流程 | PASS，确认显示、取消零修改、按 ID 删除及 overlap lane 回收均有断言 |
| fixture 保护 | PASS，fixture 卡片操作按钮数量为 0 |
| npm run lint / format:check | PASS |
| npm run build / verify | PASS，生产构建 28 个模块 |

### 真实 Windows Tauri 验收

两次实际执行 `npm run tauri dev`。通过类名 `Tauri Window`、标题“大学课程表”和项目 exe 路径确认真实独立窗口；本机 DPI 为 192（200%），验收直接连接该窗口的 Tauri WebView，不以独立浏览器替代。

首次运行先添加“机械设计基础”：周三、14:00–15:30、1–16 周、JX02-407、测试教师。随后从用户卡片进入编辑，周数正确预填为 `1-16`；改为“机械原理”、周四、09:00–10:30、JX03-201 后保存。原周三卡片消失，新卡片 ID 与编辑前 UUID 完全一致，相对 07:00 的 top 为 120px、高度为 90px。通过应用内确认删除后，用户课程数量为 0，页面和控制台错误均为空。

真实窗口经标准 `WM_CLOSE` 正常退出。第二次启动后用户课程仍为 0，符合 Phase 2.2 内存状态边界；随后再次正常关闭应用。

## Phase 2.3：PASS

本阶段只实现 SQLite 与用户课程持久化，没有进入 Phase 2.4 或任何导入、提醒、自启动功能。

### 数据库设计与错误边界

- 选择 Rust `rusqlite 0.40.2` + bundled SQLite；Tauri 2.11.5 通过四个受限 command 提供 CRUD，前端 `course-storage` service 是唯一 Tauri API 调用者。没有 ORM，也没有允许 React 执行任意 SQL。
- 路径由 `app.path().app_local_data_dir()` 获取。实机确认数据库位于 Windows 用户本地应用数据目录下的 `com.ntu-course-assistant.desktop/courses.sqlite3`；未写入源码、安装或当前工作目录，绝对用户名路径不写入公开文档。
- schema 只有 `courses` 表，id 为主键；teacher/classroom/start_period/end_period 保留 null；weekday、节次和文本长度有约束；时间以 HH:mm 文本保存；weeks 为 JSON 数字数组。
- SQLite `user_version=1` 记录版本。0→1 migration 在事务中创建表并更新版本；高于支持版本会拒绝打开且不修改文件。使用 WAL、外键检查和 3 秒 busy timeout。
- Rust 在写入前校验 Course，加载逐行解析 JSON 并校验。异常行记录内部错误、跳过并向 UI 返回概括提示，数据库原值不变。初始化失败时应用继续打开但禁用添加；INSERT/UPDATE/DELETE 失败时表单显示错误且 React 状态保持原值。
- 正式构建不显示 fixture；fixture 从未传给 storage service。非 Tauri 的 Vite 开发测试使用独立内存 adapter，Tauri 运行始终调用 SQLite。

### 自动验证

| 检查 | 结果 |
| --- | --- |
| npm run typecheck / test:unit | PASS，64 项 TypeScript 单元测试 |
| npm run test:arch | PASS，28 项；React 不含 SQL/Tauri 调用，core 不依赖存储 |
| npm run test:ui | PASS，189 场景中 183 项通过、6 项按既有条件跳过 |
| UI 存储错误 | PASS，更新/删除失败保留原卡片并显示明确错误；轴外损坏记录跳过且时间轴继续运行 |
| cargo test | PASS，7 项；migration、insert/load、null、1–16 周、update、delete、损坏 JSON、未来版本拒绝及文件关闭重开均覆盖 |
| cargo fmt --check | PASS |
| cargo clippy --all-targets -- -D warnings | PASS |
| npm run lint / format:check | PASS |
| npm run build / verify | PASS，生产构建 31 个模块 |

### 真实 Windows Tauri 持久化验收

四轮实际执行 `npm run tauri dev`，每轮均运行项目 exe 的 `Tauri Window` 独立窗口；本机 DPI 为 192（200%）。WebView 检查直接连接真实 Tauri 页面，并额外调用 Rust `load_courses` 核对数据库内容。

1. 首次自动创建 schema 1 数据库。添加“机械设计基础”、周三、14:00–15:30、1–16 周、JX02-407、测试教师；Rust 读取结果包含生成的 UUID、完整 1–16 数组以及 null 节次。
2. 正常关闭并重启，原课程存在。编辑为“机械原理”、周四、09:00–10:30、JX03-201；数据库返回相同 UUID，UI top=120px、height=90px。
3. 再次正常关闭并重启，编辑结果完整保留。应用内确认删除后，UI 与 `load_courses` 均找不到该 ID。
4. 再次正常关闭并重启，已删除 ID 仍不存在。最后通过标准 `WM_CLOSE` 正常退出。

数据库文件保留在应用数据目录，测试课程最终已删除，schema 和空数据库继续保留供下次运行。项目进程、Vite 1420 和 WebView 调试 9223 端口均在验收后清理。

## Phase 2.4 与 Phase 2 总验收：PASS

本阶段只收尾持久化健壮性、恢复验证与 Phase 2 总验收，没有增加业务功能，也没有进入 Phase 3。

### 数据库健壮性

- 从数据库文件完全不存在开始启动真实应用，自动创建目录、数据库、`courses` 表和 `user_version=1`；首次读取为 0 门用户课程，界面可正常添加。
- 独立数据库验证连接关闭与重开后数据一致。mixed-record 测试同时保存合法记录、轴外合法记录、非法 weeks JSON、非法 weekday、非法时间和无法解码为文本的字段；四条坏记录逐条跳过，合法记录继续加载，六条原始记录均留在数据库。Rust 日志包含各行具体原因，UI 只显示概括提示。轴外记录由前端布局边界跳过且不修改数据库。
- `user_version=2` 的独立数据库被拒绝打开；再次检查仍为版本 2，预置 sentinel 数据不变，没有覆盖、降级或删除。界面显示“数据库来自较新版本，请升级应用后重试”，应用不崩溃且添加入口禁用。
- 独立连接以 `BEGIN IMMEDIATE` 持有写锁。应用连接保留 3 秒 busy timeout，写入明确失败且不 panic；释放锁后原课程仍是唯一记录。
- UI 自动测试分别注入 INSERT、UPDATE、DELETE 失败；添加不出现伪课程，编辑保留原卡片，删除保留原课程。初始化/加载失败时应用继续显示七天时间轴并禁止写入。
- fixture 未经过 storage service，正式构建中不存在测试课程；migration、CRUD 与恢复测试均只处理用户课程。

### 自动验证

| 检查 | 结果 |
| --- | --- |
| npm run typecheck | PASS |
| npm run test:unit | PASS，64 项 |
| npm run test:arch | PASS，28 项 |
| npm run test:ui | PASS，207 场景中 201 项通过、6 项按既有条件跳过 |
| npm run lint / format:check | PASS |
| npm run build | PASS，31 个模块 |
| npm run verify | PASS |
| cargo test | PASS，9 项 |
| cargo fmt --check | PASS |
| cargo clippy --all-targets -- -D warnings | PASS |

### 真实 Windows Tauri 总验收

先确认项目进程、Vite 1420 和 WebView 调试 9223 端口均为空，将原 AppData 数据库及 WAL/SHM 精确备份后，使正式数据库路径完全不存在。随后四次实际执行 `npm run tauri dev`；每次均为项目 exe 的 `Tauri Window` 独立窗口，标题“大学课程表”，不是独立浏览器。

1. 首次启动日志确认在 Windows Local AppData 自动创建 `courses.sqlite3`（schema 1）；Rust `load_courses` 返回 0 门，界面可用。
2. 添加“机械设计基础”、周三、14:00–15:30、1–16 周、JX02-407、测试教师；关闭重启后课程及生成的 UUID 完整恢复。
3. 编辑为“机械原理”、周四、09:00–10:30、JX03-201；ID 保持不变，top=120px、height=90px。再次关闭重启后修改仍存在。
4. 应用内确认删除；再次关闭重启后 UI 与 Rust `load_courses` 均确认该 ID 不存在。

四轮均经标准 `WM_CLOSE` 正常退出。验收结束后项目进程和两个端口为空，Phase 2.4 测试库移出正式位置，原数据库及 WAL/SHM 已完整恢复。

Phase 2.1–2.4 全部满足验收条件，项目状态正式记为 **Phase 2 PASS**。停止等待用户确认，不进入 Phase 3。
