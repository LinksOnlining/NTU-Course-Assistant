# Links Workplace v2.0 — Phase 3.1 验证记录

日期：2026-09-24  
结果：**Phase 3.1 PASS**  
范围：schema 6→7 与本地私人日记端到端基础；没有进入 Phase 3.2。

## 数据库迁移

- 复用现有 migration、`VACUUM INTO` 一致性备份、事务、校验与回滚框架；不增加第二套迁移框架。
- 唯一生产迁移为 schema `6→7`，新增 `diary_entries`、`inbox_items`、`routines` 及查询所需索引。没有增加第二条迁移。
- 迁移测试使用隔离临时数据库，包含 Academic 数据、PersonalTask、PlannerEvent、TimeBlock；验证迁移后保留、schema 6 源备份可重新打开且完整性通过、注入失败后回滚并无半建表。
- Fresh DB 直接建立 schema 7，不创建伪造迁移备份；future schema 仍安全拒绝。
- Debug/Release 数据库路径未变更。本轮没有打开、迁移、复制或修改真实用户数据库。

## Diary 行为与隐私

- Rust repository 提供按本地日期读取、按日期唯一 upsert、近期非空日期提示和只读存在性查询；更新同一天条目保留原 ID 与 createdAt，重开数据库后内容可回读。
- `workspace/diary` 是中文纯文本页面，提供上一天/下一天/今天、近期内容日期与单个 textarea；不加载全部历史正文。
- 自动保存采用 550ms 防抖及有序 single-flight revision；快速编辑/慢写入不会让旧值覆盖新值。保存失败时正文留在编辑器中，显示失败并允许重试。
- 日期切换、编辑器失焦与离开 Diary 路由会 flush pending save；没有改变主窗口 close-to-tray 生命周期。关闭主窗口只隐藏窗口，页面不会因关闭动作被销毁。
- Dashboard 仅接收当天“有/无非空日记”的布尔状态，点击进入 `workspace/diary`；不显示标题或正文。
- Diary body 不实现日志输出或网络/天气/AI/analytics 路径；Rust Diary model 不实现 Debug 格式化。

## 自动验证

- `npm run verify`：**PASS**，204 unit、93 architecture、732 UI PASS / 15 条件跳过；typecheck、lint、Prettier、前端 build 均 PASS。
- Rust：**PASS**，58 tests；`cargo fmt -- --check` 与 `cargo clippy --all-targets -- -D warnings` PASS。
- 针对性回归覆盖 Diary autosave 顺序、快速输入、失败重试、日期切换、路由离开、Dashboard 布尔状态、浅色/深色、720px 紧凑 UI 与 schema migration。
- Playwright 全量运行中的一次孤立浏览器白屏/启动超时在单测重跑中通过；随后完整 `npm run verify` 全量 PASS。

## 未执行与边界

- 未执行真实 Windows 独立窗口人工验收；自动化通过不等同于人工 UI 验收。
- 未运行 Production EXE，未安装 NSIS/MSI，未执行 updater E2E。
- 产品版本保持 1.3.1；没有进入 Phase 4、品牌/identifier 迁移、发布、push 或 tag。
