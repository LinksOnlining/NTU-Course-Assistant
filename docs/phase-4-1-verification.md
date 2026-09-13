# Phase 4.1 调查记录（已由用户取消）

日期：2026-09-10
状态：**CANCELLED BY USER**

## 已执行

- 复核 Phase 3 的 `ImportCandidate → CourseProposal → ImportPlan → SQLite transaction` 数据链路及隐私边界。
- 查询南通大学教务处当前公开页面、2026 年官方通知和统一身份认证登录页。
- 确认 `https://tdjw.ntu.edu.cn` 是官方本科生教务入口；确认公开资料中的“信息查询 → 班级课表打印”路径与统一身份认证存在。
- 记录方案排序、风险、未确认项和用户可提供的最小脱敏信息，详见 [调查记录](phase-4-1-investigation.md)。

## 未执行

- 未登录官方教务系统。
- 未尝试或绕过认证、验证码、MFA 或统一身份认证。
- 未读取浏览器 Cookie、未采集 Network 请求、未查看任何个人课表。
- 未修改 Course、SQLite、schema、PDF 导入或生产代码；未创建 Git 提交。

## 取消说明

用户已取消整个 Phase 4。本文仅保留已完成的只读公开资料调查；不再需要提供登录后页面、导出能力或请求结构，也不会继续实现教务系统导入。
