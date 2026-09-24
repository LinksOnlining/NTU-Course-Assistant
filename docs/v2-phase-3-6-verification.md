# Links Workplace v2.0 Phase 3.6 验证记录

## 范围

建立本机统一搜索入口 `workspace/search`。只搜索本地 Academic、PersonalTask、PlannerEvent、Diary 与 Inbox 数据；不新增 schema、搜索历史、远端索引、网络请求或全局快捷键。

## 行为与隐私边界

- 搜索入口使用类型化 `NavigationTarget` / `ObjectRef`，覆盖课程、学业事项、个人任务、日程、考试、日记和收件箱；TimeBlock 不作为独立结果。
- 空查询只显示输入提示，不加载全库数据。首次输入非空关键词后，才经本地应用/存储读取器加载数据；页面内后续查询复用已加载快照，不持久化 query 或搜索历史。
- 排序纯本地且确定：标题完全匹配、前缀、包含、元数据包含、正文包含；同级按 active 状态、更新时间和稳定来源顺序排序，最多返回 50 条。
- 支持 Unicode NFKC、大小写不敏感和空白归一化；正文只在本机匹配，可展示简短 snippet，结果对象不携带 Diary/Inbox 原始正文索引字段。
- Diary / Inbox 不访问网络；未加入 Ctrl+K、全局快捷键、AI 或新依赖。Academic 数据通过现有 Academic application boundary 加载，PersonalTask、PlannerEvent、Diary 和 Inbox 使用本地读取边界。
- 结果点击后可定位日记日期、收件箱条目、个人任务或日程日期；Academic 结果进入对应既有页面。

## 针对性验证

- `npm run typecheck`：PASS。
- Workspace Search、Academic application、navigation 单元测试：21 PASS。
- Workspace Search architecture/privacy 测试：2 PASS。
- Playwright 本机搜索专项（`1280-100`）：1 PASS；覆盖私人日记定位、无结果、Escape 返回、日程日期定位、Dark theme、多视口横向溢出，以及空查询不读取搜索数据。
- Rust 日记与搜索读取专项：1 PASS；PlannerEvent 数据专项：2 PASS。
- `cargo fmt -- --check` 对本次修改格式：PASS（已运行 `cargo fmt`，完整 fmt gate 在 Phase 3.7 执行）。
- 未运行完整 `npm run verify` / 全量 Rust 测试；留到 Phase 3.7 综合门禁。

## 未执行

未运行 Production EXE、未安装 NSIS/MSI、未访问真实用户数据库；未新增数据库 migration。Search 只在查询首次变为非空时读取本机数据，不请求网络。
