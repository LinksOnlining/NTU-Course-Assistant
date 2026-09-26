# Links Workplace v2.0 — Phase 4.2 验证记录

状态：**Phase 4.2 AI Runtime Permission + Context Engine COMPLETE。** 未开始 Phase 4.3；未启用 AI Tool Runtime、Proposal 应用或 AI 对话工作流。

## 一、基线与范围

- 项目：`D:\AI_Workspace\Projects\NTU-Course-Assistant`
- Branch：`v2/workspace-rebase`
- 起始 HEAD：`e84c2d428841cb97d96c92f2532f0163c7588c97`
- 产品配置版本：`1.3.1`（沿用现有配置，本阶段不发布或升级版本）
- SQLite schema：7；本阶段 migration：0；未修改 Rust/Tauri 数据库代码，未访问 Release 用户数据库。
- Phase 4.0 / 4.1 保持 COMPLETE；Phase 4.3 = NOT STARTED。

## 二、Runtime Permission

| 类型 | Permission ID | 默认状态 | 运行边界 |
| --- | --- | --- | --- |
| 持久读取 | `workspace.read` | 关闭 | 仅限工作台聚合摘要，不是全部模块授权 |
| 持久读取 | `academic.read` | 关闭 | 课程 occurrence、考试与 deadline 的必要字段 |
| 持久读取 | `planner.read` | 关闭 | 任务、事件与时间块的最小规划字段 |
| 持久读取 | `routine.read` | 关闭 | 当前规划需要的 Routine 摘要 |
| 持久读取 | `weather.read` | 关闭 | 当前天气与短期小时摘要，不含坐标/轨迹 |
| 请求级敏感读取 | `diary.body.read` | 不持久化 | 仅本次请求、当前所选 Diary 对象的一次性授权 |
| 请求级敏感读取 | `inbox.raw.read` | 不持久化 | 仅本次请求、当前所选 Inbox 对象的一次性授权 |

- `AiPermissionGate` 对未知、未授权、空权限、敏感权限缺少有效 grant 及所有 inactive mutation 权限均默认 DENY。
- `propose` / `apply` 与业务 mutation 在本阶段不启用；旧的宽泛 `diary.read` / `inbox.read` 元数据不能授权正文/原文。
- 持久设置只保存稳定白名单 ID；损坏或篡改记录会过滤到安全白名单，默认拒绝。
- request grant 由可信 Application orchestration 内部工厂创建，绑定 request ID 与明确对象引用，经一次校验后即消费；没有公开 UI 组件发放权限的入口，也不写入设置或浏览器存储。

## 三、AI 数据访问设置

- 入口：通用 Settings → AI → 数据访问。
- 持久读取开关全部默认关闭；用户明确切换后仅将稳定权限 ID 保存至现有设备本地非敏感设置存储。
- 设置说明明确 API Key 配置不代表授权读取课程、任务或个人数据。
- Diary body 与 Inbox raw 显示独立的当前请求隐私边界，不提供“始终允许”。
- 数据访问设置变化不触发 Provider 请求；连接测试与模型刷新仍是 Phase 4.1 的显式行为。

## 四、Context Pipeline / DTO

流水线：

```text
显式 AiContextRequest
→ Runtime PermissionGate
→ 仅调用已授权且被请求的模块 source
→ 模块 allowlist projector
→ 确定性排序、敏感值脱敏与预算
→ AiContextBundle / serializeAiContext
→ 未来由调用方显式传入 Provider
```

| 模块 | Context 最小字段 |
| --- | --- |
| Workspace | 本地日期/时间、今日与剩余安排数、任务计数、下一空闲时段、是否存在当日日记、Inbox pending 数；不含日记正文、Inbox 原文或任务描述 |
| Academic | 日期范围内 canonical occurrence 的课程标题、日期/教学周、起止时间、地点、教师、状态；考试与学业 deadline 的最小摘要；不含 PDF/raw import/完整备注 |
| Planner | PersonalTask 标题/状态/优先级/deadline/是否安排；PlannerEvent / TimeBlock 日期与起止时间、关联 ID、已计算的 buffer 占用范围；不含隐藏备注/内部 metadata |
| Routine | 规划所需名称、启用状态、目标时长/周几/首选时间及最近安排日；不发送完整历史记录 |
| Weather | 已选地点显示标签、当前天气、当日小时天气；不含经纬度、定位历史或后台轨迹 |
| Selected Items | 仅规范化、去重、排序并通过模块权限过滤的对象引用；受预算上限约束 |

