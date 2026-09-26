import { expect, test } from "@playwright/test";

const harnessPath = "/tests/ui/fixtures/today-assistant.html";
const requestCount = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () => (window as Window & { __todayRequestCount?: number }).__todayRequestCount ?? 0,
  );

test("今日助手仅在用户打开并触发操作后请求；显示结构化结果与实际来源", async ({ page }) => {
  await page.goto(harnessPath);
  expect(await requestCount(page)).toBe(0);
  await page.getByTestId("open-assistant").click();
  await expect(page.getByRole("dialog", { name: "今日助手" })).toBeVisible();
  expect(await requestCount(page)).toBe(0);
  await page.getByRole("button", { name: "分析今天" }).click();
  await expect(page.getByTestId("today-assistant-result")).toBeVisible();
  await expect(page.getByRole("heading", { name: "今日概览" })).toBeVisible();
  await expect(page.getByText("主要风险")).toBeVisible();
  await expect(page.getByText("基于：工作台、任务与日程")).toBeVisible();
  await expect(page.getByText("发送至 DeepSeek 处理")).toBeVisible();
});

test("请求期间避免重复提交，并在完成后恢复操作", async ({ page }) => {
  await page.goto(`${harnessPath}?mode=delay`);
  await page.getByTestId("open-assistant").click();
  const analyze = page.getByRole("button", { name: "分析今天" });
  await analyze.click();
  await expect(page.getByTestId("today-assistant-loading")).toBeVisible();
  await expect(analyze).toBeDisabled();
  await expect(page.getByRole("button", { name: "帮我安排今天" })).toBeDisabled();
  await expect(page.getByTestId("today-assistant-result")).toBeVisible();
  await expect(analyze).toBeEnabled();
});

test("无权限和未配置状态给出设置入口，不假装发起成功", async ({ page }) => {
  await page.goto(`${harnessPath}?mode=no-permissions`);
  await page.getByTestId("open-assistant").click();
  await page.getByRole("button", { name: "分析今天" }).click();
  await expect(page.getByText("当前没有允许 AI 使用的工作台数据。")).toBeVisible();
  await page.getByRole("button", { name: "打开 AI 数据访问设置" }).click();
  await expect(page.getByTestId("settings-opened")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "今日助手" })).toBeHidden();

  await page.goto(`${harnessPath}?mode=not-configured`);
  await page.getByTestId("open-assistant").click();
  await page.getByRole("button", { name: "分析今天" }).click();
  await expect(page.getByText("请先在设置中配置 DeepSeek。")).toBeVisible();
  await page.getByRole("button", { name: "打开 AI 设置" }).click();
  await expect(page.getByTestId("settings-opened")).toBeVisible();
});

test("网络失败仅在用户手动重试后再次请求", async ({ page }) => {
  await page.goto(`${harnessPath}?mode=error`);
  await page.getByTestId("open-assistant").click();
  await page.getByRole("button", { name: "分析今天" }).click();
  await expect(page.getByRole("alert")).toContainText("网络不可用");
  expect(await requestCount(page)).toBe(1);
  await page.getByTestId("today-assistant-retry").click();
  await expect(page.getByTestId("today-assistant-result")).toBeVisible();
  expect(await requestCount(page)).toBe(2);
});

test("无效凭据提供 AI 设置入口，不重复发送网络请求", async ({ page }) => {
  await page.goto(`${harnessPath}?mode=credential`);
  await page.getByTestId("open-assistant").click();
  await page.getByRole("button", { name: "分析今天" }).click();
  await expect(page.getByRole("alert")).toContainText("凭据无效");
  expect(await requestCount(page)).toBe(1);
  await page.getByRole("button", { name: "打开 AI 设置" }).click();
  await expect(page.getByTestId("settings-opened")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "今日助手" })).toBeHidden();
});

test("安排工作流只能进入 Proposal Review，显式确认后才调用本地确认回调", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await page.goto(`${harnessPath}?mode=ready&theme=dark`);
  await page.getByTestId("open-assistant").click();
  await page.getByRole("button", { name: "帮我安排今天" }).click();
  await expect(page.getByTestId("today-assistant-review-trigger")).toBeVisible();
  await expect(page.getByTestId("confirmation-count")).toHaveText("0");
  await expect(page.getByRole("dialog", { name: "今日助手" })).toBeVisible();
  await expect(page.getByTestId("ai-proposal-review")).toHaveCount(0);
  await page.getByTestId("today-assistant-review-trigger").click();
  await expect(page.getByTestId("ai-proposal-review")).toBeVisible();
  await expect(page.getByTestId("confirmation-count")).toHaveText("0");
  await page.getByRole("button", { name: "确认安排时间块" }).click();
  await expect(page.getByTestId("confirmation-count")).toHaveText("1");
  await expect(page.getByTestId("applied")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("已添加到规划。");
});

test("没有应用提案时不把模型声称的写入显示为成功", async ({ page }) => {
  await page.goto(`${harnessPath}?mode=hallucinated-success`);
  await page.getByTestId("open-assistant").click();
  await page.getByRole("button", { name: "帮我安排今天" }).click();
  await expect(page.getByTestId("today-assistant-result")).toContainText("任务已创建");
  await expect(page.getByTestId("today-assistant-result")).toContainText(
    "以上仅为文本建议，尚未修改任何应用数据。",
  );
  await expect(page.getByTestId("today-assistant-review-trigger")).toHaveCount(0);
  await expect(page.getByTestId("applied")).toHaveCount(0);
});
