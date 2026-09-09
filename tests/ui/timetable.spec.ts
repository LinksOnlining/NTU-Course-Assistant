import { expect, test, type Locator, type Page } from "@playwright/test";

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return value!;
}

interface CourseFields {
  readonly name: string;
  readonly teacher?: string;
  readonly classroom?: string;
  readonly weekday?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly weeks?: string;
}

async function addUserCourse(page: Page, fields: CourseFields) {
  await page.getByRole("button", { name: "添加课程" }).click();
  const dialog = page.getByRole("dialog", { name: "添加课程" });
  await dialog.getByLabel("课程名称", { exact: true }).fill(fields.name);
  await dialog.getByLabel("教师（可选）").fill(fields.teacher ?? "测试教师");
  await dialog.getByLabel("教室（可选）").fill(fields.classroom ?? "测试教室");
  await dialog.getByLabel("星期").selectOption(fields.weekday ?? "3");
  await dialog.getByLabel("开始时间").fill(fields.startTime ?? "14:00");
  await dialog.getByLabel("结束时间").fill(fields.endTime ?? "15:30");
  await dialog.getByLabel("上课周数").fill(fields.weeks ?? "1-16");
  await dialog.getByRole("button", { name: "保存课程" }).click();
  return page.locator('[data-source="user"]').filter({ hasText: fields.name }).first();
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

test("period markers use real start times and preserve breaks", async ({ page }) => {
  const axis = await box(page.getByTestId("time-axis"));
  const first = page.locator('[data-period="1"]');
  const second = page.locator('[data-period="2"]');
  const third = page.locator('[data-period="3"]');
  const sixth = page.locator('[data-period="6"]');
  await expect(first).toContainText("第1节");
  await expect(first).toContainText("08:00–08:45");
  const firstBox = await box(first);
  const secondBox = await box(second);
  const thirdBox = await box(third);
  const sixthBox = await box(sixth);
  expect(firstBox.y - axis.y).toBeCloseTo(60, 0);
  expect(secondBox.y - axis.y).toBeCloseTo(110, 0);
  expect(secondBox.y - (firstBox.y + firstBox.height)).toBeCloseTo(5, 0);
  expect(thirdBox.y - (secondBox.y + secondBox.height)).toBeCloseTo(20, 0);
  expect(sixthBox.y - axis.y).toBeCloseTo(420, 0);
  await expect(page.locator('[data-course-id="wednesday-first"] .course-time')).toContainText(
    "第1节 · 08:00–08:45",
  );
});

test("a user course without stored periods shows time without a fabricated period", async ({
  page,
}) => {
  const card = await addUserCourse(page, { name: "无节次用户课程" });
  await expect(card.locator(".course-time")).toHaveText("14:00–15:30");
  await expect(card.locator(".course-time")).not.toContainText("节");
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

test("only user courses expose edit controls and edit keeps ID while moving geometry", async ({
  page,
}) => {
  await expect(page.locator('[data-source="fixture"] .course-edit-button')).toHaveCount(0);
  const original = await addUserCourse(page, { name: "机械设计基础" });
  const originalId = await original.getAttribute("data-course-id");
  await original.getByRole("button", { name: "编辑 机械设计基础" }).click();

  const dialog = page.getByRole("dialog", { name: "编辑课程" });
  await expect(dialog.getByLabel("课程名称", { exact: true })).toHaveValue("机械设计基础");
  await expect(dialog.getByLabel("教师（可选）")).toHaveValue("测试教师");
  await expect(dialog.getByLabel("教室（可选）")).toHaveValue("测试教室");
  await expect(dialog.getByLabel("星期")).toHaveValue("3");
  await expect(dialog.getByLabel("开始时间")).toHaveValue("14:00");
  await expect(dialog.getByLabel("结束时间")).toHaveValue("15:30");
  await expect(dialog.getByLabel("上课周数")).toHaveValue("1-16");

  await dialog.getByLabel("课程名称", { exact: true }).fill("机械原理");
  await dialog.getByLabel("教室（可选）").fill("JX03-201");
  await dialog.getByLabel("星期").selectOption("4");
  await dialog.getByLabel("开始时间").fill("09:00");
  await dialog.getByLabel("结束时间").fill("10:30");
  await dialog.getByRole("button", { name: "保存修改" }).click();

  await expect(page.locator('[data-weekday="3"] [data-source="user"]')).toHaveCount(0);
  const edited = page.locator('[data-weekday="4"] [data-source="user"]');
  await expect(edited).toHaveCount(1);
  await expect(edited).toContainText("机械原理");
  await expect(edited).toContainText("JX03-201");
  await expect(edited).toHaveAttribute("data-course-id", originalId!);
  const day = await box(page.locator('[data-weekday="4"]'));
  const editedBox = await box(edited);
  expect(editedBox.y - day.y).toBeCloseTo(120, 0);
  expect(editedBox.height).toBeCloseTo(90, 0);
});

test("editing weeks can hide a course without deleting it", async ({ page }) => {
  const card = await addUserCourse(page, { name: "周数调整课程" });
  await card.getByRole("button", { name: "编辑 周数调整课程" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑课程" });
  await dialog.getByLabel("上课周数").fill("4-8,10,12-15");
  await dialog.getByRole("button", { name: "保存修改" }).click();
  await expect(page.locator('[data-source="user"]')).toHaveCount(0);
});

test("invalid edit is blocked and cancel preserves the original course", async ({ page }) => {
  const card = await addUserCourse(page, { name: "不可破坏课程" });
  const originalId = await card.getAttribute("data-course-id");
  const originalTitle = await card.getAttribute("title");
  await card.getByRole("button", { name: "编辑 不可破坏课程" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑课程" });
  await dialog.getByLabel("课程名称", { exact: true }).fill("");
  await dialog.getByLabel("开始时间").fill("15:30");
  await dialog.getByLabel("结束时间").fill("14:00");
  await dialog.getByLabel("上课周数").fill("abc");
  await dialog.getByRole("button", { name: "保存修改" }).click();
  await expect(dialog.getByText("课程名称不能为空")).toBeVisible();
  await expect(dialog.getByText("结束时间必须晚于开始时间，且不能跨午夜")).toBeVisible();
  await expect(dialog.getByText("周数格式不正确，请使用 1-4,7,10-12")).toBeVisible();

  await dialog.getByLabel("课程名称", { exact: true }).fill("越界修改");
  await dialog.getByLabel("开始时间").fill("06:00");
  await dialog.getByLabel("结束时间").fill("07:00");
  await dialog.getByLabel("上课周数").fill("1-16");
  await dialog.getByRole("button", { name: "保存修改" }).click();
  await expect(dialog.getByText("课程时间超出当前显示范围（07:00–22:00）")).toBeVisible();
  await dialog.getByRole("button", { name: "取消" }).click();

  const unchanged = page.locator(`[data-course-id="${originalId}"]`);
  await expect(unchanged).toHaveCount(1);
  await expect(unchanged).toHaveAttribute("title", originalTitle!);
  await expect(page.getByText("越界修改", { exact: true })).toHaveCount(0);
});

test("edit cancel discards every changed field without creating a copy", async ({ page }) => {
  const card = await addUserCourse(page, { name: "保持原样课程", classroom: "原教室" });
  const id = await card.getAttribute("data-course-id");
  await card.getByRole("button", { name: "编辑 保持原样课程" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑课程" });
  await dialog.getByLabel("课程名称", { exact: true }).fill("不应保存");
  await dialog.getByLabel("星期").selectOption("6");
  await dialog.getByLabel("开始时间").fill("08:00");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(page.locator('[data-source="user"]')).toHaveCount(1);
  await expect(page.locator(`[data-course-id="${id}"]`)).toContainText("保持原样课程");
  await expect(page.locator(`[data-course-id="${id}"]`)).toContainText("原教室");
  await expect(page.getByText("不应保存", { exact: true })).toHaveCount(0);
});

test("delete confirmation supports cancel and then removes by course ID", async ({ page }) => {
  let card = await addUserCourse(page, { name: "待删除课程" });
  await card.getByRole("button", { name: "编辑 待删除课程" }).click();
  let dialog = page.getByRole("dialog", { name: "编辑课程" });
  await dialog.getByRole("button", { name: "删除 待删除课程" }).click();
  await expect(dialog.getByText("确定删除“待删除课程”吗？")).toBeVisible();
  await dialog.getByRole("button", { name: "保留课程" }).click();
  await expect(dialog.getByText("确定删除“待删除课程”吗？")).toHaveCount(0);
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(page.locator('[data-source="user"]')).toHaveCount(1);

  card = page.locator('[data-source="user"]');
  await card.getByRole("button", { name: "编辑 待删除课程" }).click();
  dialog = page.getByRole("dialog", { name: "编辑课程" });
  await dialog.getByRole("button", { name: "删除 待删除课程" }).click();
  await dialog.getByRole("button", { name: "确认删除 待删除课程" }).click();
  await expect(page.locator('[data-source="user"]')).toHaveCount(0);
});

test("deleting an overlap recalculates the remaining course to one lane", async ({ page }) => {
  const first = await addUserCourse(page, {
    name: "用户重叠 A",
    weekday: "6",
    startTime: "08:00",
    endTime: "09:30",
    weeks: "3",
  });
  const second = await addUserCourse(page, {
    name: "用户重叠 B",
    weekday: "6",
    startTime: "09:00",
    endTime: "10:00",
    weeks: "3",
  });
  await expect(first).toHaveAttribute("data-lane-count", "2");
  await expect(second).toHaveAttribute("data-lane-count", "2");
  await second.getByRole("button", { name: "编辑 用户重叠 B" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑课程" });
  await dialog.getByRole("button", { name: "删除 用户重叠 B" }).click();
  await dialog.getByRole("button", { name: "确认删除 用户重叠 B" }).click();
  await expect(page.locator('[data-source="user"]')).toHaveCount(1);
  await expect(first).toHaveAttribute("data-lane", "0");
  await expect(first).toHaveAttribute("data-lane-count", "1");
});

test("storage failures keep the original UI state and show a clear error", async ({ page }) => {
  await page.addInitScript(() => {
    const storedCourse = {
      id: "storage-failure-course",
      name: "数据库原课程",
      teacher: null,
      classroom: null,
      weekday: 3,
      startPeriod: null,
      endPeriod: null,
      startTime: "14:00",
      endTime: "15:30",
      weeks: [1, 2, 3],
    };
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string) => {
          if (command === "load_courses") return { courses: [storedCourse], warnings: [] };
          if (command === "update_course") throw "更新课程失败，请稍后重试。";
          if (command === "delete_course") throw "删除课程失败，请稍后重试。";
          throw "未预期的存储命令";
        },
      },
    });
  });
  await page.reload();
  const original = page.locator('[data-course-id="storage-failure-course"]');
  await original.getByRole("button", { name: "编辑 数据库原课程" }).click();
  let dialog = page.getByRole("dialog", { name: "编辑课程" });
  await dialog.getByLabel("课程名称", { exact: true }).fill("不应保存的修改");
  await dialog.getByRole("button", { name: "保存修改" }).click();
  await expect(dialog.getByText("更新课程失败，请稍后重试。")).toBeVisible();
  await expect(original).toContainText("数据库原课程");
  await dialog.getByRole("button", { name: "取消" }).click();

  await original.getByRole("button", { name: "编辑 数据库原课程" }).click();
  dialog = page.getByRole("dialog", { name: "编辑课程" });
  await dialog.getByRole("button", { name: "删除 数据库原课程" }).click();
  await dialog.getByRole("button", { name: "确认删除 数据库原课程" }).click();
  await expect(dialog.getByText("删除课程失败，请稍后重试。")).toBeVisible();
  await expect(original).toHaveCount(1);
});

test("a failed insert does not create a course in the UI", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string) => {
          if (command === "load_courses") return { courses: [], warnings: [] };
          if (command === "insert_course") throw "保存课程失败，请稍后重试。";
          throw "未预期的存储命令";
        },
      },
    });
  });
  await page.reload();
  await addUserCourse(page, { name: "不应出现的课程" });
  const dialog = page.getByRole("dialog", { name: "添加课程" });
  await expect(dialog.getByText("保存课程失败，请稍后重试。")).toBeVisible();
  await expect(page.locator('[data-source="user"]')).toHaveCount(0);
});

