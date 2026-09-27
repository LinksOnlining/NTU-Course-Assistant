# Links Workplace v2.0 — Phase 4.7 验证记录

日期：2026-09-27<br>
分支：`v2/workspace-rebase`<br>
起始基线：`98f7f72cf3833f0da4c90c1d5bd3ab59354cd444`
SQLite：schema `7`，migration `0`

## 阶段状态

- Phase 4.7 Implementation：**COMPLETE**
- Phase 4.7 Automated：**PASS**（以本记录中的完整门禁结果为准）
- Phase 4.7 DeepSeek Live：**PENDING**（未发起真实请求）
- Phase 4.7 Overall：**PENDING**（等待用户后续 DeepSeek / Windows 人工验收）
- Phase 4.8：**NOT STARTED**

## 权限、同意与对象绑定

- `diary.body.read` / `inbox.raw.read` 不属于持久读取权限；Settings 不提供永久授权、记住选择或自动访问选项。
- 用户对当前选中的 Diary Entry / Inbox Item 明确点击“仅本次允许”后，Application 才签发内存态 grant。Grant 同时绑定 permission、request ID、object type 与 object ID，并由既有 Permission Gate 单次消费。
- 取消、Esc、点击背景、请求失败、重试、对象切换或组件卸载不会保留授权；重试必须重新打开 Consent。Consent 使用同一个原生 modal 组件，支持键盘焦点、关闭行为和对象范围说明。
- 当前上下文一次最多含一个选中对象；来源投影只允许相应 ID。未经授权、跨对象、跨 request、跨类型和持久设置注入敏感 permission 均不能读取敏感正文。

## Diary 与 Inbox 工作流

- `diary.reflectSelected` 只处理当前选中的单篇日记，返回经本地 schema 校验的摘要、主题、观察、建议和限制；完全只读，不创建 Proposal，不写回日记。
- `inbox.interpretSelected` 只处理当前选中的一条 Inbox 原文，返回摘要、可能类型、标题、日期/时间/截止、缺项、不确定项和限制。明确时间使用本地解析约束；模糊日期/时间留空，不推断为 23:59。
- Inbox 识别本身不创建任务/日程。用户必须在识别结果后再单独选择“生成任务建议”或“生成活动建议”；每种操作只暴露对应的单一 Proposal Tool，不开放 TimeBlock Proposal 或读取工具。
- Proposal 只用经过校验的业务字段，不透传原文。预览、确认、重校验、取消和写入沿用既有 Proposal Review / Runtime 与 Inbox Application UseCase；写入服从 Inbox 原有幂等语义。

## Prompt Injection 与隐私边界

- Diary / Inbox 内容保留 `sourceType`、`sourceId`、`trust: untrusted-user-content` 的结构化 envelope。敏感文本只在用户 message 的 JSON data envelope 中传入；envelope 标记字符转义，固定 system instructions 由 native intent 映射提供。
- Instructions 将敏感文本明确视为用户资料而非指令；不允许借正文伪造 consent、扩大对象、泄露 system prompt、调用未提供的工具或宣称用户已确认。Proposal 工具仍由当前本地 workflow allowlist 决定，provider 不能通过伪造名称升级权限。
- Diary 上限 `16 KiB UTF-8`，Inbox 上限 `8 KiB UTF-8`；单模块上限 `18 KiB`，整体 context 上限 `32 KiB`。稳定截断返回 `truncated` 和 `omittedBytes`，UI 展示处理限制；结构化结果有字段、长度、数量、日期及时间 schema 上限。
- 敏感正文、完整 prompt、provider output、proposal payload、API Key 不写入日志、SQLite、localStorage、sessionStorage、设置、历史或缓存。请求结果只存在当前 UI 内存；不增加后台扫描、AI memory、RAG、向量库或云同步。

## 自动验证

| 检查 | 结果 |
|---|---|
| 敏感权限、对象/请求绑定、单次消费与 persistent setting 过滤 | PASS |
| Diary / Inbox context、UTF-8 上限、总预算与模糊时间约束 | PASS |
| Inbox Task / Event Proposal allowlist、取消、确认及幂等 | PASS |
| Prompt Injection / Sentinel / schema 约束 | PASS |
| Architecture boundary tests | PASS |
| Consent UI Playwright | PASS — 2 项；取消、Esc、背景关闭、范围文案、失败后重试、双击门禁及 720×520 横向溢出检查 |
| `npm run typecheck` | PASS（包含于完整门禁） |
| `npm run verify` | PASS — unit 353/353；architecture 135/135；Playwright 1029 passed、15 skipped（1044 total）；lint、Prettier、production frontend build 均通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | PASS — 97 passed，0 failed |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | PASS |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | PASS |
| `npm run tauri build` | PASS — Windows x64 EXE、MSI、NSIS 及 MSI/NSIS updater `.sig` 均生成；仅构建，未运行 EXE 或安装包 |

构建产物（`src-tauri/target/release/bundle`，不纳入 Git）：

| 文件 | 大小 |
|---|---:|
| `NTU Course Assistant_1.3.1_x64_en-US.msi` | 54,398,976 bytes |
| `NTU Course Assistant_1.3.1_x64_en-US.msi.sig` | 436 bytes |
| `NTU Course Assistant_1.3.1_x64-setup.exe` | 52,467,501 bytes |
| `NTU Course Assistant_1.3.1_x64-setup.exe.sig` | 436 bytes |

