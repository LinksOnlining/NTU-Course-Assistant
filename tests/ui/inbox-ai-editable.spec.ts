import { expect, test } from "@playwright/test";

test("Inbox AI 识别草稿可本地编辑、切换为活动后生成建议且不改原文", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 900, height: 720 });
  await page.goto("/tests/ui/fixtures/inbox-ai-panel.html");

  await page.getByRole("button", { name: "AI 帮我识别" }).click();
  const consent = page.getByRole("dialog", { name: "允许 AI 识别这条收件箱内容？" });
  await expect(consent).toBeVisible();
  await consent.getByRole("button", { name: "仅本次允许" }).click();

  const editor = page.getByRole("region", { name: "可编辑识别草稿" });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("标题")).toHaveValue("AI 识别标题");
  await expect(editor.getByLabel("描述")).toHaveValue("AI 识别说明");
  await expect(page.getByText("详细说明", { exact: true })).toBeVisible();
  await editor.getByLabel("整理为").selectOption("event");
  await editor.getByLabel("标题").fill("临时修改");
  await editor.getByRole("button", { name: "恢复 AI 原始识别" }).click();
  await expect(editor.getByLabel("标题")).toHaveValue("AI 识别标题");
  await editor.getByLabel("整理为").selectOption("event");

  await editor.getByLabel("标题").fill("晨间慢跑");
  await editor.getByLabel("描述").fill("沿河跑步，结束后拉伸。");
  await editor.getByLabel("日期").fill("2026-09-25");
  await editor.getByLabel("开始时间").fill("07:00");
  await editor.getByLabel("结束时间").fill("07:45");
  await editor.getByLabel("地点").fill("滨河步道");
  await editor.getByRole("button", { name: "生成活动建议" }).click();

  await expect(page.getByTestId("ai-proposal-review")).toBeVisible();
  await expect(page.getByTestId("raw-source")).toHaveText("原始收件箱内容只读哨兵");
  const draft = await page.evaluate(() => window.__inboxAiPanelTest.draft);
  expect(draft).toMatchObject({
    title: "晨间慢跑",
    description: "沿河跑步，结束后拉伸。",
    date: "2026-09-25",
    startTime: "07:00",
    endTime: "07:45",
    location: "滨河步道",
  });
  expect(JSON.stringify(draft)).not.toContain("原始收件箱内容只读哨兵");
  expect(pageErrors).toEqual([]);
});
