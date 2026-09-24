# Links Workplace v2.0 — Phase 3 综合验收

日期：2026-09-24；结果：**Phase 3.0–3.7 PASS；Phase 3 Overall = COMPLETE**；授权：Ethan 已授权自动综合验收，本结论不代表 v2 Release Ready。

## 基线与范围

- 分支：`v2/workspace-rebase`。
- Phase 3 起点：`6bf9a54`（Phase 2 verification close）；起始 schema：6。
- Phase 3 实现 HEAD：`b356fc4`（`feat: add local workspace search`）；最终收尾文档由本文件与 `PROJECT_STATUS.md` 的独立文档提交收口。
- 阶段提交：3.0 `11fa394`；3.1 `25ca7a8`；3.2 `4ec08b5`；3.3 `c108353`；3.4 `64e0838`；3.5 `32dad97`；3.6 `b356fc4`；3.7 为本次文档收尾提交。
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
| Unit                      |                                    234 PASS |
| Architecture              |                                    106 PASS |
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

- 命令：`npm run tauri build`；**PASS**。因仓库内既有 Release EXE 正被进程占用，构建使用仓库外隔离 `CARGO_TARGET_DIR`，没有结束或覆盖该进程。
- 构建目录：`C:\Users\LinYu\AppData\Local\Temp\links-workplace-phase3-target-20260924043718\release`。以下 SHA-256 均为本次实际文件计算值；签名文件为 436 bytes。

| 产物           | 完整路径                                                                                                                                          | 大小（bytes） | SHA-256                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: | ------------------------------------------------------------------ |
| EXE            | `C:\Users\LinYu\AppData\Local\Temp\links-workplace-phase3-target-20260924043718\release\ntu-course-assistant.exe`                                 |    67,390,976 | `0182A49DCB312966817E3EA8818BBA3B522B397B8BB7AAE9F4369DF90E63A572` |
| NSIS           | `C:\Users\LinYu\AppData\Local\Temp\links-workplace-phase3-target-20260924043718\release\bundle\nsis\NTU Course Assistant_1.3.1_x64-setup.exe`     |    52,259,090 | `09151B74C1D5A7E8A110B01AC6C060319FAD354E6A361DFB6BF4E6F529BC0594` |
| NSIS signature | `C:\Users\LinYu\AppData\Local\Temp\links-workplace-phase3-target-20260924043718\release\bundle\nsis\NTU Course Assistant_1.3.1_x64-setup.exe.sig` |           436 | `C91C4A518A23AA7829372F6F0A804F4BFF081FE28A9FB0C106D4498EE3D3B8CE` |
| MSI            | `C:\Users\LinYu\AppData\Local\Temp\links-workplace-phase3-target-20260924043718\release\bundle\msi\NTU Course Assistant_1.3.1_x64_en-US.msi`      |    54,169,600 | `9F157EC770790B43263E66BEF06F8C21F9AD450A00227BB936891D79DB9BD75C` |
| MSI signature  | `C:\Users\LinYu\AppData\Local\Temp\links-workplace-phase3-target-20260924043718\release\bundle\msi\NTU Course Assistant_1.3.1_x64_en-US.msi.sig`  |           436 | `444528FF471C67FED8154D9BF0B518B6E1749E8B048F334CA0FCF0428D4E70DE` |

- 不提交以上 binaries。Production EXE **未运行**；NSIS / MSI **未安装**；真实安装态兼容性 **NOT VERIFIED**；Updater E2E **NOT EXECUTED**。未创建 tag、未 push、未发布 Release。

## 已知限制与下一步

- Diary 是每日纯文本，不含 Markdown / 标签 / PKM；Inbox 只接收文本，解析器是小型确定性本地规则；不支持模糊时间自动推断。
- Weather 依赖 Open-Meteo 服务可用性与其当前条款；设备地理定位未实现。Routine 是软建议，不支持 RRULE / 自动重复任务。Search 仅限本机。AI 未实现。
- 系统级品牌迁移、Installer compatibility、Updater E2E 尚未验证。Phase 3 COMPLETE 不等于 Release Ready。
- 下一步：等待 Ethan / ChatGPT 审核 Phase 3 总结并规划 Phase 4；本轮到此停止，不自动进入 Phase 4。