- Snapshot source 是模块公开 Application Query / UseCase 的注入端口；AI Context 层没有 Repository、SQL、Tauri DB 或 Provider 导入。
- 默认日期范围为请求本地日期起 7 天；时间由调用者传入的本地时间上下文确定，Context 层不重新推断时区。
- source 失败按模块隔离，仅记录 `sourceUnavailable` 安全类别，不回显异常内容。
- Bundle 仅在 Context 构造完成后序列化；本阶段没有 Provider 网络调用。

## 五、隐私与预算

- Diary 正文与 Inbox 原文默认不进入普通 Context；仅请求级 grant 与所选对象同时匹配时，投影才会包含对应文本。
- Windows 绝对路径与 UNC 路径、常见 API key/password/token/Bearer 值在安全文本投影中替换为占位符。
- 课程、任务、事件标题等字符串字段采用固定 allowlist；不会通过序列化完整业务 entity 带出未声明字段。
- 默认预算：总 Context ≤ 32 KiB UTF-8；单模块 ≤ 8 KiB；单字符串 ≤ 512 字符；每模块 ≤ 50 项；所选对象 ≤ 20 项。
- 超限时确定性裁剪并记录 `usedBytes`、`omittedCount`、`truncated`、`truncatedModules` 与模块字节数，不静默宣称内容完整。

## 六、Module Registry 与 Provider 边界

- 复用唯一 `WorkplaceModuleRegistry`：模块声明拥有 AI Context provider metadata，并校验稳定 ID、模块归属、权限绑定与敏感 scope 规则；不保存用户 grant 或业务状态。
- 未建立第二套 Module Registry；没有第三方运行时插件。
- Context Builder 不导入 DeepSeek，不联网，不直接持有 Provider；未来 DeepSeek 只能消费已构造的 `AiContextBundle`。
- DeepSeek、其他 Provider 与模块 Repository/SQLite 之间不存在直连路径。

## 七、自动验证

- Phase 4.2 targeted Permission / Context / architecture：PASS；36 项相关 unit / architecture 测试通过。
- AI 数据访问设置 Playwright：6 项通过，覆盖默认关闭、显式授权/撤销、本地持久化、无网络调用、API Key 独立性、损坏记录恢复、敏感授权说明及小窗口主题。
- `npm run verify`：PASS；279 unit、126 architecture、867 UI 通过，15 项条件跳过；typecheck、lint、Prettier 与前端 production build 均通过。
- Playwright 使用当时已占用 1420 端口的本项目 Vite server；已核对监听进程命令行指向当前仓库。`reuseExistingServer` 仅临时改为 `true` 执行验证，完成后恢复原配置 `false`，未保留配置差异。
- `npm run tauri build`：PASS；生成应用 EXE、NSIS、MSI 及两类 updater `.sig`。构建文件位于忽略的 `src-tauri/target/`：

  | 产物 | 大小（bytes） |
  | --- | ---: |
  | `ntu-course-assistant.exe` | 67,853,824 |
  | `NTU Course Assistant_1.3.1_x64-setup.exe` | 52,402,593 |
  | `NTU Course Assistant_1.3.1_x64-setup.exe.sig` | 436 |
  | `NTU Course Assistant_1.3.1_x64_en-US.msi` | 54,329,344 |
  | `NTU Course Assistant_1.3.1_x64_en-US.msi.sig` | 436 |

  Vite 报告既有单个 bundle 超过 500 kB 提示；Rust 链接器输出 informational warning，未阻止构建。未运行 EXE、未安装 NSIS/MSI。
- Rust 源码未变；`cargo test` / `cargo fmt --check` / `cargo clippy`：按本阶段规则 NOT RUN / unchanged。Tauri production build 已成功编译 Rust release target。
- 自动验证通过 Playwright invoke mocks；不代表本阶段存在真实 AI 生成 UI 或完成 Windows 人工验收。

## 八、Live / Manual 边界

- Phase 4.1 DeepSeek real `GET /models`、Windows Credential Manager 持久化/删除、离线失败处理：继续保持 Ethan 已确认 PASS。
- DeepSeek `POST /responses` 文本生成：**NOT EXECUTED**。
- DeepSeek `POST /responses` 结构化生成：**NOT EXECUTED**。
- 本阶段没有 AI 请求 UI，不为测试触发真实 Provider 网络；以上 live smoke 延期到首次正式 AI 工作流。
- 未运行 production EXE；未安装 NSIS/MSI；未访问 Release DB；未创建 Tag、未 push、未发布。

## 九、Git 与阶段

- README / CHANGELOG：按任务要求未修改。
- SQLite schema：7；Phase 4.2 migration：0。
- Phase 4.0：COMPLETE；Phase 4.1：COMPLETE；Phase 4.2：COMPLETE；Phase 4.3：NOT STARTED。
