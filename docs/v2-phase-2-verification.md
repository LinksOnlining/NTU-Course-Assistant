# Links Workplace v2.0 — Phase 2 综合验收记录

日期：2026-09-24  
结果：**Phase 2.0–2.7 PASS；Phase 2 Overall COMPLETE**  
验收方式：按 Ethan 授权连续完成自动验证与视觉自审；未执行需要真实 Windows 安装态的人工 GUI 验收。

## 一、起始基线与范围

- 分支：`v2/workspace-rebase`。
- Phase 2 起点：`d013199 docs: close phase 1 verification`；起始生产 SQLite schema 为 5。
- Phase 2 最终代码 HEAD：`173ef58 fix: stabilize planner final regressions`。
- 本阶段新增唯一生产迁移：schema `5 → 6`。产品版本仍为 `1.3.1`；未设置 v2.0.0 版本号。
- 范围包括 Planner/PersonalTask 领域契约、开发数据库隔离、PersonalTask、PlannerEvent、TimeBlock、Schedule、交互式安排与冲突/空闲计算，以及 Workspace Dashboard 汇总。
- 没有进入 Phase 3；没有实现 Diary、Inbox、AI、Weather、Context、Routine、Search/Ctrl+K，也没有进行系统级产品品牌/identifier 迁移。

## 二、阶段结果与提交

| 阶段 | 结果 | 提交 |
| --- | --- | --- |
| Phase 2.0 — Planner Domain Contract | PASS | `a19c4d3 docs: define phase 2 planner domain contract` |
| Phase 2.1 — Debug DB Isolation / schema 5→6 | PASS | `132f4be feat: isolate planner dev database and migrate schema` |
| Phase 2.2 — PersonalTask | PASS | `c3bc08b feat: add personal task management` |
| Phase 2.3 — PlannerEvent / TimeBlock | PASS | `906241f feat: add planner events and time blocks` |
| Phase 2.4 — Workspace Schedule | PASS | `ac07613 feat: build workspace schedule` |
| Phase 2.5 — Interactive Scheduling | PASS | `35253bb feat: add interactive planner scheduling` |
| Phase 2.6 — Unified Workspace Dashboard | PASS | `12265c9 feat: integrate planner into workspace dashboard` |
| Phase 2.7 — 最终回归与范围收口 | PASS | `173ef58 fix: stabilize planner final regressions` |

各阶段范围与定向记录分别见 `docs/v2-phase-2.1-verification.md` 至 `docs/v2-phase-2.6-verification.md`；Phase 2.0 契约见 `docs/v2-planner-domain-contract.md`。
Phase 2.0 的 Schema Proposal 与 Domain Contract 自审均为 PASS；契约冻结后才进入数据库隔离和实现。

## 三、领域契约与数据库

### Domain Contract

- `PersonalTask`、`PlannerEvent`、`TimeBlock` 是彼此独立的领域对象；任务截止时间不等于时间轴占用。
- `AcademicCourseOccurrence` 是课程显示的权威只读事实；Planner 不修改课程，不重建或绕过既有 Academic occurrence resolver。
- `TimeBlock` 关联一个 `PersonalTask`，一个任务允许多个时间块；时间块标题由关联任务投影，不复制保存。
- Task 完成/重新打开不删除时间块；删除 Task 时关联 TimeBlock 按外键级联删除。PlannerEvent 独立于任务。
- 时间使用本地日历日期与 wall-clock `HH:mm`，不把日程钟点转换为 UTC；首版不支持跨午夜、全天或重复日程。
- Buffer 只用于有效占用、冲突及空闲计算，不修改事件/时间块真实 `startTime/endTime`。
- 冲突是“提示但允许保存”；编辑时排除自身，已取消课程不参与占用。

### Schema 6

- `personal_tasks`：个人任务及状态、优先级、可选日期/时间截止信息和审计时间。
- `planner_events`：独立个人日程、地点与前后 buffer。
- `time_blocks`：关联任务的具体时间安排与前后 buffer；外键 `personal_task_id → personal_tasks.id ON DELETE CASCADE`。
- 索引：`personal_tasks_status_deadline`、`planner_events_date_time`、`time_blocks_date_time`、`time_blocks_task_date`。
- Phase 2.1 的单个 schema `5 → 6` 迁移在事务中创建三张表及索引，并验证表/索引/外键、`user_version` 与 `integrity_check`；失败会回滚。
- 迁移前通过 SQLite `VACUUM INTO` 创建并校验一致性备份；备份失败则不开始迁移。测试还覆盖注入失败回滚、schema 5 数据保留、重开、外键级联与未来 schema 拒绝。
- 生产路径保持 `<app_local_data_dir>/courses.sqlite3`；开发路径隔离为 `<app_local_data_dir>/dev-v2/courses.sqlite3`。未读取、复制或修改真实用户数据库。

## 四、PersonalTask

