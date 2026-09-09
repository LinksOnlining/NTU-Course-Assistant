# Phase 2.6 验证记录

日期：2026-09-09。状态：**PASS**。

本阶段只增加比例节次时间轴和用户可配置作息，没有实现 PDF、教务导入、提醒、自启动、托盘或安装包。

## 实现边界

- `PeriodTime[]` 是独立的配置边界。配置必须从第 1 节开始连续编号，节次为 1–30，时间为严格 `HH:mm`，每节开始早于结束，节次之间不得重叠；正常课间允许存在。
- `TEST_PERIOD_TIMES` 仍明确标记为 test-only。首次运行或数据库尚无作息时使用该 fallback，不能把它称为南通大学正式作息。
- 设置对话框允许编辑每节时间、添加下一节和删除最后一节；保存继续调用核心校验，不使用近似匹配，不要求手动课程填写节次。
- `getTimelineBounds` 将测试轴和作息范围合并并向整点扩展。TimeAxis 仍为连续分钟时间轴，节次块的 top、height 和课间留白都由实际时间与 `pxPerMinute` 计算。
- 课程的 `startTime`、`endTime` 不随作息变更。课程卡片只有在原有节次范围与当前作息精确匹配时显示节次，匹配失败或节次为 null 时只显示实际时间。

## SQLite 与迁移

- `user_version=1` 的旧数据库在事务中创建 `period_times` 表并升级到 schema 2；已有 `courses` 行保持不变。
- `period_times(period, start_time, end_time)` 由 Rust `load_period_times` 和 `save_period_times` command 访问。保存前再次进行完整校验，使用事务替换整套配置；失败时旧配置保持不变。
- schema 版本高于 2 仍拒绝打开，不降级、不覆盖、不删除数据。数据库位置继续由 `app_local_data_dir()` 决定。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run test:unit` | PASS，73 项 |
| `npm run test:arch` | PASS，29 项 |
| `npm run test:ui` | PASS，252 个场景中 246 项通过、6 项按既有条件跳过 |
| 作息设置 UI | PASS，编辑第 1/2 节、添加第 12 节、校验重叠、取消、保存失败回滚均覆盖 |
| 时间几何回归 | PASS，节次 top/height、课间留白、午间空闲、课程 top/height、overlap lane、七天列保持通过 |
| `npm run lint` / `npm run format:check` | PASS |
| `npm run build` / `npm run verify` | PASS |
| `cargo test` | PASS，12 项 |
| `cargo fmt -- --check` | PASS |
| `cargo clippy --all-targets -- -D warnings` | PASS |

## 真实 Windows Tauri 验收

实际执行 `npm run tauri dev`，确认运行项目 exe 的 `Tauri Window` 独立窗口，标题为“大学课程表”；验收直接连接真实 Tauri WebView，没有用浏览器替代桌面检查。本机窗口为 200% DPI。

1. 第一次启动日志显示 schema 1 数据库已迁移到 schema 2，`load_period_times` 初始为空，用户课程为 0。
2. 在真实窗口打开“设置”，把第 1 节改为 `08:00–08:30`，第 2 节改为 `08:45–09:30`，添加第 12 节并保存。Rust 读取到 12 条配置；第 1 节高度为 30px，第 1/2 节之间保留 15px 课间，课程数据数量仍为 0。
3. 关闭真实窗口并重新执行 `npm run tauri dev`。重新加载到相同的 12 条作息，第 12 节可见，第 1 节仍为 30px，第 1/2 节间隔仍为 15px，用户课程仍为 0。
4. 页面错误、控制台错误均为空；通过标准 `WM_CLOSE` 正常退出，项目进程及开发端口清理完毕。

Phase 2.6 满足全部完成标准。停止等待用户确认，不进入 Phase 3。
