# Links Workplace v2.0 — Phase 1 综合验证记录

## 结论

- Phase 1 起点：`3f2d580d2423bdb19d2753023db6414b5408c546`
- 通过验证的代码 HEAD：`f840adbabb5d5674aec4605a67986a2aecda3a5c`（Quote 间距微调提交）
- 分支：`v2/workspace-rebase`
- Windows 11 Pro Visual Acceptance：**PASS**，由 Ethan / ChatGPT 真实截图复验确认。
- Phase 1.7-A：**PASS**；Phase 1 Overall：**COMPLETE**。
- 该结论只覆盖 Phase 1 架构基线、Shell、Theme、Workspace Dashboard、Timeline、Settings 与本记录列出的质量门，不代表 v2 已发布或可升级安装。

## Phase 1 范围与架构审查

Phase 1.1–1.6.2 状态均已完成。改动覆盖 Documentation、Navigation、Academic Application read boundary、Theme、Shell、Workspace、Settings 与对应测试。未发现 Planner persistence、PersonalTask persistence、Diary/Inbox persistence、AI provider、Weather API 或 Phase 1 范围外的 DB migration。

- Navigation 使用类型化 `AppRoute`；默认路由为 `workspace/home`，Academic 子路由离开再返回时恢复最近页面；未开放路由明确显示状态。
- Workspace Presentation → Workspace Application → Academic Application / Timeline Projection；Timeline 只适配 resolved `AcademicCourseOccurrence`。Shell 不读取 Academic DB；Workspace Presentation 不直接访问 storage、SQLite 或 Tauri。
- Time Context 是 application 层纯 ViewModel 的当前情境/后续事件摘要，不构造第二条时间轴，不重新解析 CourseOverride；空闲时长不重复显示，长课程名最多两行。
- Academic stable core 自 Phase 1 起点未修改；节次课程继续以 `startPeriod/endPeriod` 为权威事实，由当前 `PeriodTime[]` 解析实际钟点；固定钟点与 canonical override 语义保持。
- Task deadline 未进入 Timeline。停课安排仍可展示但 `occupiesTime=false`，不参与占用与拖动。
- Task、Diary、Inbox、AI 的现有 Workspace Rail 结构保留；未开放模块没有假数据或伪状态。
- Settings 域路由保持：工作台入口 → 工作台/首页，Academic 入口 → 课表/作息，主题 → 通用/外观；作息真实编辑功能保留。

## Workspace / UI 回归

- Top Canvas 已压缩并移除可见“今日概览”冗余标签；Today Status / Summary 保留。追加的 Quote → Today Status 局部呼吸间距已微调：桌面约 8px、≤850px 约 6px、≤650px 为 0（Quote 隐藏）；没有重新扩大 Top Canvas，主工作区纵向位置基本保持。
- Timeline 宽度未改；00:00 位于 minute 0、24:00 位于 minute 1440，标签通过边界定位完整显示。业务坐标保持 1 minute = 1px，课程块、Current Time、auto-scroll 未偏移。
- Right Rail 结构未重做；Settings 首页说明真实且无假 toggle；Settings/Timeline 使用统一细滚动条；Dark half-hour grid 降低对比，暗色次级文字略增强；Light/Dark/System 和 Reduced Motion 回归通过。
- 目标视口 UI smoke：1920×1080、1600×900、1366×768、720×520 均通过；没有 body/page 垂直滚动，Timeline 维持内部滚动。

## 自动验证

命令：`npm run verify`

- Unit：177 PASS
- Architecture：79 PASS
- UI：606 PASS，15 条 conditional skipped
- TypeScript typecheck：PASS
- Lint：PASS
- Prettier format check：PASS
- Frontend production build：PASS

Rust：

- `cargo test`：40 PASS，0 fail
- `cargo fmt -- --check`：PASS
- `cargo clippy`：PASS

