# Links Workplace v2.0 — Phase 3 综合验收

日期：2026-09-24；结果：**Phase 3.0–3.8 与 Phase 3.M PASS；Phase 3 Overall = COMPLETE**；本阶段基于 Ethan 已完成人工 review 的问题，并经授权由自动综合验收收口；不代表 v2 Release Ready。

## 基线与范围

- 分支：`v2/workspace-rebase`。
- Phase 3 起点：`6bf9a54`（Phase 2 verification close）；起始 schema：6。
- Phase 3.0–3.7 基线实现 HEAD：`b356fc4`（`feat: add local workspace search`）；Phase 3.M 模块扩展架构提交：`f527f36`（`feat: add workplace module extension architecture`）。
- 阶段提交：3.0 `11fa394`；3.1 `25ca7a8`；3.2 `4ec08b5`；3.3 `c108353`；3.4 `64e0838`；3.5 `32dad97`；3.6 `b356fc4`；3.7 初次收尾文档已在基线中；3.M `f527f36`。
- `git diff --stat 6bf9a54..b356fc4`：78 个文件，新增 9,304 行、删除 207 行；变更归属隐私契约、单次数据库迁移、Diary、Inbox、Weather、Context、Routine、Search、Dashboard / Settings、测试及阶段文档。
- 未实现 Phase 4 AI；未改 Academic 核心语义、Phase 2 Planner 合同、产品技术身份或 1.3.1 版本；未新增依赖。
- README / CHANGELOG 未改动；v2 尚未发布。

## 隐私与功能边界

- **Diary**：正文只保存在本机 SQLite、编辑器及本机 Search；自动保存按日期单条、latest-write-wins、失败保留草稿并允许重试。Dashboard 仅消费“今天是否有内容”状态；正文不进入日志、Context、Weather 或网络。
- **Inbox**：先保存原始文本，再用确定性本地规则解析；不清楚的意图 / 时间要求预览和明确确认。Task / Event 创建与 Inbox 引用事务化、幂等；无 AI、远端解析、raw 日志或剪贴板/全局捕获。
- **Weather**：Open-Meteo HTTPS 是 Phase 3 唯一外部网络能力；默认关闭，仅用户主动搜索、选择城市后请求。只传城市 / 天气所需参数；使用本机缓存与失败降级，不依赖实时网络，不读取设备精确位置或其他工作区数据。
- **Context**：确定性纯投影，时间是显式输入，不做 IO、网络或 AI；仅接收 Diary 布尔状态、Inbox 数量及允许的摘要，不含 Diary 正文、Inbox raw 或完整任务描述。
- **Routine**：只生成至多一条空闲时间建议；打开或取消不写入。只有用户保存 PlannerEvent 后才原子更新日常习惯安排日期；不自动创建 Task / TimeBlock。
- **Search**：本机统一搜索课程、学业事项、个人任务、日程、考试、Diary、Inbox 七类；空查询不加载数据、不保存查询历史；排序稳定且结果上限 50。Diary / Inbox 正文仅本机匹配并生成短片段，不发送网络、不写日志；使用类型化导航对象，不提供全局快捷键或远程索引。
- **Dashboard / Settings**：真实 Diary / Inbox 状态、Weather available/cache/unavailable、最多一个 Routine 建议；AI 保持明确未开放。原课表设置边界保持。

## Module Extension Architecture（Phase 3.M）

- 以 `src/modules/` 的源码编译期 `WorkplaceModuleRegistry` 注册内置模块；模块以稳定 ID 声明 typed Route、Navigation、Settings、Search/Context provider、Permission 与未来 AI Tool 元数据。Registry 只校验、绑定、排序和冻结静态声明，不访问数据库或持有业务状态。
- Shell、Navigation、Settings、Search 与 Context 改为读取相应 contribution/provider；Search Core 不直接访问模块 repository，Context provider 仅收到本 provider 所需的结构化输入。可选 provider 独立失败隔离。
- 对重复 ID/路由、错误归属、无效权限引用、provider 声明与实现不匹配进行 fail-fast 校验；模块状态区分 registered / available / enabled。TypeScript declaration merging fixture 验证增加模块时可保留精确路由与对象定位类型。
- Runtime 第三方插件、AI 执行器、权限 UI、任意 Dashboard/Timeline 扩展仍未实现，且明确 **NOT IMPLEMENTED BY DESIGN**。契约详见 `docs/v2-module-extension-contract.md`。
- Phase 3.M 修改 37 个文件；无依赖、schema、Rust 业务、产品身份或公开版本号变更。无真实用户 DB 操作。

