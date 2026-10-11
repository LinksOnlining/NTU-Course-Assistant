import { expect, test } from "@playwright/test";

const harnessPath = "/tests/ui/fixtures/today-assistant.html";
const requestCount = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () => (window as Window & { __todayRequestCount?: number }).__todayRequestCount ?? 0,
  );
const lastRequest = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const state = window as Window & { __todayWorkflow?: string; __todayInstruction?: string };
    return { workflow: state.__todayWorkflow, instruction: state.__todayInstruction };
  });

test("工作台保留 AI 输入框，分析结果在独立的居中弹窗内结构化显示", async ({ page }) => {
  await page.goto(harnessPath);
  const panel = page.getByTestId("today-assistant-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "AI 助手" })).toBeVisible();
  await expect(panel.getByLabel("想让我帮你看看什么？")).toBeVisible();
  await expect(page.getByTestId("today-assistant-send")).toBeDisabled();
  expect(await requestCount(page)).toBe(0);

  await page.getByRole("button", { name: "分析今天" }).click();
  const dialog = page.getByRole("dialog", { name: "分析今天" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("today-assistant-result")).toBeVisible();
  await expect(panel.locator(".today-assistant-result")).toHaveCount(0);
  const windowSize = page.viewportSize()!;
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(Math.abs(bounds!.x + bounds!.width / 2 - windowSize.width / 2)).toBeLessThan(3);
  expect(Math.abs(bounds!.y + bounds!.height / 2 - windowSize.height / 2)).toBeLessThan(3);
  await expect(page.getByRole("heading", { name: "🌙 今日概览" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "⏰ 需要注意" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "✨ 建议安排" })).toBeVisible();
  await expect(page.getByText("参考：工作台、任务与日程")).toBeVisible();
  await expect(
    page.getByText(/其他 AI 请求由你主动发起；每日 AI 简报仅在设置开启后/u),
  ).toBeVisible();
});

test("自由文本发送按钮与 Ctrl+Enter 工作；应用层接管可信意图路由", async ({ page }) => {
  await page.goto(harnessPath);
  const input = page.getByTestId("today-assistant-instruction");
  await input.fill("明天忙不忙？\n请看看风险");
  await input.press("Enter");
  expect(await requestCount(page)).toBe(0);
  await input.press("Control+Enter");
  await expect(page.getByTestId("today-assistant-result")).toBeVisible();
  expect(await requestCount(page)).toBe(1);
  expect(await lastRequest(page)).toEqual({
    workflow: "planner.route",
    instruction: "明天忙不忙？\n请看看风险",
  });
});

test("缺少活动时长时展示澄清结果，不伪造提案", async ({ page }) => {
  await page.goto(`${harnessPath}?mode=clarification`);
  await page.getByLabel("想让我帮你看看什么？").fill("明天晚上跑步");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByRole("status")).toContainText("想为“跑步”留多长时间？");
  await expect(page.getByTestId("ai-proposal-review")).toHaveCount(0);
});

test("明确时间块请求交由 Application trusted router 选择 workflow", async ({ page }) => {
  await page.goto(harnessPath);
  await page
    .getByLabel("想让我帮你看看什么？")
    .fill("为 AI验收测试任务安排一个 30 分钟时间块。如果没有合适时间就直接告诉我，不要虚构安排。");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByTestId("ai-proposal-review")).toBeVisible();
  expect(await lastRequest(page)).toEqual({
    workflow: "planner.route",
    instruction:
      "为 AI验收测试任务安排一个 30 分钟时间块。如果没有合适时间就直接告诉我，不要虚构安排。",
  });
});

test("请求期间阻止重复提交；完成后恢复输入", async ({ page }) => {
  await page.goto(`${harnessPath}?mode=delay`);
  const input = page.getByTestId("today-assistant-instruction");
  const send = page.getByTestId("today-assistant-send");
  await input.fill("分析今天");
  await send.click();
  await expect(page.getByTestId("today-assistant-loading")).toBeVisible();
  await expect(send).toBeDisabled();
  await expect(input).toBeDisabled();
  await expect(page.getByRole("button", { name: "分析今天" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "安排今天" })).toBeDisabled();
  await expect(page.getByTestId("today-assistant-result")).toBeVisible();
  await expect(input).toBeEnabled();
  await expect(send).toBeEnabled();
});