已知非阻断输出：Tauri release linking 在 Windows 上有一条 linker stdout warning；Playwright mock 环境仍有既有 Widget `currentWindow` bounds subscription warning；未导致验证失败。

## Tauri Production Build 与产物

命令：`npm run tauri build`，版本元数据仍为 `1.3.1`。Upgrader signing 环境变量只检查存在性，未读取或记录其值。构建成功；生成 NSIS、MSI 以及对应 updater `.sig`。不运行 Production EXE、不安装包。

| 产物 | 路径 | 大小（bytes） | SHA-256 |
|---|---|---:|---|
| Main EXE | `src-tauri/target/release/ntu-course-assistant.exe` | 66,022,912 | `6B1B468D586247BDDC36414213A831FD30DB3BF4DD73055113400A3F32CC20EC` |
| NSIS | `src-tauri/target/release/bundle/nsis/NTU Course Assistant_1.3.1_x64-setup.exe` | 51,979,833 | `8EE2F93EC42535506D2A8A2C260477C0626BA9EC9CC62B6D7737781E3FC85296` |
| NSIS updater signature | NSIS 路径加 `.sig` | 436 | `C38B3C6E6614E77BDDEB8F3F90FE25459C1F1989F302F217FC387020C1A7F822` |
| MSI | `src-tauri/target/release/bundle/msi/NTU Course Assistant_1.3.1_x64_en-US.msi` | 53,837,824 | `8EB253FD950FD22A05A934997BBA21ED7C3761D363C22461B6AF510C73E11130` |
| MSI updater signature | MSI 路径加 `.sig` | 436 | `E520DF6A40221153BD281CDD38DAA72EE7B6C65B30EC22CCECC8CF35E766367B` |
| Updater archive | 未生成 | — | — |
| `latest.json` | 未生成（由正式 Release workflow 生成/上传） | — | — |

产物均在 ignored `src-tauri/target`，没有加入 Git。EXE/installer 未自动运行或安装。

## 技术身份、数据库与依赖

- Tauri identifier：`com.ntu-course-assistant.desktop`，保持不变。
- `productName`：`NTU Course Assistant`；Windows 标题：`大学课程表`，均保持。
- 数据库路径逻辑继续使用 Tauri app local data directory 下的 `courses.sqlite3`；本次只做静态代码检查，没有访问用户数据库内容。
- Schema：5；无新 migration。DB 支持版本上限仍为 5，future schema 被安全拒绝。
- Updater endpoint / GitHub repo identity 未改：`https://github.com/LinksOnlining/NTU-Course-Assistant/releases/latest/download/latest.json`。
- 版本：package、Tauri、Cargo 元数据仍为 `1.3.1`；这是 v2 开发分支的临时元数据，本轮未 bump。
- Phase 1 起点至验证 HEAD：`package.json`、`package-lock.json`、`Cargo.toml`、`Cargo.lock` 未发生变化；无新增依赖。

## 未执行与发布边界

- Production EXE：未运行；NSIS/MSI：未安装。Installer compatibility：**NOT VERIFIED**。
- v1.3.1 → v2 Updater E2E：**NOT EXECUTED**；不得由本地生成 `.sig` 推断升级链路已通过。
- 未访问、修改、迁移或覆盖真实用户数据库。
- Windows 系统级品牌迁移：PENDING。
- Phase 2：NOT STARTED；Planner、PersonalTask、PlannerEvent、TimeBlock、Diary Domain、Inbox Domain、AI、Weather、Context、Routine、Search、Ctrl+K、完整 Workspace/Schedule 均未实现。
- v2 Release Ready：**NO**。原因：系统级品牌迁移未完成、installer compatibility 未验证、updater E2E 未执行、版本仍为 1.3.1。

## Git

- Workspace visual polish：`3df9467`。
- Quote → Today Status breathing-space 微调：`f840adb`。
- Phase verification 文档与状态收口由独立 docs commit 记录。
- 不 push、不 tag、不创建 Release。