## 数据库与迁移

- 最终生产 schema：**7**。Phase 3 只有一条生产迁移 **6 → 7**；没有 schema 8。测试中的 schema 8 只用于验证 future-schema 安全拒绝。
- 新表：`diary_entries`（`entry_date` 唯一约束）、`inbox_items`、`routines`；新增索引 `inbox_items_status_created_at`、`routines_enabled`。字段范围、状态/时间约束和外键语义由 SQLite 与应用层验证。
- 复用既有迁移前 `VACUUM INTO` 备份和单事务迁移。测试覆盖新库直建 schema 7、schema 6 有数据迁移、有效源备份重开、Academic / PersonalTask / PlannerEvent / TimeBlock 保留、完整性与 foreign-key 检查、注入失败回滚及无半建表、数据库关闭重开、future schema 拒绝。
- Debug DB：`<app_local_data_dir>/dev-v2/courses.sqlite3`；Release DB：`<app_local_data_dir>/courses.sqlite3`。隔离测试确认两条路径不同。本次没有读取、迁移、复制或修改真实用户 DB。

## 综合验证

### 前端

`npm run verify`：**PASS**。

| 检查                      |                                        结果 |
| ------------------------- | ------------------------------------------: |
| Unit                      |                                    244 PASS |
| Architecture              |                                    114 PASS |
| UI                        | 786 PASS / 15 conditional skipped；0 failed |
| TypeScript typecheck      |                                        PASS |
| Lint                      |                                        PASS |
| Prettier format check     |                                        PASS |
| Frontend production build |                                        PASS |

完整 UI 回归包含 Diary 自动保存 / 失败重试 / 日期切换、Inbox 明确确认、Weather opt-in 与失败隔离、Context、Routine 建议确认、Search 导航/本地隐私、浅色/深色、Reduced Motion、键盘交互与目标视口响应式场景。15 条为既有条件跳过，未从测试集中删除用例。

### Rust 与离线验证