- CRUD、标题/描述/日期/截止时间/优先级校验、完成、重新打开、删除确认及重开数据库读取均已覆盖。
- Deadline 可无日期、仅日期或日期加时间；时间不能无日期。日期截止不伪造 23:59，也不生成 Timeline 占用。
- Priority 为 `none / low / medium / high`，与 AcademicTask 优先级语义分离。
- Workspace Tasks 汇总个人任务并将 AcademicTask 作为只读事项呈现；AcademicTask 导航回 Academic 管理入口，不可在 Planner 修改。
- 创建、编辑、完成、重新打开和关联时间安排均有 UI/应用层回归覆盖；删除关联任务会明确确认级联删除时间块。

## 五、PlannerEvent / TimeBlock

- PlannerEvent 与 TimeBlock 的 Rust/SQLite CRUD、日期范围读取、任务关联查询、字段校验、buffer 持久化与数据库重开已验证。
- Event 可独立创建、编辑、删除；TimeBlock 可关联任务创建、编辑、删除，同一任务可有多个时间块。
- 任务改名后，TimeBlock 显示标题通过关联任务的重新读取自然更新；任务完成保留时间块，删除任务才级联删除。
- 采用严格本地日期与钟点校验，起止必须有效且结束晚于开始；支持 `24:00` 作为同日结束边界，不支持跨午夜。
- `bufferBeforeMinutes/bufferAfterMinutes` 范围为 0–240；真实日程时间不因 buffer 改写。

## 六、Workspace Schedule 与统一时间轴

- `workspace/schedule` 提供单日 Schedule、前/后一天和回到今天；读取目标日期的 PlannerEvent/TimeBlock，并组合 Academic application read 与 canonical occurrence resolver。
- 统一 Timeline 投影包含只读 Academic course、可编辑 PlannerEvent 与可编辑 TimeBlock。任务截止时间不进入 Timeline；TimeBlock 标题来自其 Task。
- Academic course 不可编辑、拖动或 resize；课程变更仍走原有 Academic 工作流。
- Schedule 提供 Event 新建/编辑/删除、Task 安排时间入口、空/错/加载状态；Task 可以安排多个 TimeBlock。
- 路由返回 Schedule 或 Dashboard 会重新加载对应数据；Dashboard 额外读取未来七日安排以确定下一项，不做分钟级数据库轮询。

## 七、拖动、冲突与空闲时间

- PlannerEvent / TimeBlock 支持拖动及 resize；交互按 5 分钟吸附，约束于 `00:00–24:00`，resize 最短交互长度为 5 分钟，不跨日期。可访问的表单编辑保留任意有效分钟，不依赖拖拽。
- Academic course 始终只读且受保护。
- 冲突检测以真实区间加 buffer 的有效占用为准；严格重叠才冲突，边界相接且无 buffer 不冲突。编辑排除自身。
- 冲突预览提供取消/返回调整或显式“仍然保存”；冲突不是数据库约束，保存失败会回滚展示时间并显示保存错误。
- Free Time 对有效占用排序并合并重叠/相邻区间后计算；取消课程不占用。buffer 影响占用和空闲结果，但不扩张 Timeline 事件卡片几何。
- 单元/UI/Rust 回归覆盖 snap、clamp、最短 resize、课程只读、冲突取消与仍保存、保存失败回滚、buffer、self exclusion、相邻边界、取消项、区间合并及 `24:00`。

## 八、Workspace Dashboard

- Dashboard 将 Academic occurrence、PlannerEvent、TimeBlock、AcademicTask 与 PersonalTask 纳入同一工作台上下文；deadline 不伪装为时间块。
- Time Context 基于已解析投影呈现当前安排/空闲与下一项；buffer-aware free time 不改变真实日程起止。
- 个人/学业任务摘要保留来源，并按既定顺序排序；未实现的 Diary/Inbox/AI 入口仍显示未开放，不伪装成已有功能。
- 支持路由往返后刷新、跨本地午夜刷新，以及纯派生的分钟级时间线更新；不进行高频数据库轮询。
- Phase 2.6 定向验证：Dashboard application 单测 11、architecture tests 7、Playwright Dashboard UI 11 均 PASS。

## 九、UI 自主验收与视觉自审

- Playwright UI 回归覆盖 `1920×1080`、`1600×900`、`1366×768`、`720×520` 等目标窗口、浅色/深色主题、键盘交互与 Reduced Motion。
- 使用临时测试 harness 与 mock runtime，以 Playwright/Edge 捕获并检查 Dashboard、Schedule、Tasks、Settings、Task/Event/TimeBlock 编辑器、冲突提示及紧凑窗口截图；截图位于仓库外临时目录。
- 页面浏览器 console/page errors 为 `[]`。桌面视口验证 Dashboard 与 document/body 均为 `1920×1080`；Schedule 主区与 Timeline 几何正常。紧凑视口为 `720×520`，页面无纵向溢出，内部滚动保持在 Timeline。
- 00:00/24:00 边界标签可视性有 DOM 几何回归；课程块和当前时间线仍按分钟坐标，不因边界标签排版改变。
- 这是自动 UI/DOM 与截图视觉自审结果，不是 Ethan 在 Windows 安装态的人工验收，也不构成辅助技术全面合规认证。

## 十、完整验证