当前应用版本仍为 `1.3.1`；本阶段未修改版本号。

## 人工与 Live 状态

以下均为 **NOT EXECUTED**，不能标记为 PASS：

- Diary selected workflow 的真实 DeepSeek 请求与 Consent 体验。
- Inbox selected workflow 的真实 DeepSeek 请求与 Consent 体验。
- 真实 Prompt Injection 对抗响应。
- 真实 Inbox Task / Event Proposal 预览、确认与写入闭环。
- Windows 开发态 / 安装态人工验收。

自动验证使用本地 mock/fake provider；未读取真实 API Key、未发起真实 DeepSeek 请求、未运行 production EXE/installer，也未访问 Release 用户数据库。

## 数据库与发布边界

- `CURRENT_SCHEMA_VERSION = 7`；新增 migration：`0`。
- README / CHANGELOG：未修改。
- v2.0 未发布；本阶段不 push、不创建 tag、不发布 Release。
- Phase 4.8、AI Final Acceptance、Conversation Persistence、AI Memory、RAG、Vector Database 均未开始。

---

## Phase 4.7-P — AI / Inbox / Task UI Polish + Inbox Editable Recognition

日期：2026-09-27<br>
分支：`v2/workspace-rebase`<br>
起始基线：`6759c9f3d9626c58aab12c427cd2d23d858984cc`<br>
SQLite：schema `7`，migration `0`

### 阶段状态

- Implementation：**COMPLETE**
- Automated：**PASS**
- Windows / DeepSeek Manual Acceptance：**PENDING**（等待 Ethan 人工验收）
- Overall：**PENDING**
- Phase 4.8：**NOT STARTED**

### 修改与 Proposal 根因

- Diary 的 AI 操作按钮沿用次级按钮样式；整理结果改为有留白的卡片与受限行长。Inbox AI 按钮、识别结果卡片及本地草稿编辑区统一为产品控件样式。
- Inbox 识别结果可在当前会话中编辑：任务支持标题、描述、优先级、截止日期/时间；活动支持标题、描述、日期、起止时间与地点；类型不明时可手动选任务或活动，并可恢复 AI 初始识别草稿。原始 Inbox 文本保持只读，编辑值不写回 Inbox 或解析存储。
- Proposal 确认红字的后端根因：AI Inbox 解释不会调用 parser preview / `saveInboxParseResult`，原始项仍为 `pending`（parse kind 为空）或 `needs_review/unknown`；Rust 原子确认原先只接受 `ready` 且 parse kind 与目标一致，因而拒绝确认。前端此前又把 Tauri 的字符串错误降级为通用错误。
- 修复：保留事务、幂等与 ready 类型匹配约束；支持经本地 Proposal Review 后确认 pending/unknown 项而不改 raw/parse 数据；补 Rust 回归。确认失败仅将已知状态错误映射为具体提示，未知 backend 错误继续隐藏内部信息/路径。
- 任务新建/编辑与 TimeBlock 弹窗增加局部内边距、字段组间距、标签间距及 footer 留白；Diary / Inbox 按钮及结果呈现完成小范围样式调整。未修改字段顺序、业务校验、schema 或版本号。

### 自动验证

| 检查 | 结果 |
|---|---|
| `npm run verify` | **PASS** — unit 356/356；architecture 135/135；UI 1038 passed、15 skipped；typecheck、lint、Prettier、frontend build PASS |
| Inbox editable UI regression | **PASS** — 本地切换类型、编辑/恢复草稿、按编辑值生成活动 Proposal，原始 Inbox 不变；页面无运行时错误 |
| Inbox task Proposal adapter | **PASS** — 只采用本地规范草稿；Provider 返回不匹配参数时拒绝 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **PASS** — 98 passed，0 failed |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | **PASS** |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | **PASS** |
| `npm run tauri build` | **PASS** — Windows x64 EXE、MSI、NSIS 与 MSI/NSIS updater `.sig` 生成；仅构建 |

当前 build 资产位于 `src-tauri/target/release/bundle`，均为本地未跟踪构建产物：

| 文件 | 大小 |
|---|---:|
| `NTU Course Assistant_1.3.1_x64_en-US.msi` | 54,398,976 bytes |
| `NTU Course Assistant_1.3.1_x64_en-US.msi.sig` | 436 bytes |
| `NTU Course Assistant_1.3.1_x64-setup.exe` | 52,412,274 bytes |
| `NTU Course Assistant_1.3.1_x64-setup.exe.sig` | 436 bytes |

### 范围与人工验收

- 未改产品身份、版本号、SQLite schema、migration、AI 权限或原始 Inbox 内容；README / CHANGELOG 未修改。
- 未运行 production EXE；未安装 NSIS/MSI；未访问 Release 用户数据库；未发起真实 DeepSeek 请求。
- 等待 Ethan 检查 Diary / Inbox 样式、Inbox 草稿字段编辑与 Proposal 确认、Task 新建/编辑及 TimeBlock 弹窗视觉。自动化结果不代表 Windows 人工验收通过。
