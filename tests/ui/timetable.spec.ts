import { expect, test, type Locator } from "@playwright/test";

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return value!;
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "大学课程表" })).toBeVisible();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(errors).toEqual([]);
  await expect(page.getByText("测试数据", { exact: true })).toBeVisible();
});

test("seven fixed days and teaching-week filter", async ({ page }) => {
  await expect(page.getByTestId("day-column")).toHaveCount(7);
  await expect(page.locator(".day-header")).toHaveText([
    "周一",
    "周二",
    "周三",
    "周四",
    "周五",
    "周六",
    "周日",
  ]);
  await expect(page.locator('[data-course-id="sunday-course"]')).toBeVisible();
  await expect(page.locator('[data-course-id="other-week-hidden"]')).toHaveCount(0);
  await expect(page.locator('[data-weekday="5"] .course-card')).toHaveCount(0);
  await expect(page.locator('[data-weekday="6"] .course-card')).toHaveCount(0);
});

test("actual minutes determine top, height and four-hour blank space", async ({ page }) => {
  const monday = await box(page.locator('[data-weekday="1"]'));
  const morning = await box(page.locator('[data-course-id="monday-morning"]'));
  const afternoon = await box(page.locator('[data-course-id="monday-afternoon"]'));
  expect(morning.y - monday.y).toBeCloseTo(60, 0);
  expect(morning.height).toBeCloseTo(120, 0);
  expect(afternoon.y - monday.y).toBeCloseTo(420, 0);
  expect(afternoon.height).toBeCloseTo(120, 0);
  expect(afternoon.y - (morning.y + morning.height)).toBeCloseTo(240, 0);

  const short = await box(page.locator('[data-course-id="wednesday-first"]'));
  expect(short.height).toBeCloseTo(45, 0);
});

test("overlap chain is visible in two lanes", async ({ page }) => {
  const first = await box(page.locator('[data-course-id="tuesday-overlap-a"]'));
  const second = await box(page.locator('[data-course-id="tuesday-overlap-b"]'));
  const third = await box(page.locator('[data-course-id="tuesday-overlap-chain"]'));
  expect(first.x).not.toBeCloseTo(second.x, 0);
  expect(first.width).toBeCloseTo(second.width, 0);
  expect(first.x).toBeCloseTo(third.x, 0);
  await expect(page.locator('[data-course-id="tuesday-overlap-a"]')).toHaveAttribute(
    "data-lane-count",
    "2",
  );
  await expect(page.locator('[data-course-id="tuesday-overlap-chain"]')).toHaveAttribute(
    "data-lane-count",
    "2",
  );
});

test("long title stays inside its fixed-height card", async ({ page }) => {
  const card = page.locator('[data-course-id="thursday-long-name"]');
  await expect(card).toContainText("毛泽东思想和中国特色社会主义理论体系概论");
  const cardBox = await box(card);
  const titleBox = await box(card.locator(".course-name"));
  const overflow = await card.evaluate((element) => getComputedStyle(element).overflow);
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
  expect(overflow).toBe("hidden");
});

test("short cards reduce detail without changing real height", async ({ page }) => {
  const card = page.locator('[data-course-id="wednesday-first"]');
  await expect(card).toHaveAttribute("data-density", "compact");
  await expect(card.locator(".course-name")).toBeVisible();
  await expect(card.locator(".course-time")).toBeVisible();
  await expect(card.locator(".course-classroom")).toBeHidden();
  await expect(card.locator(".course-teacher")).toBeHidden();
  expect((await box(card)).height).toBeCloseTo(45, 0);
});

test("overlap lanes have distinct fixed visual treatments", async ({ page }) => {
  const first = page.locator('[data-course-id="tuesday-overlap-a"]');
  const second = page.locator('[data-course-id="tuesday-overlap-b"]');
  const colors = await Promise.all(
    [first, second].map((card) =>
      card.evaluate((element) => ({
        background: getComputedStyle(element).backgroundColor,
        border: getComputedStyle(element).borderLeftColor,
      })),
    ),
  );
  expect(colors[0]).not.toEqual(colors[1]);
});

test("first and last hour labels stay inside the time axis", async ({ page }) => {
  const axis = await box(page.getByTestId("time-axis"));
  const ticks = page.locator(".time-axis time");
  const first = await box(ticks.first());
  const last = await box(ticks.last());
  expect(first.y).toBeGreaterThanOrEqual(axis.y);
  expect(last.y + last.height).toBeLessThanOrEqual(axis.y + axis.height);
});

