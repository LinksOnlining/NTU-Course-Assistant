import { expect, test } from "@playwright/test";

const harnessPath = "/tests/ui/fixtures/ai-proposal-review.html";

test("Mock AI 提案只进入本地预览；取消与 Escape 永不调用写入", async ({ page }) => {
  await page.goto(harnessPath);
  await expect(page.getByTestId("pipeline-stage")).toHaveText("preview");
  await expect(page.getByRole("dialog", { name: "建议创建任务" })).toBeVisible();
  await expect(page.getByText("整理本周课程资料")).toBeVisible();
  await expect(page.getByTestId("write-count")).toHaveText("0");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("cancelled")).toBeVisible();
  await expect(page.getByTestId("pipeline-stage")).toHaveText("cancelled");
  await expect(page.getByTestId("write-count")).toHaveText("0");
});

test("Mock AI → Proposal Tool → Preview → 人工确认 → Application UseCase → fake repository", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await page.goto(`${harnessPath}?theme=dark`);
  await expect(page.getByTestId("pipeline-stage")).toHaveText("preview");
  const dialog = page.getByTestId("ai-proposal-review");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "确认创建任务" })).toBeVisible();
  await expect(page.getByTestId("write-count")).toHaveText("0");

  await page.getByRole("button", { name: "确认创建任务" }).click();
  await expect(page.getByTestId("pipeline-stage")).toHaveText("applied");
  await expect(page.getByRole("status")).toHaveText("已添加到规划。");
  await expect(page.getByTestId("write-count")).toHaveText("1");
  await expect(page.getByRole("button", { name: "完成" })).toBeVisible();
});
