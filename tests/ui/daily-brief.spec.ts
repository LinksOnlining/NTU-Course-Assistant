import { expect, test, type Page } from "@playwright/test";

const harness = "/tests/ui/fixtures/daily-brief.html";
const callCount = (page: Page) =>
  page.evaluate(
    () => (window as Window & { __dailyBriefCalls?: () => number }).__dailyBriefCalls?.() ?? 0,
  );

test("每日简报默认不自动请求；手动入口显示 AI 结构化结果", async ({ page }) => {
  await page.goto(harness);
  await expect(page.getByTestId("daily-brief-dialog")).toHaveCount(0);
  expect(await callCount(page)).toBe(0);

  await page.getByTestId("daily-brief-open").click();
  const dialog = page.getByTestId("daily-brief-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "今天还有这些事" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "今天最重要的事" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "可以尝试" })).toBeVisible();
  await expect(dialog.getByText("额外刷题今天可以先不安排。", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/AI 分析已完成/u)).toBeVisible();
  expect(await callCount(page)).toBe(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("daily-brief-open")).toBeFocused();
});

test("开启后重要日自动弹一次；空白日只显示紧凑提示且不自动请求 AI", async ({ page }) => {
  await page.goto(`${harness}?enabled=1`);
  const dialog = page.getByTestId("daily-brief-dialog");
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("links-workplace.ai.daily-brief") ?? "{}")
            .lastAutoShownDate,
      ),
    )
    .toBe("2026-09-23");
  await expect.poll(() => callCount(page)).toBe(1);
  await dialog.getByRole("button", { name: "关闭今日简报" }).click();
  await page.reload();
  await expect(page.getByTestId("daily-brief-dialog")).toHaveCount(0);
  await page.getByTestId("daily-brief-open").click();
  await expect(page.getByTestId("daily-brief-dialog")).toBeVisible();
  const gateAfterManualOpen = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("links-workplace.ai.daily-brief") ?? "{}").lastAutoShownDate,
  );
  expect(gateAfterManualOpen).toBe("2026-09-23");

  await page.goto(`${harness}?enabled=1&empty=1`);
  await expect(page.getByTestId("daily-brief-compact")).toContainText("今天安排很轻");
  await expect(page.getByTestId("daily-brief-dialog")).toHaveCount(0);
  expect(await callCount(page)).toBe(0);
});

test("AI 未配置、无权限或请求失败时保留本地简报，失败可重试", async ({ page }) => {
  for (const [mode, message] of [
    ["not-configured", "尚未配置 DeepSeek"],
    ["no-permissions", "没有可用于此次请求的已授权数据"],
  ]) {
    await page.goto(`${harness}?mode=${mode}`);
    await page.getByTestId("daily-brief-open").click();
    const dialog = page.getByTestId("daily-brief-dialog");
    await expect(dialog.getByText(message, { exact: false })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "今日概览" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "AI 设置" })).toBeVisible();
  }

  await page.goto(`${harness}?mode=failure`);
  await page.getByTestId("daily-brief-open").click();
  const dialog = page.getByTestId("daily-brief-dialog");
  await expect(
    dialog.getByText("AI 分析暂不可用，以下是根据本机数据整理的简报。", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "重试 AI 分析" }).click();
  await expect(dialog.getByText(/AI 分析已完成/u)).toBeVisible();
  expect(await callCount(page)).toBe(2);
});

test("本地简报不会把没有截止日期的课程任务误判为近期事项", async ({ page }) => {
  await page.goto(`${harness}?mode=not-configured`);
  await page.getByTestId("daily-brief-open").click();
  const dialog = page.getByTestId("daily-brief-dialog");
  await expect(dialog.getByRole("heading", { name: "今日概览" })).toBeVisible();
  await expect(dialog.getByText("无截止日期课程任务", { exact: true })).toHaveCount(0);
});

test("AI 请求加载期间简报与关闭/重试入口可用，主界面不被请求阻塞", async ({ page }) => {
  await page.goto(`${harness}?mode=slow`);
  await page.getByTestId("daily-brief-open").click();
  const dialog = page.getByTestId("daily-brief-dialog");
  await expect(dialog.getByText(/正在补充 AI 分析/u)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "关闭今日简报" })).toBeEnabled();
  await expect(dialog.locator(".daily-brief-footer .primary-button")).toBeDisabled();
  await expect(page.getByTestId("daily-brief-open")).toBeVisible();
  await page.evaluate(() =>
    (
      window as Window & { __completeDailyBriefRequest?: () => void }
    ).__completeDailyBriefRequest?.(),
  );
  await expect(dialog.getByText(/AI 分析已完成/u)).toBeVisible();
});

test("简报对话框在目标尺寸与浅色/深色主题内可见，窄屏保留内部滚动和底栏", async ({ page }) => {
  await page.goto(`${harness}?theme=light`);
  await page.getByTestId("daily-brief-open").click();
  const dialog = page.getByTestId("daily-brief-dialog");
  await expect(dialog).toBeVisible();

  for (const theme of ["light", "dark"]) {
    await page
      .locator("html")
      .evaluate((element, value) => element.setAttribute("data-theme", value), theme);
    for (const viewport of [
      { width: 1920, height: 1080 },
      { width: 1600, height: 900 },
      { width: 1366, height: 768 },
      { width: 720, height: 520 },
    ]) {
      await page.setViewportSize(viewport);
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      await expect(dialog.getByRole("button", { name: "重新生成 AI 分析" })).toBeVisible();
      const colors = await dialog.evaluate((element) => {
        const style = getComputedStyle(element);
        return { color: style.color, background: style.backgroundColor };
      });
      expect(colors.color).not.toBe(colors.background);
    }
  }
  await page.setViewportSize({ width: 720, height: 520 });
  const scroll = await dialog.locator(".daily-brief-content").evaluate((element) => ({
    height: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(scroll.scrollHeight).toBeGreaterThan(scroll.height);
  await dialog.locator(".daily-brief-content").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(dialog.getByRole("button", { name: "重新生成 AI 分析" })).toBeVisible();
});
