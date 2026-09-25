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

## Phase 3.8.1 — Detailed Weather Location Search

**状态：PASS（实现、自动回归与 production build）。Phase 4 未开始。**

### 根因与修复

- 根因在生产 provider 组合，而不是 Photon layer/UI 过滤：`createWorkspaceWeatherProvider()` 原先先组合 Open-Meteo provider（含 `searchLocation`），随后只覆盖 Photon 逆向地理编码；因此手动查询实际仍发送到 Open-Meteo 城市/邮编 geocoder，`崇川区` 等详细地点被该服务漏掉。结果列表没有额外 city-only 过滤。
- 手动搜索现改用 Photon forward `/api?q=...&lang=zh&limit=12`；不发送 `layer` 或固定 `countrycode`，避免限制有效结果。Photon 官方 API 文档将 `/api` 定义为地点名称/地址 forward search，并列出 house、street、locality、district、city、county、state、country 与 other layers；`lang`、`limit` 是支持参数。[Photon API docs](https://github.com/komoot/photon/blob/master/docs/api-v1.md)
- 只有用户提交表单时才请求；原始查询无结果时，最多尝试一次去掉末尾中文行政后缀的等价 query。候选只来自 Photon，不推测城市或地点。
- 归一化使用 GeoJSON `[longitude, latitude]`、名称/上级层级和可用 OSM identity；接受全部列明 granularity，未知 layer 只要有可靠名称与合法坐标也保留。结果按精确名称、locality/district/street、city、其他稳定排序，并按 OSM identity 或坐标去重。
- 搜索结果可保存街道名称及上级层级，但不保存 house number；不保存搜索历史。UI 第一行显示最具体名称，下一行显示层级；空态仅用于 provider 返回空 feature collection，损坏/不兼容响应会走错误状态。
- Open-Meteo 保持只负责预报：请求使用用户所选 `WeatherLocation` 的原始 latitude/longitude，不再转换为城市中心。当前位置二次确认、系统定位授权、坐标模糊化、Photon reverse geocoding、精度失败回退和隐私边界保持不变。

### 回归与构建

- Photon fixture 覆盖：`崇川区`、`南通市崇川区`、`文峰街道`、`南通市崇川区文峰街道`、`青年中路`、`南通大学`；另覆盖缺 city 的 district、缺 district 的 locality、house/POI/street/county/state/country/unknown layer、重复 OSM identity、行政后缀 fallback 和 malformed response。
- 定向 UI：输入期间不联网；提交后请求 Photon；选择 district 与 street 时 UI 层级准确，Open-Meteo forecast URL 逐次使用对应所选坐标；不再请求 Open-Meteo geocoding endpoint。Weather unit **12 PASS**、Weather architecture **3 PASS**、详细搜索 UI **1 PASS**。
- `npm run verify`：最终完整重跑 **PASS**；Unit **251 PASS**，Architecture **114 PASS**，UI **795 PASS / 15 条件跳过 / 0 FAIL**；TypeScript、Lint、Prettier 与前端 production build 均 PASS。此前两轮完整回归出现少量 Playwright `beforeEach` 导航点击超时；相关失败用例分别单独重跑通过，最终完整回归无失败。
- Rust 无源码修改；`cargo test`：**65 PASS / 0 FAIL**。
- `npm run tauri build`：**PASS**，版本 **1.3.1**，2026-09-24。构建产物位于 `src-tauri/target/release`（该目录被忽略，不进入提交）：

| 产物 | 大小（bytes） |
| --- | ---: |
| `ntu-course-assistant.exe` | 67,399,168 |
| `NTU Course Assistant_1.3.1_x64-setup.exe` | 52,304,823 |
| `NTU Course Assistant_1.3.1_x64-setup.exe.sig` | 436 |
| `NTU Course Assistant_1.3.1_x64_en-US.msi` | 54,177,792 |
| `NTU Course Assistant_1.3.1_x64_en-US.msi.sig` | 436 |

- Live Photon diagnostic 不具结论性：本机 PowerShell 请求收到 HTTP 400，随后 `curl` 请求超时；未将其伪称为成功或 provider 能力失败。自动验收使用 fixtures，不依赖第三方实时服务。Codex 未运行 production EXE、未安装 NSIS/MSI、未触碰真实用户 DB，也未使用 Computer Use；Windows 真实界面复验需 Ethan 自行确认。
- 无 schema、依赖、版本、Tauri/Rust、课程或其他工作区功能变更；无 tag、push 或 Release。

### 阶段状态

- Phase 3.8.1：**PASS（自动回归与构建门禁）**。
- Phase 3：**COMPLETE**。
- Phase 4：**NOT STARTED**；等待 Ethan / ChatGPT 明确确认。

## Phase 3.8.2 — Weather Geocoding Reliability Fix

**状态：实现、自动回归、live provider 诊断、Tauri production build 与 Windows 11 人工验收均 PASS；Phase 3.8.2 COMPLETE。**

### 根因与边界

- 确认的 Photon 请求错误是 `lang=zh`：该值导致 HTTP 400。当前 forward/reverse 请求统一使用 Photon 支持的 `lang=default`。HTTP 400 映射为 `invalidProviderRequest`，不触发 Nominatim fallback；HTTP 200 且空 feature collection 直接返回“没有匹配地点”，不改写或重复发送 query。
- 之前的现象不能证明 WebView CORS 是根因；本轮未把 CORS 当作已确认原因。为减少 WebView/CSP 对公共 geocoder 的额外变量，Photon 与 Nominatim 请求通过 Tauri Rust Native HTTP 命令执行。Open-Meteo 仍只提供天气预报，并保持与 geocoding 的 transport / error 状态分离。
- Photon 仅在网络/timeout、HTTP 5xx、响应损坏/无法归一化，或 reverse 没有可用结果时才回退到 Nominatim。前向 Photon 正常返回空结果时不回退。错误分类分别保留地点搜索、逆向地点解析、天气预报、权限、定位超时、精度及 offline 状态；失败不阻塞 Dashboard / Settings 等本地功能。
- Rust HTTP timeout 为 8 秒；Nominatim 仅由用户主动触发，使用带产品标识的 User-Agent，跨请求保留最多 1 次/秒节流，结果仅存短期内存缓存（15 分钟、最多 64 条）。请求日志只写 provider/操作/status/content type/耗时/结果类别与数量，不写 query、坐标或地址。Reverse 输入先按三位小数取整；天气预报使用最终选中的准确地点坐标。界面提供 OpenStreetMap contributors attribution。
- Tauri CSP 仅保留 Open-Meteo forecast 域名；Photon/Nominatim 不向 WebView 开放。SQLite schema 仍为 7；没有课程数据、数据库 migration、应用版本或产品身份改动。Cargo 增加 Native HTTP 所需的 `reqwest` / `rustls` / `tokio`，没有新增前端运行时依赖。

### Live Provider 诊断（2026-09-25）

| 请求 | HTTP | 耗时 | 原始结果 / 可归一化结果 |
| --- | ---: | ---: | ---: |
| Photon forward `Berlin` | 200 | 3299 ms | 12 / 12 |
| Photon forward `南通大学` | 200 | 2075 ms | 12 / 12 |
| Photon forward `崇川区` | 200 | 1874 ms | 6 / 6 |
| Photon reverse（公开坐标：Brandenburg Gate） | 200 | 2221 ms | 1 / 1 |

测试使用公开城市查询与公开地标坐标，不使用用户设备位置。Nominatim 策略、fallback 成功/失败与保密归一化由本地 mock tests 覆盖，没有执行 Nominatim bulk/live 查询。

### 自动验证与构建

- Weather Unit + Weather / module-boundary Architecture 定向测试：**24 PASS**；Weather UI 定向 Playwright：**27 PASS**（9 个 viewport / scale 项目组合）。
- 最终完整 `npm run verify`：TypeScript typecheck PASS；Unit **253 PASS**；Architecture **114 PASS**；UI **804 PASS / 15 条件跳过 / 0 FAIL**；lint、Prettier 与前端 production build PASS。Vite 输出一个既有 chunk size 提示，不影响构建。
- 初次完整回归有两条跨 viewport 的非天气 UI 用例在页面初始化时得到空白首帧；两条用例各自单独重跑 PASS，之后最终完整回归为 **0 FAIL**。
- Rust：`cargo test` **74 PASS / 0 FAIL**；`cargo fmt -- --check` PASS；`cargo clippy --all-targets -- -D warnings` PASS。
- `npm run tauri build` 首次不能覆盖仓库 target 下已被运行中的 `ntu-course-assistant.exe` 锁定的文件；未关闭或终止该用户进程。随后将 `CARGO_TARGET_DIR` 指向系统临时目录重跑同一 production build，**成功**，不运行产出的 EXE，也不安装 MSI/NSIS。

Production artifacts（2026-09-25，临时构建目录 `%TEMP%\links-workplace-p38-2-target-20260925-003826\release`，未纳入 Git）：

| 产物 | 大小（bytes） |
| --- | ---: |
| `ntu-course-assistant.exe` | 67,738,624 |
| `NTU Course Assistant_1.3.1_x64-setup.exe` | 52,241,643 |
| `NTU Course Assistant_1.3.1_x64-setup.exe.sig` | 436 |
| `NTU Course Assistant_1.3.1_x64_en-US.msi` | 54,267,904 |
| `NTU Course Assistant_1.3.1_x64_en-US.msi.sig` | 436 |

### Windows 11 Tauri 人工验收

Ethan 于 **2026-09-25** 确认以下真实 Windows 11 人工结果；此记录来自用户报告，Codex 未代替用户操作桌面：

| 项目 | 结果 |
| --- | --- |
| 手动地点搜索 | PASS |
| 使用当前位置 | PASS |
| 离线 / Provider 失败降级 | PASS |
| 来源说明、隐私与后台请求行为 | PASS |

### 阶段状态

- Phase 3.8.2 自动验证、production build 与 Windows 11 Tauri 人工验收：**PASS**；Phase 3.8.2：**COMPLETE**。
- Phase 4.0 起始硬门禁：branch `v2/workspace-rebase`、HEAD `3838cb807975b3937805a9a0fc2f74dbc19cfc93`、工作区 clean、`git diff --check` PASS；按 Ethan 授权进入 Phase 4.0。Phase 4.0 完成前不执行 schema 变更或 Provider 请求。
- 未运行 production EXE / installer、未访问真实用户 DB；未 push、未创建 tag、未发布 Release。