test("处理中关闭弹窗不会因迟到响应再次弹出，且恢复输入状态", async ({ page }) => {
  await page.goto(`${harnessPath}?mode=delay`);
  const trigger = page.getByRole("button", { name: "分析今天" });
  await trigger.click();
  await expect(page.getByTestId("today-assistant-loading")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("today-assistant-dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(trigger).toBeEnabled();
  await page.waitForTimeout(220);
  await expect(page.getByTestId("today-assistant-dialog")).toHaveCount(0);
  expect(await requestCount(page)).toBe(1);
});

test("关闭按钮、Tab 焦点约束与结果关闭后侧栏高度保持稳定", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await page.goto(harnessPath);
  const panel = page.getByTestId("today-assistant-panel");
  const before = await panel.boundingBox();
  await page.getByRole("button", { name: "分析今天" }).click();
  const dialog = page.getByTestId("today-assistant-dialog");
  await expect(dialog).toBeVisible();
  const viewport = page.viewportSize()!;
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  await expect(page.getByRole("button", { name: "关闭 AI 结果" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  const focusedInside = await dialog.evaluate((element) =>
    element.contains(document.activeElement),
  );
  expect(focusedInside).toBe(true);
  await page.getByRole("button", { name: "关闭 AI 结果" }).click();
  await expect(dialog).toHaveCount(0);
  const after = await panel.boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(Math.abs(before!.height - after!.height)).toBeLessThan(2);
});

test("分析与安排是两种独立流程，风险快捷按钮已去重", async ({ page }) => {
  await page.goto(harnessPath);
  for (const [label, expectedWorkflow] of [
    ["分析今天", "today.analyze"],
    ["安排今天", "planner.route"],
  ]) {
    await page.getByRole("button", { name: label }).click();
    await expect(page.getByTestId("today-assistant-dialog")).toBeVisible();
    expect((await lastRequest(page)).workflow).toBe(expectedWorkflow);
    await page.getByRole("button", { name: "关闭 AI 结果" }).click();
    await expect(page.getByTestId("today-assistant-dialog")).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: "看看风险" })).toHaveCount(0);
  expect(await requestCount(page)).toBe(2);
});

test("无权限和未配置状态提供设置入口，工作台 Composer 保持可用", async ({ page }) => {
  await page.goto(`${harnessPath}?mode=no-permissions`);
  await page.getByRole("button", { name: "分析今天" }).click();
  await expect(page.getByText("还没有允许 AI 使用的工作台数据。")).toBeVisible();
  await page.getByRole("button", { name: "打开 AI 数据访问设置" }).click();
  await expect(page.getByTestId("settings-opened")).toBeVisible();
  await expect(page.getByTestId("today-assistant-panel")).toBeVisible();

  await page.goto(`${harnessPath}?mode=not-configured`);
  await page.getByRole("button", { name: "分析今天" }).click();
  await expect(page.getByText("请先在设置中配置 DeepSeek。")).toBeVisible();
  await page.getByRole("button", { name: "打开 AI 设置" }).click();
  await expect(page.getByTestId("settings-opened")).toBeVisible();
});

test("网络失败后只能由用户重试并复用同一请求", async ({ page }) => {
  await page.goto(`${harnessPath}?mode=error`);
  await page.getByRole("button", { name: "分析今天" }).click();
  await expect(page.getByRole("alert")).toContainText("网络不可用");
  expect(await requestCount(page)).toBe(1);
  await page.getByTestId("today-assistant-retry").click();
  await expect(page.getByTestId("today-assistant-result")).toBeVisible();
  expect(await requestCount(page)).toBe(2);
});

test("结构化字段剥离 Markdown，并以分区列表展示风险、建议和信息限制", async ({ page }) => {
  await page.goto(`${harnessPath}?mode=markdown`);
  await page.getByRole("button", { name: "分析今天" }).click();
  const result = page.getByTestId("today-assistant-result");
  await expect(result.getByRole("heading", { name: "🌙 今日概览" })).toBeVisible();
  await expect(result.getByText("午后有空\n可以安排复习。", { exact: true })).toBeVisible();
  await expect(result.getByRole("heading", { name: "信息限制" })).toBeVisible();
  await expect(result).not.toContainText("##");
  await expect(result).not.toContainText("**");
  await expect(result.locator("ul li")).toHaveCount(3);
});

test("规划提案与结果同处居中弹窗；Escape 安全撤销并恢复焦点", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await page.goto(`${harnessPath}?mode=ready&theme=dark`);
  const result = page.getByTestId("today-assistant-result");
  const review = page.getByTestId("ai-proposal-review");
  await page.getByRole("button", { name: "安排今天" }).click();
  await expect(review).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "安排今天" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("ai-proposal-review")).toBeVisible();
  await expect(page.getByTestId("ai-proposal-backdrop")).toHaveCount(0);
  await expect(page.getByTestId("confirmation-count")).toHaveText("0");
  const resultBox = await result.boundingBox();
  const reviewBox = await review.boundingBox();
  const dialogBox = await dialog.boundingBox();
  expect(resultBox).not.toBeNull();
  expect(reviewBox).not.toBeNull();
  expect(dialogBox).not.toBeNull();
  expect(reviewBox!.x).toBeGreaterThanOrEqual(dialogBox!.x);
  expect(reviewBox!.x + reviewBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width + 1);
  for (const label of ["任务", "日期", "开始", "结束", "时长"]) {
    await expect(review.getByText(label, { exact: true })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(review).toHaveCount(0);
  await expect(page.getByRole("button", { name: "安排今天" })).toBeFocused();
  await expect(page.getByTestId("cancellation-count")).toHaveText("1");
  await expect(page.getByTestId("confirmation-count")).toHaveText("0");
  await expect(page.getByTestId("applied")).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("有效提案显式确认后才调用本地确认回调", async ({ page }) => {
  await page.goto(`${harnessPath}?mode=ready`);
  await page.getByRole("button", { name: "安排今天" }).click();
  await expect(page.getByTestId("confirmation-count")).toHaveText("0");
  await page.getByRole("button", { name: "确认安排时间块" }).click();
  await expect(page.getByTestId("confirmation-count")).toHaveText("1");
  await expect(page.getByTestId("applied")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("已添加到规划。");
});

test("未来独立活动显示 Event Proposal 并仅在用户确认后创建日程", async ({ page }) => {
  await page.goto(`${harnessPath}?mode=event-ready`);
  await page.getByLabel("想让我帮你看看什么？").fill("明天晚上想跑30分钟");
  await page.getByRole("button", { name: "发送" }).click();
  const review = page.getByTestId("ai-proposal-review");
  await expect(review).toBeVisible();
  await expect(review.getByText("跑步", { exact: true })).toBeVisible();
  await expect(review.getByText("2026-09-27", { exact: true })).toBeVisible();
  await expect(review.getByText("18:00–18:30", { exact: true })).toBeVisible();
  await expect(review.getByText("30 分钟", { exact: true })).toBeVisible();
  await expect(review.getByRole("button", { name: "确认创建日程" })).toBeVisible();
  await expect(page.getByTestId("confirmation-count")).toHaveText("0");
  await review.getByRole("button", { name: "确认创建日程" }).click();
  await expect(page.getByTestId("confirmation-count")).toHaveText("1");
  await expect(review.getByRole("status")).toHaveText("已添加到规划。");
});

test("模型自然语言声称写入但没有真实 proposal 时不显示确认入口", async ({ page }) => {
  await page.goto(`${harnessPath}?mode=hallucinated-success`);
  await page.getByRole("button", { name: "安排今天" }).click();
  await expect(page.getByTestId("today-assistant-result")).toContainText("任务已创建");
  await expect(page.getByTestId("today-assistant-result")).toContainText(
    "这是一条文字建议，尚未修改任何应用数据。",
  );
  await expect(page.getByTestId("ai-proposal-review")).toHaveCount(0);
  await expect(page.getByTestId("confirmation-count")).toHaveText("0");
});

test("720×520 浅色与深色下 Composer、快捷按钮和键盘焦点可访问", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  for (const theme of ["light", "dark"]) {
    await page.goto(`${harnessPath}?theme=${theme}`);
    const panel = page.getByTestId("today-assistant-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByLabel("想让我帮你看看什么？")).toBeVisible();
    await expect(page.getByTestId("today-assistant-send")).toBeVisible();
    await expect(page.getByRole("button", { name: "分析今天" })).toBeVisible();
    await expect(page.getByRole("button", { name: "安排今天" })).toBeVisible();
    await expect(page.getByRole("button", { name: "看看风险" })).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.getByLabel("想让我帮你看看什么？").focus();
    await expect(page.getByLabel("想让我帮你看看什么？")).toBeFocused();
    const sizes = await panel.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
  }
});
