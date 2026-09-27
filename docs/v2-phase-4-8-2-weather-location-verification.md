# Phase 4.8.2 — Weather Location Resolver 2.0 验证记录

## 状态

- 基线：`v2/workspace-rebase`，起始 HEAD `5e4d7955b45b99a5d0cd1ef0ae09c2e52f240489`
- 实现：COMPLETE
- 自动验证：PASS
- AMap live 回归 smoke：PASS（城市/区县/乡镇 + 静态地图接口）；Baidu live：PENDING
- Windows 人工验收：PENDING
- Phase 4.8.2 Overall：PENDING（等待更完整 provider 覆盖与 Windows 人工复验）
- SQLite schema：8；Migration：0
- 应用元数据版本保持 `1.3.1`
- Phase 4.9：NOT STARTED

## 变更范围与复用审计

- 移除旧 Photon / Nominatim 地点搜索与逆地理编码路径；天气预报仍使用既有 Open-Meteo 经纬度接口和缓存。
- **REUSE**：既有 Weather 设置/缓存和天气预报路径、Tauri command 边界、Rust `reqwest` 与 `keyring` 依赖。
- **ADAPT**：将既有 Windows Credential Manager 读写封装为 `secure_credentials`，供 AI 与 Weather 共用；Weather 不建立第二套凭据存储。
- **REFERENCE**：只参考官方 API 文档，没有复制第三方 SDK 或非官方实现代码。
- **REJECT**：未引入新的位置 SDK、运行时依赖、地图 WebView SDK 或新数据库表；没有更换现有 Open-Meteo 天气预报 provider。保留理由：当前实现已按经纬度读取 current/hourly/daily、7 日预报和本机缓存；官方 Forecast API 以 WGS84 latitude/longitude 为输入，默认提供 7 日预报。地点解析已独立解决名称覆盖和返回坐标的问题，没有已证实的预报能力缺口需要迁移到 QWeather。农村地点的真实预报质量仍需 Live 验收，不在这里推断为 PASS。[Open-Meteo Forecast API](https://open-meteo.com/en/docs)

## Resolver 与坐标边界

- 地点解析在 Rust 侧执行；输入限制为 2–160 个字符，提示不超过 80 个字符，拒绝控制字符。请求使用固定 HTTPS provider endpoint、8 秒 timeout 与有界响应读取。
- 查询分为详细地址、行政区、POI、一般关键词。高德按意图从行政区查询、输入提示、POI、地理编码中最多执行两种主策略；有用户提供的行政区提示时最多增加一次高德增强查询。
- 高德没有候选结果时才尝试百度；百度搜索与坐标转换为批量请求。非详细地址且首轮无结果时，可使用提示进行一次增强搜索。最坏路径最多 7 次位置服务请求；命中本地进程缓存时不发网络请求。
- 候选合并后按规范化文本、行政层级、结果类型与坐标去重/排序，最多返回 12 条。村/镇、学校、地址和同名地点展示分类与行政层级，供用户区分。
- 高德返回的地点坐标按 GCJ-02 处理；百度 BD-09 通过百度坐标转换接口 `model=5` 转到应用内部 GCJ-02。预报请求边界再将 GCJ-02 转为 WGS84。坐标系随 Location DTO 明确表达，不靠城市 ID 或 `locationId`。
- 手动坐标支持坐标系选择并归一到 GCJ-02；无地图凭据时该路径仍可用。地图选择器以高德静态地图图像为底图，由 Rust 下载并校验 PNG/JPEG、大小与坐标；不把 Web 服务 Key 暴露给前端。
- 当前位置仍需用户明确同意与系统定位授权；发给位置服务前会降低坐标精度。逆地理编码依次尝试高德、百度；失败时保留坐标型位置，不阻断天气功能。

## 真实农村地点人工矩阵（尚未执行）

不在代码中编造“真实”地名或伪造 live provider 响应。Rust/前端自动测试中的 JSON 是明确的协议 mock，仅验证字段映射、fallback、去重、排序和坐标转换，不作为地点存在性或覆盖率证据。Windows Live 验收使用当前 provider 实际返回的地点，并记录选中结果及坐标。

| 区域 | 待实测覆盖 | 状态 |
| --- | --- | --- |
| 江苏 | 乡镇、行政村/自然村、农村 POI | PENDING |
| 安徽 | 乡镇、行政村/自然村、农村 POI | PENDING |
| 河南 | 乡镇、行政村/自然村、农村学校/村委会 | PENDING |
| 山东 | 乡镇、行政村/自然村、农村学校/村委会 | PENDING |
| 四川 | 乡镇、自然村、详细农村地址 | PENDING |
| 广东 | 乡镇、行政村/自然村、详细农村地址 | PENDING |
| 云南 | 乡镇、行政村/自然村、同名地点 | PENDING |
| 东北（黑龙江/吉林/辽宁） | 乡镇、行政村/自然村、同名地点 | PENDING |
| 内蒙古 | 乡/苏木、镇、村级 POI | PENDING |
| 新疆 | 乡/镇、村级 POI、详细农村地址 | PENDING |

Live 验收至少需要：3 个省份的乡镇、5 个农村地点、2 个农村学校/村委会、2 个完整农村地址、2 组重名地点；另挑 1 个文字索引找不到的真实小地点完成“地图选点→位置确认→按坐标查询天气”。以上全都未由自动化模拟代替。

## 凭据、隐私与降级

- 高德与百度 Web 服务 Key 复用 Windows Credential Manager，分别使用 `links-workplace.weather` 下的 provider account；前端仅获取配置状态，不获得 Key。
- 天气关闭时不发起地点搜索。用户提交关键词或明确确认当前位置后才请求位置服务；取消/新请求会取消或丢弃过期响应。
- 搜索原文只用于当次 provider 查询与进程内短期缓存键；不写入搜索历史、数据库或日志。缓存为内存 15 分钟、最多 64 项；日志只包含 provider、操作类型、HTTP/结果状态、耗时与数量，不记录搜索词、地址、坐标或密钥。
- Open-Meteo 仍只接收天气所需坐标与 forecast 参数，不接收位置搜索关键词或 provider credentials。地点解析失败与天气预报失败分开呈现；网络不可用时核心工作台仍可用，现有天气缓存保留。
- Daily Brief 的 `weather.read` 边界没有扩大：只读取现有已授权的天气缓存，不获得位置搜索、反向地理编码或地图能力，也不接触 Diary / Inbox 私密正文。

## 官方接口参考

- 高德：[输入提示](https://lbs.amap.com/api/webservice/guide/api-advanced/inputtips)、[行政区域查询](https://lbs.amap.com/api/webservice/guide/api/district)、[POI 搜索](https://lbs.amap.com/api/webservice/guide/api/search/)、[静态地图](https://lbs.amap.com/api/webservice/guide/api/staticmaps)
- 百度：[地点检索](https://lbsyun.baidu.com/docs/webapi?title=placev3/guide/webservice-placeapiV3/interfaceDocumentV3)、[地理编码](https://lbsyun.baidu.com/docs/webapi?title=geocoding/guide/webservice-geocoding-base)、[坐标转换](https://lbsyun.baidu.com/docs/webapi?title=geoconv/guide/changeposition-base)

## 自动验证

- Weather targeted unit：15 PASS。
- Rust geocoding targeted：11 PASS；覆盖 query 分类、层级提取、坐标转换、合并排序、provider fallback、取消和无效输入。
- Weather targeted UI：6 PASS；覆盖离线默认、地点搜索/分类、手动坐标、无地图 Key、当前位置授权、失败分类与重试。
- `npm run verify`：PASS；typecheck、389 unit、141 architecture、1,218 UI PASS / 15 条件跳过、lint、Prettier、前端 production build 均通过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：106 PASS。
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`：PASS。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`：PASS。
- `npm run tauri build`：PASS；当前 HEAD 生成 `src-tauri/target/release/bundle/nsis/NTU Course Assistant_1.3.1_x64-setup.exe`（52,573,905 bytes）及其 `.sig`（436 bytes），和 `src-tauri/target/release/bundle/msi/NTU Course Assistant_1.3.1_x64_en-US.msi`（54,550,528 bytes）及其 `.sig`（436 bytes）。构建产物留在忽略的 `src-tauri/target/`，没有启动 EXE、安装 installer 或访问用户数据库。
- 曾有一个既有 timetable UI 测试在全量运行时 beforeEach 超时；单项复跑 PASS，随后完整 `npm run verify` 再跑一次全部 PASS。该间歇性 UI 启动延迟未通过改宽全局 timeout 掩盖。

## 尚未执行 / 已知限制

- 尚未完成完整 provider live 覆盖（多省乡镇、农村地点、重名地点、真实地址及地图选点天气查询）；最新 AMap 回归 smoke 范围见本文后附记录。Baidu fallback 也尚未进行真实凭据验收。
- 未进行 Windows 安装态或真实窗口 GUI 验收；未运行 build 出来的 EXE / installer。需 Ethan 在 Windows 开发/安装态验收搜索、地图渲染/缩放/选点、当前位置、离线降级与天气预报。
- 无 AMap Key 时地图底图不可用，但手动坐标路径仍保留；当前不提供地图瓦片离线包。
- QWeather 未采用；应用天气预报继续使用 Open-Meteo。Phase 4.8.1 Daily Summary 的 DeepSeek Live / Windows Manual 仍为 PENDING，本阶段没有改变其状态。
- 未创建 tag、未 push、未发布 Release；没有新增 schema 或 migration。

## 2026-09-28 回归修复复验（等待 Ethan Windows 人工复验）

### 根因与修复

- 搜索回归：Rust `Option<String>` 的地点响应会把缺省字段序列化为 JSON `null`；前端 `normalizeWeatherLocation` 将所有非 `undefined` 且非 string 字段判为无效，导致真实高德城市/区县结果被整条丢弃。现允许可选字段为 `null`（归一化时仍只保留实际 string），错误类型仍会拒绝。
- 地图空白：Rust 已成功返回 PNG，但地图使用 `URL.createObjectURL(blob)` 渲染，而生产 CSP 的 `img-src` 未允许 `blob:`，WebView 因此阻止了图片；现加入 `blob:` 并处理图片解码/加载错误，给出可操作提示。高德静态地图 Web Service 确实要求 Web 服务 Key，后端真实请求仍需遵守该接口边界。[高德静态地图接口](https://lbs.amap.com/api/webservice/guide/api/staticmaps)；[Tauri CSP](https://tauri.app/security/csp/)
- 地图请求错误现在按 HTTP 限流/客户端错误及高德 JSON 错误码返回现有可识别错误分类，不再一律压成“地图不可用”。

### 真实 Provider 与自动验证

- 使用本机凭据存储中的高德 Key 运行真实网络 smoke（未输出 Key）：`徐州市` 城市、`丰县` 区县、`邢楼镇` 乡镇搜索均收到 HTTP 200 且各有 2 个高德候选；静态地图请求 HTTP 200，收到 58,131 字节 `image/png`。这不是 mock。
- targeted Weather unit：16 PASS；包含 `null` 可选字段回归。Rust live AMap smoke：1 PASS。Weather/Daily Summary targeted UI：7 PASS；地图 PNG 实际解码宽度非零，摘要状态及窄窗滚动覆盖。
- 完整 `npm run verify`：PASS（390 unit、141 architecture、1,227 UI PASS / 15 skipped；typecheck、lint、Prettier、Vite build PASS）。Rust：106 passed / 0 failed / 1 ignored（ignored 项为需真实 Key 的 live smoke，另行执行并 PASS）；fmt 与 clippy PASS。
- `npm run tauri build`：PASS；当前变更构建了 Windows EXE、NSIS、MSI 及 updater signatures。未启动 EXE 或执行安装态 GUI 验收。

### 当前 gate

- Implementation：回归修复 COMPLETE；Automated：PASS；AMap provider live smoke：PASS（限城市/区县/乡镇 + 静态图接口范围）。
- Windows WebView 地图渲染、真实点击缩放选点、fallback 用户流程：Ethan 人工复验 PENDING；完整 provider 覆盖仍未验收。
- Phase 4.8.2 Overall：**PENDING**；Phase 4.8.1 Daily Summary Overall：**PENDING**；schema=8，migration 无变化；Phase 4.9：**NOT STARTED**。