test("a stored course outside the current axis is skipped without crashing", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string) => {
          if (command !== "load_courses") throw "未预期的存储命令";
          return {
            courses: [
              {
                id: "outside-axis",
                name: "轴外损坏课程",
                teacher: null,
                classroom: null,
                weekday: 3,
                startPeriod: null,
                endPeriod: null,
                startTime: "06:00",
                endTime: "07:00",
                weeks: [3],
              },
            ],
            warnings: [],
          };
        },
      },
    });
  });
  await page.reload();
  await expect(
    page.getByText("课程“轴外损坏课程”超出当前显示范围，已跳过且未修改原数据。"),
  ).toBeVisible();
  await expect(page.locator('[data-course-id="outside-axis"]')).toHaveCount(0);
  await expect(page.getByTestId("day-column")).toHaveCount(7);
});

test("unsupported database version leaves the app usable but disables writes", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string) => {
          if (command === "load_courses") {
            throw "本地课程数据暂时无法加载：数据库来自较新版本，请升级应用后重试。";
          }
          throw "存储不可用";
        },
      },
    });
  });
  await page.reload();
  await expect(
    page.getByText("本地课程数据暂时无法加载：数据库来自较新版本，请升级应用后重试。"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "添加课程" })).toBeDisabled();
  await expect(page.getByTestId("day-column")).toHaveCount(7);
});
