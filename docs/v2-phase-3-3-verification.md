# Phase 3.3 — Weather Context 验证记录

日期：2026-09-24
分支：`v2/workspace-rebase`
本阶段目标：在不改变核心应用可用性的前提下，增加用户主动启用的天气上下文。

## 实现

- Provider：Open-Meteo 官方 Geocoding 与 Forecast HTTPS API；原生 `fetch` 集中于 `src/services/weather-provider.ts`，无新增依赖。
- 位置：用户启用后主动提交地点搜索并选择结果；持久化城市显示名、城市级经纬度及 provider timezone。不读取设备定位。
- 预报：归一化 current、最多 48 小时 hourly、7 日 daily；UI 不依赖 provider 原始 JSON。
- 设置：`工作台 → 天气` 包含启用、地点搜索/选择、摄氏/华氏切换和手动刷新；关闭状态不发网络请求。Header 只在启用并选中地点时显示，Popover 展示当前、未来小时、7 日、地点与更新时间。
- 缓存：本机 `links-workplace.weather.settings` 和 `links-workplace.weather.cache`；无 SQLite 表、无 schema migration。30 分钟内 fresh；24 小时内 stale-but-usable；超时、损坏、地点不匹配或超过 24 小时不作为有效缓存。无缓存网络失败显示不可用；有未过期缓存显示缓存值及失败状态。
- 隔离：请求有 10 秒超时；Weather 的请求失败不会阻断 Dashboard、任务、日程、日记、收件箱、Academic 或设置。
- 归属：界面标注 Open-Meteo 与 CC BY 4.0。Open-Meteo 免费 API 限非商业用途；未来商业分发前须改用符合许可的服务/方案。

## 隐私与边界

- `WeatherProvider` 只接收显式城市查询文本或已选城市坐标和天气参数；不读取/携带课程、任务、Diary、Inbox、Routine、Search 数据。
- 未启用时不请求城市搜索或天气；输入框只在用户提交后请求城市搜索。
- 仅 CSP `connect-src` 增加 `https://geocoding-api.open-meteo.com` 与 `https://api.open-meteo.com`；没有通配符、HTTP、设备定位或 SQLite/schema 变更。
- 仅 Weather service adapter 有网络 fetch；Workspace/Application UI 不直接 fetch，也不依赖其他个人仓储。

## 验证

- 定向 Weather 单元与架构测试：PASS（9 项）。覆盖默认关闭与键命名、fresh/stale/expired/未来时间、位置变化、损坏缓存清除、单位/天气代码、provider 请求参数与归一化、无效响应与 HTTP 失败、fetch/CSP/个人数据边界。
- Playwright Weather UI：PASS（2 项；先在 `1280×800` 单视口定向执行，再由本阶段 `npm run verify` 完整覆盖配置视口）。覆盖未启用零请求、显式搜索/选地点、Header/Popover/7日、单位切换、缓存失败降级，以及天气请求失败时其他核心路由仍可访问。
- 最终 `npm run verify`：PASS。TypeScript typecheck、unit 217、architecture 101、UI 759 PASS / 15 条件跳过、lint、Prettier format check、production frontend build 全部通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：PASS（62 tests；无 Rust 源码修改）。
- 首次完整回归在格式检查处发现 Weather hook 格式问题，已格式化；随后一次 UI setup timeout 未复现，定向复测通过，最终完整回归 PASS。
- 未执行真实 provider 实时网络 smoke；CI/UI 测试使用 mock/拦截数据，不依赖第三方服务。
- 未运行 Tauri production build/EXE/安装器；未访问 Release DB 或真实用户数据库。

## 限制

- 网络不可用、provider 暂停或限额时，Weather 可不可用；其失败不会影响工作台、课表或个人上下文。
- Open-Meteo 免费 API 只适合非商业用途，调用频率受其当前条款限制；provider 条款/API 可能变化。
- 不使用设备定位，不后台轮询；仅启动时发现启用且缓存非 fresh、地点改变或用户手动刷新时请求。
