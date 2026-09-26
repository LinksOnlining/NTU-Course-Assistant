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

test("工作台直接显示一次性 AI Composer；不点击第二层也能输入，结果按结构渲染", async ({ page }) => {
  await page.goto(harnessPath);
  const panel = page.getByTestId("today-assistant-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "AI 助手 ✨" })).toBeVisible();
  await expect(panel.getByLabel("想让我帮你看看什么？")).toBeVisible();
  await expect(page.getByTestId("today-assistant-send")).toBeDisabled();
  expect(await requestCount(page)).toBe(0);

  await page.getByRole("button", { name: "分析今天" }).click();
  await expect(page.getByTestId("today-assistant-result")).toBeVisible();
  await expect(page.getByRole("heading", { name: "🌙 今日概览" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "⏰ 需要注意" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "✨ 建议安排" })).toBeVisible();
  await expect(page.getByText("参考：工作台、任务与日程")).toBeVisible();
  await expect(
    page.getByText("仅在你主动使用 AI 时，将本次请求所需且已授权的数据发送至 DeepSeek 处理。"),
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

test("快捷操作仍可分别发起分析、安排和风险检查", async ({ page }) => {
  await page.goto(harnessPath);
  for (const [label, expectedWorkflow] of [
    ["分析今天", "today.analyze"],
    ["安排今天", "planner.route"],
    ["看看风险", "today.analyze"],
  ]) {
    await page.getByRole("button", { name: label }).click();
    await expect(page.getByTestId("today-assistant-result")).toBeVisible();
    expect((await lastRequest(page)).workflow).toBe(expectedWorkflow);
  }
  expect(await requestCount(page)).toBe(3);
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

test("提案在结果下方直接进入本地 Review；取消与 Escape 不调用写入", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await page.goto(`${harnessPath}?mode=ready&theme=dark`);
  const result = page.getByTestId("today-assistant-result");
  const review = page.getByTestId("ai-proposal-review");
  await page.getByRole("button", { name: "安排今天" }).click();
  await expect(review).toBeVisible();
  await expect(page.getByTestId("ai-proposal-backdrop")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "AI 规划提案" })).toHaveCount(0);
  await expect(page.getByTestId("confirmation-count")).toHaveText("0");
  const resultBox = await result.boundingBox();
  const reviewBox = await review.boundingBox();
  expect(resultBox).not.toBeNull();
  expect(reviewBox).not.toBeNull();
  expect(reviewBox!.y).toBeGreaterThanOrEqual(resultBox!.y + resultBox!.height);
  for (const label of ["任务", "日期", "开始", "结束", "时长"]) {
    await expect(review.getByText(label, { exact: true })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(review).toHaveCount(0);
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
    await expect(page.getByRole("button", { name: "看看风险" })).toBeVisible();
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
