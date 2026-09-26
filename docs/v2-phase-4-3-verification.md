# Links Workplace v2.0 — Phase 4.3 验证记录

状态：**Phase 4.3 DeepSeek Tool Calling + AIToolRegistry COMPLETE。** 本阶段只增加瞬态、默认拒绝、只读的 Application Tool Runtime；不提供用户可见 AI 工作流，也不启用 Proposal 或业务写入。

## 一、基线与范围

- 项目：`D:\AI_Workspace\Projects\NTU-Course-Assistant`
- Branch：`v2/workspace-rebase`
- 起始 HEAD：`7d55ac83ec8e8430dc0645a9e8d076b94e9f5ca8`
- 产品配置版本：`1.3.1`（v2 开发沿用既有版本号；本阶段不发布或升级版本）
- SQLite：schema **7**，migration **0 added**；`src-tauri/src/db.rs` 无修改。
- Phase 4.0 / 4.1 / 4.2 均保持 COMPLETE；Phase 4.4 = **NOT STARTED**。

## 二、AIToolRegistry 与可用工具

唯一工具声明源为 `WorkplaceModuleRegistry.aiTools`。Registry 按稳定模块贡献顺序构造，校验唯一 ID / Provider function name、名称格式、模块归属、单一模块读取权限及输入/输出 JSON Schema；执行器按稳定 ID 绑定，缺少或多余 adapter 均 fail fast。

| Provider function name | 模块 | 权限 | 输入 | 输出摘要 |
| --- | --- | --- | --- | --- |
| `academic_get_upcoming` | Academic | `academic.read` | 可选 `from` / `to` / `limit`；日期有效、窗口不超过 31 天、limit 1–50 | 按 canonical occurrence resolver 得到的课程、考试、学业截止摘要 |
| `planner_get_open_items` | Planner | `planner.read` | 可选 `limit`，1–50 | 未完成个人任务的必要字段；不含描述、隐藏备注或 metadata |
| `routine_get_today` | Routine | `routine.read` | 空对象 | 今天适用的习惯、目标时长、首选时段及今日安排状态 |
| `weather_get_summary` | Weather | `weather.read` | 空对象 | 本机已缓存的地点标签、当前和当天近期天气；不含坐标或位置历史，不发请求 |
| `workspace_get_overview` | Workspace | `workspace.read` | 空对象 | 本地日期/时间、今日安排与任务计数、下一空闲时段 |
| `planner_get_schedule` | Planner | `planner.read` | 可选 `from` / `to` / `limit`；日期窗口不超过 31 天、limit 1–50 | 个人事件、时间块与按 buffer 算出的占用区间 / busy count |

每项数据由模块 Application Query 投影为固定 allowlist DTO；不直接序列化业务 Entity。Academic 时间使用已有 occurrence 解析；Planner 时间占用使用现有 buffer 规则。Read 工具不读取 Diary 正文或 Inbox 原文。

## 三、权限与禁用能力

- 五项持久读取授权默认关闭；每次 orchestration 根据当前传入设置建立 `AiPermissionGate`。未授权工具在提交给 Provider 前过滤，执行时再次检查权限；无获准工具时 `tool_choice=none`，不发送空工具数组。
- 所有 `effect != read` 工具均不暴露、不执行。Proposal、mutation、write、create、update、delete、apply 均未启用。
- 没有 Diary body、Inbox raw、全局 Search、generic DB / SQL、generic HTTP、文件系统、命令或 shell 工具。
- 没有 Prompt 输入框、Chat、AI Workspace、Tool Debug UI 或动态第三方执行入口。

## 四、DeepSeek 协议与有限循环

- Provider-neutral `generateToolTurn` 由 DeepSeek adapter 映射到专用 Native `generate_deepseek_tool_turn`。Rust 使用固定 `https://api.deepseek.com` Responses API transport；无通用网络代理、自动 redirect 或 Provider raw DTO 泄漏到业务层。
- 只使用 `function` tools；普通请求 `tool_choice=auto`，无授权工具时 `none`。Native 识别最终 assistant text 或 `function_call` 的 `call_id` / name / arguments，并通过同一真实 `call_id` 回传 `function_call_output`。请求内 transcript 完成配对校验；Responses 请求无服务端会话状态。
- Tool loop 固定 `reasoning=none`，无自动付费重试；工具结果在指令中明确标注为不可信应用数据。Reasoning 不显示、不记录、不持久化。
- 硬上限：最多 4 个 Provider round、8 个总 Tool calls、每 round 最多 4 个 calls。多调用按响应顺序串行执行；同一请求内规范化后的 `tool name + arguments` 完全相同时只执行一次并复用结果。
- Native 限制：最多 12 个工具定义、20 个 input items、每个 arguments ≤8 KiB、单次请求序列化 ≤128 KiB、HTTP response body ≤2 MiB；每次 Provider 请求使用既有有限 timeout。