test("one scroll area keeps headers and time axis aligned", async ({ page }) => {
  const scroll = page.getByTestId("timetable-scroll");
  const before = await box(scroll);
  const axisBefore = await box(page.getByTestId("time-axis"));
  await scroll.evaluate((element) => {
    element.scrollTop = 300;
    element.scrollLeft = 180;
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const header = await box(page.locator(".day-header").first());
  const axisAfter = await box(page.getByTestId("time-axis"));
  expect(header.y).toBeCloseTo(before.y + 1, 0);
  expect(axisAfter.x).toBeCloseTo(axisBefore.x, 0);
  const state = await scroll.evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollLeft: element.scrollLeft,
    vertical: element.scrollHeight > element.clientHeight,
    horizontal: element.scrollWidth > element.clientWidth,
  }));
  expect(state.scrollTop).toBeGreaterThan(0);
  if (state.horizontal) expect(state.scrollLeft).toBeGreaterThan(0);
  else expect(state.scrollLeft).toBe(0);
  expect(state.vertical).toBe(true);
  const pageOverflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    vertical: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  }));
  expect(pageOverflow).toEqual({ horizontal: false, vertical: false });
});

test("small window scrolls horizontally instead of crushing cards", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("900-"), "small viewport project only");
  const scroll = page.getByTestId("timetable-scroll");
  const dimensions = await scroll.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
  const day = await box(page.locator('[data-weekday="1"]'));
  expect(day.width).toBeGreaterThanOrEqual(149);
});

test("course form opens, reports field errors and cancel makes no change", async ({ page }) => {
  await page.getByRole("button", { name: "添加课程" }).click();
  const dialog = page.getByRole("dialog", { name: "添加课程" });
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "保存课程" }).click();
  await expect(page.getByText("课程名称不能为空")).toBeVisible();
  await expect(page.getByText("请输入有效的开始时间")).toBeVisible();
  await expect(page.getByText("请输入有效的结束时间")).toBeVisible();
  await expect(page.getByText("上课周数不能为空")).toBeVisible();
  await expect(page.locator('[data-source="user"]')).toHaveCount(0);
  await page.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-source="user"]')).toHaveCount(0);
});

test("validated course appears on the correct day with real-time geometry", async ({ page }) => {
  await page.getByRole("button", { name: "添加课程" }).click();
  const dialog = page.getByRole("dialog", { name: "添加课程" });
  await dialog.getByLabel("课程名称", { exact: true }).fill(" 机械设计基础 ");
  await dialog.getByLabel("教师（可选）").fill("测试教师");
  await dialog.getByLabel("教室（可选）").fill("JX02-407");
  await dialog.getByLabel("星期").selectOption("3");
  await dialog.getByLabel("开始时间").fill("14:00");
  await dialog.getByLabel("结束时间").fill("15:30");
  await dialog.getByLabel("上课周数").fill("1-16");
  await page.getByRole("button", { name: "保存课程" }).click();

  await expect(page.getByRole("dialog", { name: "添加课程" })).toHaveCount(0);
  const card = page.locator('[data-weekday="3"] [data-source="user"]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("机械设计基础");
  await expect(card).toContainText("用户添加");
  await expect(card).toHaveAttribute("data-duration-minutes", "90");
  const day = await box(page.locator('[data-weekday="3"]'));
  const cardBox = await box(card);
  expect(cardBox.y - day.y).toBeCloseTo(420, 0);
  expect(cardBox.height).toBeCloseTo(90, 0);
});

test("invalid course stays in the form with errors beside its fields", async ({ page }) => {
  await page.getByRole("button", { name: "添加课程" }).click();
  const dialog = page.getByRole("dialog", { name: "添加课程" });
  await dialog.getByLabel("课程名称", { exact: true }).fill("测试课程");
  await dialog.getByLabel("开始时间").fill("15:30");
  await dialog.getByLabel("结束时间").fill("14:00");
  await dialog.getByLabel("上课周数").fill("1-4,,7");
  await page.getByRole("button", { name: "保存课程" }).click();
  await expect(page.getByText("结束时间必须晚于开始时间，且不能跨午夜")).toBeVisible();
  await expect(page.getByText("周数格式不正确，请使用 1-4,7,10-12")).toBeVisible();
  await expect(page.locator('[data-source="user"]')).toHaveCount(0);
});

test("long Chinese user course name remains inside its real-height card", async ({ page }) => {
  const longName = "高等工程数学与现代制造系统综合设计实验课程长名称可读性测试";
  await page.getByRole("button", { name: "添加课程" }).click();
  const dialog = page.getByRole("dialog", { name: "添加课程" });
  await dialog.getByLabel("课程名称", { exact: true }).fill(longName);
  await dialog.getByLabel("星期").selectOption("5");
  await dialog.getByLabel("开始时间").fill("10:00");
  await dialog.getByLabel("结束时间").fill("10:45");
  await dialog.getByLabel("上课周数").fill("3");
  await page.getByRole("button", { name: "保存课程" }).click();
  const card = page.locator('[data-weekday="5"] [data-source="user"]');
  await expect(card).toHaveAttribute("data-density", "compact");
  const cardBox = await box(card);
  const nameBox = await box(card.locator(".course-name"));
  expect(cardBox.height).toBeCloseTo(45, 0);
  expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  expect(nameBox.y + nameBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
  await expect(card).toHaveAttribute("title", new RegExp(longName));
});
