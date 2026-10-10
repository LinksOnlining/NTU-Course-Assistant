# Links Workplace

面向 Windows 的本地个人工作台，包含课程表、Planner、Obsidian 快捷入口、Inbox、天气和可选 AI 能力。Links Workplace 2.0 沿用本仓库与应用技术栈，但采用独立身份和全新数据开始。

> **版本说明：**当前版本为 Links Workplace 2.0.4（窄窗口布局与回归稳定性修复，包含 2.0.2 的教学周、标题、每日寄语及小组件生命周期改进）。Links Workplace 2.0 是 **clean-start release**；NTU Course Assistant 1.x 属于旧版产品线，不支持自动升级到 Links Workplace 2.x 或迁移数据。

## 主要功能

- 5 天或 7 天课程表按真实开始、结束时间显示，保留课间、午休和空闲时段；进入课表默认定位到当前学期的实际教学周，也可手动切换。
- 修改已确认作息后，按节次安排的已有课程会立即按新时间显示，无需重新导入 PDF 或重启；固定钟点课程不受影响。
- 本地添加、编辑、删除课程；数据保存在本机 SQLite 数据库。
- 导入当前支持结构的南通大学课表 PDF，预览、修正后再确认写入。
- 上课前 Windows 通知；桌面小组件开启时关闭主窗口会保留进程与提醒，小组件关闭时关闭主窗口将退出。
- 可选桌面小组件，支持今日/本周、锁定、位置与尺寸恢复。
- Academic Hub：查看今日学习安排、停课/调课/补课变化、Deadline、考试与学期归档。
- Widget 2.0：支持下一节课和 Deadline 模式，并与课表变化保持一致。
- 可选登录后自动启动，以及单实例保护。
- 工作台顶部名称可自定义；每日寄语默认来自离线已核验文案，可选择主动通过已配置的 DeepSeek 生成当日寄语。

## Obsidian 笔记入口

工作台中的原「日记」卡片现改为 Obsidian 快捷入口。应用读取 Obsidian 已注册的当前知识库信息，可启动 Obsidian、打开每日笔记、搜索「00 收集箱」；这些操作通过 `obsidian://` 协议交给 Obsidian 执行。需要预先安装 Obsidian 并在其中打开知识库。Links 不会读写或修改 Vault 内的 Markdown 文件，也不会改变既有 Obsidian 同步设置。

为保护历史数据，旧 Links 日记仍保留在原本的 SQLite 数据库中；历史日记搜索结果仍可进入旧版条目查看。既有 AI 今日分析与 Planner 工作流不变，此次没有增加自动读取 Obsidian 笔记正文的能力。

## 系统要求与安装

- 支持 Windows 10 / 11 x64；当前主要开发与窗口生命周期验证环境为 Windows 11，其他 Windows 版本仍建议验证安装与显示兼容性。
- 从 [GitHub Releases](https://github.com/LinksOnlining/NTU-Course-Assistant/releases/latest) 获取最新 Links Workplace Windows 安装包；旧版 NTU Course Assistant 1.x 仅供历史参考。
- 安装 2.0 前，用户需要自行卸载 NTU Course Assistant 1.x。2.0 使用新的应用数据目录，只创建 schema 8 数据库；旧版课程数据不会自动迁移或恢复。如需保留旧数据，请在卸载前自行妥善保存。
- 首次使用请在“设置”中确认作息时间、学期首周和提醒选项。

## 使用说明

### 课程与 PDF

可手动添加课程，也可选择“导入 PDF”。PDF 导入仅在本机处理，先显示候选与问题，再由你确认写入课程表。文字型 PDF 优先直接读取；没有可用文字层时，应用会使用随安装包提供的离线中文/英文 OCR。当前导入器针对已验证的南通大学课表结构，识别质量不足的扫描件、其他学校或不同版式可能仍需手动添加或修正。

### 提醒、托盘与小组件

课程提醒只在应用进程存活时工作。**已启用桌面小组件**时，关闭主窗口仅隐藏主窗口，后台、小组件与提醒继续运行，可从小组件或系统托盘恢复主窗口；即使小组件窗口暂时隐藏或尚在创建，也不应误退出。**未启用小组件**时，关闭主窗口会结束整个应用进程，不会留在托盘后台运行。无论哪种状态，在托盘菜单明确选择“退出程序”都会结束应用。小组件位于普通窗口下方，并非嵌入 Windows 壁纸。

### Academic Hub

“今日”页面使用统一的课程 occurrence 读模型展示下一节、今日课程、变化、Deadline 与最近考试。课表变化不会改写基础课程，只对单次 occurrence 记录停课、调课、换教室或补课；学期管理可将学期归档或恢复为当前学期。

## 更新

从 v1.2.0 开始，应用会在启动后后台检查 GitHub Releases；也可在“设置 → 关于”手动检查。更新失败不会影响现有课程表。

## 隐私

课程数据和 PDF 文字提取 / OCR 在本机处理，并保存于 Tauri app-local 目录中的 SQLite 数据库。应用没有云同步或账号系统。天气请求会访问配置的天气/地理编码服务；使用 AI 时，用户明确授权提供给该工作流的上下文会发送到已配置的 AI 服务。API 凭据保存在 Windows 安全凭据存储中，不写入 SQLite。

## 已知限制

- 学校作息与学期日期需要由用户确认后保存；已有数据库 schema 不是 8 时，2.0 会拒绝打开且不会修改该数据库。
- 扫描 PDF 依赖本地 OCR，清晰度和版式会影响结果；未实现教务系统直接导入或云同步。
- 应用完全退出后不会继续发送提醒。
- NTU Course Assistant 1.x 与 Links Workplace 2.0 属于不同的数据起点；不提供自动迁移工具。

## 本地开发

```powershell
npm install
npm run tauri dev
```

完整验证使用 `npm run verify`（包含 Edge/Playwright 多分辨率 UI 检查），Rust 检查在 `src-tauri` 目录执行。发布由 GitHub Actions 对版本标签构建 Windows MSI/NSIS，并生成 Tauri Updater 签名及 `latest.json`；只有测试与资产检查通过后才能公开正式 Release。

## 项目资料

- [设计说明](DESIGN.md)
- [当前状态](PROJECT_STATUS.md)
- [变更记录](CHANGELOG.md)
- [许可证](LICENSE)
