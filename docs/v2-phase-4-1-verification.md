# Links Workplace v2.0 — Phase 4.1 验证记录

状态：**实现完成；自动验证通过；Windows 真实 DeepSeek 验收待 Ethan。** 本记录不表示真实 API 已调用、软件已发布或 Phase 4.1 整体已完成。

## 一、基线

- 项目：`D:\AI_Workspace\Projects\NTU-Course-Assistant`
- Branch：`v2/workspace-rebase`
- 起始 HEAD：`82e1d712a2a82156201411103e84a6eefa1b057e`
- 最终 HEAD：包含本验证记录的本阶段实现提交；未推送，具体 hash 见最终 Git 执行记录。
- 产品配置版本：`1.3.1`（沿用仓库版本，本阶段未做版本发布或升级）
- SQLite schema：7；AI migration：0

## 二、DeepSeek Provider

- Provider ID：`deepseek`
- Base URL：固定 `https://api.deepseek.com`
- Generation API：`POST /responses`
- Models API：`GET /models`
- 默认模型：`deepseek-flash`
- 允许生成的模型：`deepseek-flash`、`deepseek-v4-pro`
- 真实网络所在层：Rust Native `reqwest`
- Browser `fetch` / WebView 直连：NO
- Phase 4.0 `AIProvider`：复用；Mock Provider 保留。
- Phase 4.0 contract 类型调整：`AiProviderId` 将尚未实现的 `openai` 标识替换为首个实际 Provider `deepseek`；`AiValueSchema` 增加 `name` 与 `jsonSchema`，为结构化 Responses 请求提供调用方定义的格式。未增加 Context、权限运行时、Tool 或 Proposal 执行能力。

## 三、Native Transport