| 门禁 | 结果 |
| --- | --- |
| `npm run verify` | PASS：200 Unit、89 Architecture、705 UI PASS；15 条件跳过。 |
| TypeScript typecheck | PASS。 |
| Lint | PASS，Oxlint 使用 `--deny-warnings`。 |
| Prettier | PASS，所有匹配文件格式检查通过。 |
| Frontend production build | PASS，Vite production bundle 成功。 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | PASS：54 tests，0 failed。 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | PASS。 |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | PASS。 |
| `git diff --check` | PASS。 |

最终 `npm run verify` 全量运行有过间歇性 UI 测试时序失败：冲突提示关闭后的 `requestAnimationFrame` 延迟焦点恢复可能与用户快速编辑竞争。Phase 2.7 将 dismiss 焦点恢复改为同步布局阶段处理，并增加焦点/字段保留断言；另删除一个导致 lint 失败的重复不可达分支。相关 Dashboard 单测、Schedule 回归重复运行及最终完整验证均 PASS。没有放宽断言。

## 十一、Production Build 与资产

执行 `npm run tauri build`：**PASS**。在 HEAD `173ef58` 上生成 EXE、NSIS、MSI 及对应 updater `.sig`。文件不纳入 Git，以下大小为字节，SHA-256 为构建产物校验值；最后修改时间为 UTC。

| 类型 | 仓库相对路径 | 大小 | SHA-256 | 修改时间（UTC） |
| --- | --- | ---: | --- | --- |
| 主程序 EXE | `src-tauri/target/release/ntu-course-assistant.exe` | 66,715,648 | `4694532BB508EA5F2641D5CB80DEA25E8022A89A7C84363C403CD9D485DEDA48` | 2026-09-23 21:36:26 |
| NSIS | `src-tauri/target/release/bundle/nsis/NTU Course Assistant_1.3.1_x64-setup.exe` | 52,177,342 | `D0F355A630B9D70CF79D54A66D4FBCE0F692E69CD1FE83167AB3061C83FCAFA9` | 2026-09-23 21:36:26 |
| NSIS updater 签名 | `src-tauri/target/release/bundle/nsis/NTU Course Assistant_1.3.1_x64-setup.exe.sig` | 436 | `77FF6815D33F11958F24461A9949616E9BC0B5749BE7FF5458B7F91EE8EE8B6B` | 2026-09-23 21:36:26 |
| MSI | `src-tauri/target/release/bundle/msi/NTU Course Assistant_1.3.1_x64_en-US.msi` | 54,001,664 | `BEB121D78754A2BD3B08D3C34A0EE0A8DAF3656DE8844BB90F03B370EFC8DAB2` | 2026-09-23 21:36:01 |
| MSI updater 签名 | `src-tauri/target/release/bundle/msi/NTU Course Assistant_1.3.1_x64_en-US.msi.sig` | 436 | `0E1F4DBC5DB1BB455BC7FDA153F49E5A7CEC98CC762635072FECE4A5B5029157` | 2026-09-23 21:36:26 |

## 十二、版本、身份与安装边界

- 产品版本：`1.3.1`（`package.json`、Tauri 配置及 Rust crate 保持一致）。
- 技术 identifier：`com.ntu-course-assistant.desktop`；productName：`NTU Course Assistant`；Windows 窗口标题：`大学课程表`；SQLite schema：6。
- 未运行本次 production EXE；未安装 NSIS/MSI；未使用真实用户 DB。Installer compatibility：**NOT VERIFIED**。
- 虽生成带 `.sig` 的 updater artifacts，但没有执行跨版本安装态更新；Updater E2E：**NOT EXECUTED**。签名产物存在不等于安装兼容或更新链路通过。
- 没有升级产品版本，不创建 v2.0.0 tag，也没有创建 Release。

## 十三、已知限制与 Release Readiness

- Planner 暂不支持跨午夜、重复/周期性、全天事件。
- Diary、Inbox、AI、Weather、Context、Routine、Search/Ctrl+K 未实现；Quick Capture 与 Focus 为当前规划中移除项。
- 系统级品牌迁移未完成；桌面/开始菜单/安装器身份仍保持 NTU Course Assistant 与现有 identifier，以保护现有用户数据路径。
- Windows installer compatibility 未验证；updater E2E 未执行。
- **v2 Release Ready：NO**。本记录的 Phase 2 COMPLETE 只代表 Phase 2 范围及其自动门禁完成，不代表可以公开发布。

## 十四、Git 与下一步

- Phase 2.7 代码提交：`173ef58 fix: stabilize planner final regressions`。
- 本综合验收文档和状态收口为独立文档提交；Phase 2 全部提交保持原有历史，不折叠、不重写。
- 未 push、未创建 tag、未创建 Release。构建资产留在被忽略的 `target` 输出目录，不纳入提交。
- Phase 2.0–2.7 全部 PASS；Phase 2 Overall：**COMPLETE**。
- 下一步：等待 Ethan / ChatGPT 审核 Phase 2 总结并规划下一阶段。
- Phase 3 及其他未开放模块不在本次授权内；本轮到此停止。
