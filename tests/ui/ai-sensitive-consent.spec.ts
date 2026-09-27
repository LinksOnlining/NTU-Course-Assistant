import { expect, test } from "@playwright/test";

const harnessPath = "/tests/ui/fixtures/ai-sensitive-consent.html";

test("敏感 Consent 的取消、Escape、背景点击均不启动 AI 请求", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await page.goto(`${harnessPath}?theme=dark`);

  await page.getByRole("button", { name: "AI 帮我整理" }).click();
  let dialog = page.getByRole("dialog", { name: "允许 AI 整理本篇日记？" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("仅当前这一篇 / 条")).toBeVisible();
  await expect(page.getByTestId("request-count")).toHaveText("0");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("request-count")).toHaveText("0");

  await page.getByRole("button", { name: "AI 帮我整理" }).click();
  dialog = page.getByRole("dialog", { name: "允许 AI 整理本篇日记？" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("request-count")).toHaveText("0");

  await page.getByRole("button", { name: "AI 帮我整理" }).click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("request-count")).toHaveText("0");
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 720);
});

test("对象切换后需重新明确授权；失败后重试仍再次询问，双击只产生一次请求", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await page.goto(harnessPath);
  await page.getByRole("button", { name: "切换所选对象" }).click();
  await page.getByRole("button", { name: "AI 帮我整理" }).click();
  const dialog = page.getByRole("dialog", { name: "允许 AI 识别这条收件箱内容？" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("收件箱原文", { exact: true })).toBeVisible();
  await expect(dialog.getByText("2026-09-23 12:00")).toBeVisible();

  await dialog.getByRole("button", { name: "仅本次允许" }).dblclick();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("request-count")).toHaveText("1");
  await expect(page.getByTestId("request-status")).toContainText("网络失败");

  await page.getByRole("button", { name: "AI 帮我整理" }).click();
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("request-count")).toHaveText("1");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(page.getByTestId("request-count")).toHaveText("1");
});