- HTTP client：`reqwest 0.13.4`，复用仓库已有 client。
- TLS：`rustls 0.23`，`ring` provider；`reqwest` 使用 `rustls-no-provider` feature。
- Redirect：禁用自动重定向。
- Endpoint allowlist：仅代码常量 `https://api.deepseek.com`，无可配置 Base URL。
- Timeout：模型列表测试 5–15 秒（UI 使用 12 秒）；生成请求 5–120 秒（默认 30 秒）。
- Cancellation：没有显式 request registry / `cancel_ai_request`。依任务允许，Foundation **DEFERRED TO PHASE 4.5**；不得宣称取消 API 已实现。
- Response body 上限：2 MiB，Content-Length 与分块读取均受限。
- 官方协议依据：[Responses API](https://api-docs.deepseek.com/api/create-response/)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)、[Lists Models](https://api-docs.deepseek.com/api/list-models/)（核对于 2026-09-26）。

## 四、Credential

- Backend：Windows Credential Manager，经 `keyring 3.6.3` 的 `windows-native` feature。
- Namespace：`links-workplace.ai`
- Account：`deepseek.default`
- Raw Key 返回 frontend：NO。仅保存 API 的瞬时 Tauri invoke payload 含输入值；状态命令只返回 configured 布尔值。
- SQLite / localStorage / 普通 Settings / logs / backup：均不存储 API Key。
- Windows Credential Manager 未在自动测试中写入真实用户凭据；需由 Ethan 在本机手动验收。

## 五、AI Settings

- Provider：仅显示 DeepSeek，Mock 仍为离线测试 Provider；无 OpenAI、Claude、Gemini 等未实现选项。
- API Key：密码输入；输入可粘贴；保存后清空；仅展示是否已配置。
- Replace / Delete：用户明确操作；401 不会自动删除密钥。
- Model：默认 Flash；Discovery 结果仅展示两个内建模型；已存模型不可用时保留原选择并提示。
- Reasoning：默认关闭；仅在模型 Discovery 确认支持时允许 `low/high/max`。
- Timeout：5–120 秒，默认 30 秒。
- Connection Test / Model Refresh：均由用户主动触发，只请求 `/models`，不发送 prompt 或 Workspace 数据。
- 非敏感配置：设备本地设置存储，只白名单持久化 Provider、Model、Reasoning、Timeout。

## 六、请求与错误

- Text generation：显式 `prompt` 经固定 `POST /responses` 发送；Phase 4.1 没有生成 UI 入口。默认 reasoning 明确为 `none`。
- 响应：只归一化 assistant 最终 `output_text`、模型、时间和 token 用量；不暴露原始 Provider JSON 或 reasoning 内容。
- Structured output：Responses `json_schema`；Rust 解析 JSON；Application 再调用传入的 `AiValueSchema.parse` 进行本地业务结构校验。
- 错误分类：401 invalidCredential；403 forbidden；429 rateLimited；400/422 invalidRequest；5xx providerUnavailable；网络 networkUnavailable；超时 timeout；过大/错误响应 invalidResponse；无输出 emptyOutput；非 JSON invalidJson；本地校验失败 schemaMismatch；未完成输出 truncatedOutput。
- HTTP 错误正文不直接返回 UI；仅允许安全白名单 Provider code；错误消息不含 Key、Authorization header 或完整 prompt。

## 七、安全与数据库边界

- WebView AI network：NO；CSP 未加入 DeepSeek。
- Generic HTTP / generic Secret Tauri command：NO；命令仅为 DeepSeek 专用操作。
- Prompt / Secret logs：NO；请求/错误不输出敏感内容。
- Reasoning content persisted：NO。
- Tool Calling / AI DB writes：NO。
- SQLite schema：7；migration：0；`CURRENT_SCHEMA_VERSION` 未改变。
- Release 用户数据库：未读取、未迁移、未修改。

## 八、自动验证

- Targeted TypeScript typecheck：PASS。
- Targeted unit + architecture：75 passed。
- Targeted AI Settings Playwright：4 passed，包含明暗主题与 720×520 小窗。
- Targeted Rust AI tests：11 passed。
- `npm run verify`：PASS；266 unit、123 architecture、849 UI passed、15 UI skipped；TypeScript、lint、Prettier、frontend build 均通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：88 passed，0 failed。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：PASS。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`：PASS。
- UI 自动化通过 Tauri invoke mocks 执行；不代表真实 Windows Credential Manager 或真实 DeepSeek API 手动验收通过。

## 九、Windows Production Build

- `npm run tauri build`：PASS；本地用户级 updater signing 环境仅检查存在性，实际值未打印。
- Raw EXE：`src-tauri/target/release/ntu-course-assistant.exe`，67,853,824 bytes；SHA-256 `525F47C82F6B775941E19C5A7231E38525A50E943153771E952ED2CB285AB286`。
- MSI：`NTU Course Assistant_1.3.1_x64_en-US.msi`，54,329,344 bytes；SHA-256 `3C210DD60EE17DEF035DBABCB049DFF2FDF398DD151CD2B5A17A981D8791B14D`。
- MSI signature：`NTU Course Assistant_1.3.1_x64_en-US.msi.sig`，436 bytes，由本次构建生成。
- NSIS：`NTU Course Assistant_1.3.1_x64-setup.exe`，52,419,249 bytes；SHA-256 `E2D0A798BEE4514E649F96BBF3E322F857C77C9EE225BE4D52CD9E0D7DEDD589`。
- NSIS signature：`NTU Course Assistant_1.3.1_x64-setup.exe.sig`，436 bytes，由本次构建生成。
- 以上构建产物保留于忽略目录 `src-tauri/target/`；未运行 EXE，未安装任何安装包。

## 十、Live / Manual 验收

- DeepSeek 真实 API：**NOT EXECUTED**；本次未使用用户 API Key。
- Windows 真实 Credential Manager / 应用内设置：**PENDING**。
- 建议一次性手动清单：
  1. 在 Windows 11 开发态 Settings → AI 输入自己的 DeepSeek API Key 并保存（不要把 Key 发给 Codex）；确认输入框清空且只显示“已配置”。
  2. 点击“测试连接”，确认只进行模型列表查询；再点“刷新模型”，检查 Flash / V4 Pro 与已保存选择。
  3. 重启开发态应用后确认密钥状态仍为已配置；从设置显式删除后确认显示未配置。
  4. 如要验证 Text / Structured Transport 的真实在线行为，须在 Phase 4.1 的无 UI Provider 测试入口之外另行明确授权；本阶段不提供聊天或生成测试按钮。
- 真实在线检查期间可能发生的外部服务访问应仅发送请求内容，不发送课程、任务、日记、Inbox、天气或搜索数据；Connection Test / Refresh 不发送任何用户文本。

## 十一、Git 与阶段状态

- README / CHANGELOG：未修改（按阶段要求）。
- Push / Tag / Release：NO。
- Phase 4.0：COMPLETE。
- Phase 4.1 Implementation：COMPLETE。
- Phase 4.1 Automated：PASS。
- Phase 4.1 Live Manual：PENDING。
- Phase 4.1 Overall：PENDING。
- Phase 4.2：NOT STARTED。