- `cargo test --manifest-path src-tauri/Cargo.toml`：**65 PASS，0 FAIL**。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：**PASS**。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`：**PASS**。
- Weather 请求失败时核心 Dashboard、Tasks、Settings、Academic、Planner Schedule、Diary、Inbox 仍可访问：Playwright **PASS**；Weather 的默认关闭 / opt-in、搜索与天气请求范围有测试覆盖。Context / Routine / Search 的确定性与本机边界由单测及架构测试覆盖。
- Search 测试显式阻止 `fetch` 并确认本机 Diary 搜索仍通过；隐私架构测试覆盖 Diary / Inbox 无网络与不记录 raw、Context 不接收正文、Weather 不读取个人仓储、Routine 不自动创建任务等边界。
- 额外聚焦复测：Weather 故障下离线核心路由、Routine 取消/确认、Search 本机定位与键盘返回：**3 PASS**。

### UI 自主视觉检查

- 使用 Playwright 合成 fixtures 截取 Dashboard `1920×1080`、`1600×900`、`1366×768`、`720×520`，以及深色 Dashboard、Diary、Inbox Preview、Weather Settings / Popover、Routine Settings / Suggestion、Search；通过 Codex 图片查看能力检查布局、溢出、文字、弹层与对比度。没有使用真实个人数据库或个人工作区内容。
- 720×520 保持可用但布局密集；低高度时 Timeline 独立滚动。深色主题在真实主题设置切换并等待 CSS transition 后检查，卡片背景计算值为深色 token `rgb(34, 42, 39)`，文本对比正常；首帧转场中的灰色截图不是稳定主题状态。
- 已知轻微视觉限制：自动定位当前时间时，时间轴 viewport 顶边恰好切过整点刻度的情况下，最上方可见整点标签可能被边界部分裁切（四个合成视口都观察到此现象）。它不改变 00:00 / 24:00 边界规则、1 分钟 = 1px、课程块或 current-time 的业务坐标；本轮未改 Phase 1 Timeline 布局，留待专门 UI polish 处理。
- Reduced Motion 与键盘路径不以截图代替：由 Playwright 回归断言覆盖。

## 依赖、版本与身份

- 对比 `6bf9a54` 的 `package.json` / `package-lock.json` / `src-tauri/Cargo.toml` / `Cargo.lock`：**无依赖变更**。Weather 使用浏览器原生 `fetch` 与精确 HTTPS CSP allowlist，无新运行时依赖。
- 保持版本 `1.3.1`、`productName = NTU Course Assistant`、identifier `com.ntu-course-assistant.desktop`、Windows 标题 `大学课程表`、既有 GitHub updater endpoint 与仓库身份。Links Workplace 仅是当前 v2 React 产品外壳品牌；系统级品牌 / installer identity 迁移尚未开始。

## Production Build 与产物

- 命令：`npm run tauri build`；**PASS**。使用仓库外隔离 `CARGO_TARGET_DIR`，没有结束或覆盖既有进程，也没有运行 EXE 或安装安装包。
- Phase 3.M 对应构建目录：`C:\Users\LinYu\AppData\Local\Temp\links-workplace-phase3m-target-20260924163804\release`。以下 SHA-256 均为实际文件计算值；签名文件为 436 bytes。

| 产物           | 完整路径                                                                                                                                          | 大小（bytes） | SHA-256                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: | ------------------------------------------------------------------ |
| EXE            | `C:\Users\LinYu\AppData\Local\Temp\links-workplace-phase3m-target-20260924163804\release\ntu-course-assistant.exe`                                 |    67,395,072 | `673DCE9F8660AEFD6850F325F13B296BFC9A93E4BCA1D8F44461CF1ED07E4ACC` |
| NSIS           | `C:\Users\LinYu\AppData\Local\Temp\links-workplace-phase3m-target-20260924163804\release\bundle\nsis\NTU Course Assistant_1.3.1_x64-setup.exe`     |    52,235,586 | `754DA4356F072BFBD29D80681EE9C0099A3215AACC7851CF92784FD722E10497` |
| NSIS signature | `C:\Users\LinYu\AppData\Local\Temp\links-workplace-phase3m-target-20260924163804\release\bundle\nsis\NTU Course Assistant_1.3.1_x64-setup.exe.sig` |           436 | `99AC5803262BC26571DF1192A7515DF14E5EFC99235D911888CB4ADD37D523D3` |
| MSI            | `C:\Users\LinYu\AppData\Local\Temp\links-workplace-phase3m-target-20260924163804\release\bundle\msi\NTU Course Assistant_1.3.1_x64_en-US.msi`      |    54,173,696 | `812E4B73524BD8AC0BD363673CFB17B101F5ED66671BAA7DA044CB639B949E85` |
| MSI signature  | `C:\Users\LinYu\AppData\Local\Temp\links-workplace-phase3m-target-20260924163804\release\bundle\msi\NTU Course Assistant_1.3.1_x64_en-US.msi.sig`  |           436 | `B1F2CFF100DB681E99DB58FF4EFF0BD99B2358ADE9761DAFFD46B4C607AC8CCA` |

- 不提交以上 binaries。Production EXE **未运行**；NSIS / MSI **未安装**；真实安装态兼容性 **NOT VERIFIED**；Updater E2E **NOT EXECUTED**。未创建 tag、未 push、未发布 Release。

## 已知限制与下一步

- Diary 是每日纯文本，不含 Markdown / 标签 / PKM；Inbox 只接收文本，解析器是小型确定性本地规则；不支持模糊时间自动推断。
- Weather 依赖 Open-Meteo / Photon 服务可用性与其当前条款；设备定位仅在用户主动开启并确认后请求，不做后台轮询或位置历史。Routine 是软建议，不支持 RRULE / 自动重复任务。Search 仅限本机。AI 未实现。
- 系统级品牌迁移、Installer compatibility、Updater E2E 尚未验证。Phase 3 COMPLETE 不等于 Release Ready。
- Phase 3.M、Phase 3.7 与 Phase 3.8 最终门禁完成；下一步仅等待 Ethan / ChatGPT 确认后进入 Phase 4；不自动进入 Phase 4。

## Phase 3.8 — Windows 11 UI / UX Polish

**状态：PASS。** 本阶段根据 Ethan 已完成的 Windows 11 真实界面 review 项进行小范围体验修整；按已给出的验收授权使用自动化验证收口，没有额外操作 Windows 桌面、安装器或真实用户数据。

### 体验修改

- **Search：** 输入框与结果区域保留可读、可选文本；焦点环与搜索头部布局稳定；将重复清除入口收敛为一个可访问的清除按钮，并保留键盘焦点路径。
- **Weather Location：** 天气仍默认关闭且仅在用户操作后联网。手动搜索结果携带可靠的行政层级、定位精度及来源元数据。使用当前位置前需应用内二次确认及浏览器定位授权；坐标先四舍五入到三位小数，定位超时、精度差、权限拒绝或逆向地理解析失败均显示真实精度/失败状态，保留手动搜索和仅坐标天气回退，不猜测行政区、不保存位置历史或完整精度历史。
- **Weather Header：** 以无边框、透明的紧凑行显示短地点与天气；完整层级、来源和精度放入不挤动布局的详情浮层，支持键盘、Escape、外部点击和深色主题。
- **Dashboard：** Today 摘要与工作区之间增加轻微呼吸间距；紧凑窗口高度自动缩小，不扩大顶部画布。摘要入口可键盘操作并展示只读详情：课程/计划项按时间排序、显示来源与取消状态；任务仅含逾期或今天到期的未完成项；详情数目与摘要计数一致，并处理空状态、Esc/外部点击及焦点返回。
- **Inbox：** 明确标注“原始内容”与“整理预览”，并提示预览在用户确认前不会写入任务或日程。
- **Header / Diary：** Shell 头部标签不可被误选；课程、搜索结果、Inbox/Diary 正文仍可选择。Diary 已保存状态弱化显示，保存中与保存失败用各自清晰且不过度抢眼的状态表达；自动保存逻辑未改变。

### Timeline 与架构边界

- Timeline 几何改动：**NO**。仍为 **1 minute = 1px**；课程块、Current Time、滚动高度与时间业务坐标未因本阶段修改。
- 00:00 / 24:00 边界标签仍由现有 UI regression 覆盖并保持在时间轴内容边界内。已知限制仍是自动定位时 viewport 顶边恰好切过整点刻度时，最上方可见的整点标签可能被裁切；本阶段不改变 Timeline，也未声称该限制已修复。
- Weather 网络由独立 provider 适配器限定为 HTTPS 的 Open-Meteo 与 Photon；非天气页面不访问它们。定位只从用户操作路径触发。Search 继续本机读取；Dashboard 详情由 Workspace application projection 提供，不将 deadline 变为时间轴安排。Module Extension contract、数据库 schema、Rust 业务、产品身份、依赖、README/CHANGELOG 均未改变。

### Phase 3.8 验收

- 定向 Unit / Architecture：**31 PASS**；定向 1280×100 UI：**6 PASS**，覆盖天气权限与隐私、Dashboard 摘要、Search 与交互状态。
- 完整 `npm run verify`：**PASS**。Unit **246 PASS**；Architecture **114 PASS**；UI **795 PASS / 15 条件跳过 / 0 FAIL**；TypeScript、Lint、Prettier 与 Vite production build 均 PASS。
- Rust：`cargo test` **65 PASS / 0 FAIL**；`cargo fmt -- --check` **PASS**；`cargo clippy --all-targets -- -D warnings` **PASS**。
- `npm run tauri build`：**PASS**。构建目标为 `%TEMP%\links-workplace-p38-target-20260924-182249\release`（仓库外隔离目录）。产物：EXE `ntu-course-assistant.exe`（67,399,168 bytes）；NSIS `NTU Course Assistant_1.3.1_x64-setup.exe`（52,173,642 bytes）及 `.sig`（436 bytes）；MSI `NTU Course Assistant_1.3.1_x64_en-US.msi`（54,177,792 bytes）及 `.sig`（436 bytes）。
- 本阶段未运行 EXE、未安装 NSIS/MSI、未访问 Release DB 或真实用户数据；安装兼容性与 Updater E2E 仍未验证。没有使用 Computer Use 操作 Windows 界面。
- 版本 `1.3.1`、identifier `com.ntu-course-assistant.desktop`、product name `NTU Course Assistant`、Windows 标题 `大学课程表`、schema `7` 保持不变；无 push、tag 或 Release。

### 阶段状态

- Phase 3.8：**PASS**。
- Phase 3 Overall：**COMPLETE**。
- Phase 3.M：**COMPLETE**。
- Phase 4：**NOT STARTED**。下一步仅为等待 Ethan / ChatGPT 确认后进入 Phase 4。