## 五、校验、错误与隐私

```text
Provider arguments
→ JSON parse
→ input JSON Schema
→ module domain validation
→ permission recheck
→ fixed Application Query
→ allowlist projection / path & secret redaction
→ output JSON Schema
→ per-tool / per-request byte budget
→ paired function_call_output
```

- 任一步失败均不执行或不回显内部异常；错误只使用安全类别和短消息。未知工具不猜测、不模糊匹配；权限拒绝、无效参数、输出校验失败和 Tool 错误均为 Provider-neutral 错误 DTO。
- Tool output 每项 ≤8 KiB UTF-8，单次请求累计 ≤24 KiB。超预算按稳定顺序删除数组项或缩短字符串，并显式给出 `truncated` 与 `omittedCount`；请求结束即销毁临时 transcript 与 request-local duplicate cache。
- `outputSchema` 使用 `additionalProperties: false` 防止未声明的隐藏字段进入 Provider；路径和常见 token / password 形式复用 Phase 4.2 文本脱敏规则。没有日志记录 prompt、arguments、Tool output、reasoning 或 credential。

## 六、测试

- 新增 `tests/unit/ai-tools.test.mjs`，覆盖六个只读贡献、稳定顺序、权限过滤、0/1/多工具、unknown/unauthorized、无效 JSON/schema/domain input、输出校验、敏感哨兵、脱敏、8/24 KiB budget、裁剪元数据、重复调用、轮次/调用上限、Provider 中途失败和 Mock tool turns。
- DeepSeek bridge / Rust tests 覆盖 DTO camelCase 与 `call_id`、请求 function serialization、配对、无效/超量 function response、HTTP response body 上限、secret redaction 与 stateless `reasoning=none`。
- `npm run verify`：**PASS**。TypeScript typecheck、单元 **294 PASS / 0 FAIL**、architecture **127 PASS / 0 FAIL**、UI **867 PASS / 15 条件跳过**、oxlint、Prettier 检查与前端 production build 全部通过。
- Rust：`cargo test --manifest-path src-tauri/Cargo.toml` **94 PASS / 0 FAIL**；`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` **PASS**；`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` **PASS**。

## 七、Production Build 与边界

- `npm run tauri build`：**PASS**。当前构建位于忽略的 `src-tauri/target/`：

  | 产物 | 大小（bytes） |
  | --- | ---: |
  | `ntu-course-assistant.exe` | 67,966,976 |
  | `NTU Course Assistant_1.3.1_x64-setup.exe` | 52,478,723 |
  | `NTU Course Assistant_1.3.1_x64-setup.exe.sig` | 436 |
  | `NTU Course Assistant_1.3.1_x64_en-US.msi` | 54,366,208 |
  | `NTU Course Assistant_1.3.1_x64_en-US.msi.sig` | 436 |

- 构建使用当前机器已经配置的签名环境，验证只记录签名产物存在；不记录、打印或提交私钥及密码。Vite 有既有的单个 bundle 超过 500 kB 提示；Rust linker 有 Windows 库创建 informational warning，未阻止构建。
- 未运行 production EXE，未安装 NSIS / MSI，未访问 Release 用户数据库；未创建 tag、未 push、未发布。构建产物均未加入 Git。

## 八、DeepSeek Live / 手动边界

- `GET /models`：**PASS（沿用 Phase 4.1 Ethan Windows 11 实测）**。
- `POST /responses` 文本生成：**NOT EXECUTED**。
- `POST /responses` 结构化生成：**NOT EXECUTED**。
- `POST /responses` Tool Calling：**NOT EXECUTED**。
- 原因：没有正式用户 AI Prompt / Tool workflow；本阶段不增加临时入口、不使用真实 API Key 触发可能计费的请求。Offline Mock、协议 DTO、序列化与解析由自动测试验证，不代表 live smoke。

## 九、阶段与 Git

- Phase 4.0：COMPLETE；Phase 4.1：COMPLETE；Phase 4.2：COMPLETE；Phase 4.3：COMPLETE；Phase 4.4：**NOT STARTED**。
- Git 提交由仓库历史记录；Push：NO；Tag：NO；Release：NO。
