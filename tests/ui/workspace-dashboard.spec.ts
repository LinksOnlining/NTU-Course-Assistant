import { expect, test, type Page } from "@playwright/test";

const FIXED_NOW = new Date("2026-09-23T12:00:00");

async function seedDashboardRuntime(page: Page, currentTime = FIXED_NOW) {
  await page.clock.install({ time: currentTime });
  await page.addInitScript(() => {
    const course = {
      id: "dashboard-course",
      name: "数学基础",
      teacher: "教师甲",
      classroom: "A101",
      weekday: 3,
      startPeriod: null,
      endPeriod: null,
      startTime: "11:30",
      endTime: "12:30",
      weeks: [1],
    };
    const activeSemester = {
      id: "dashboard-semester",
      name: "测试学期",
      firstWeekMonday: "2026-09-21",
      totalWeeks: 16,
      timezone: "Asia/Shanghai",
      status: "ACTIVE",
      createdAt: "",
      updatedAt: "",
    };
    const dueAt = (hour: number) => new Date(2026, 8, 23, hour, 0, 0).toISOString();
    const tasks = [
      { id: "task-overdue", title: "逾期事项", dueAt: dueAt(10), priority: 0, status: "TODO" },
      { id: "task-today", title: "今天事项", dueAt: dueAt(13), priority: 0, status: "TODO" },
      { id: "task-future", title: "未来事项", dueAt: dueAt(15), priority: 0, status: "TODO" },
      { id: "task-none", title: "无截止事项", dueAt: "", priority: 0, status: "TODO" },
      {
        id: "task-completed",
        title: "已完成事项",
        dueAt: dueAt(9),
        priority: 2,
        status: "COMPLETED",
      },
    ].map((task) => ({
      semesterId: activeSemester.id,
      courseId: null,
      type: "ASSIGNMENT",
      note: null,
      completedAt: task.status === "COMPLETED" ? dueAt(9) : null,
      createdAt: "",
      updatedAt: "",
      ...task,
    }));
    let loadCoursesCount = 0;
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string) => {
          if (command === "load_courses") {
            loadCoursesCount += 1;
            return { courses: [course], warnings: [] };
          }
          if (command === "load_period_times") return [];
          if (command === "load_reminder_configuration") {
            return {
              termConfig: null,
              reminderSettings: { enabled: false, advanceMinutes: 15 },
              warnings: [],
            };
          }
          if (command === "load_widget_settings") {
            return {
              enabled: false,
              displayMode: "today",
              locked: false,
              x: null,
              y: null,
              width: null,
              height: null,
            };
          }
          if (command === "load_day_count") return 7;
          if (command === "load_semesters") return [activeSemester];
          if (command === "load_course_overrides" || command === "load_exams") return [];
          if (command === "load_academic_tasks") return tasks;
          if (command === "load_handled_reminder_keys") return [];
          if (
            command === "refresh_reminder_schedule" ||
            command === "trace_runtime_event" ||
            command === "plugin:event|listen" ||
            command === "plugin:event|unlisten"
          ) {
            return command === "plugin:event|listen" ? 1 : undefined;
          }
          if (command === "plugin:updater|check") return null;
          throw new Error(`未预期的工作台测试命令：${command}`);
        },
      },
    });
    Object.assign(window, {
      __workspaceDashboardTest: {
        getLoadCoursesCount: () => loadCoursesCount,
      },
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("workspace-dashboard")).toBeVisible();
  await expect(page.getByRole("heading", { name: "今日日程" })).toBeVisible();
}

test("Workspace dashboard fits target windows, keeps only Timeline internally scrollable, and places now near 40%", async ({
  page,
}) => {
  await seedDashboardRuntime(page);
  await expect(page.getByText("数学基础", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /日记，尚未开放/u })).toBeVisible();
  await expect(page.getByRole("button", { name: /收件箱，尚未开放/u })).toBeVisible();
  await expect(page.getByRole("button", { name: /AI，尚未开放/u })).toBeVisible();
  await expect(page.getByText("已完成事项", { exact: true })).toHaveCount(0);

  const timeline = page.getByRole("region", { name: "今日日程时间轴" });
  await expect(timeline).toBeVisible();
  await expect(timeline.locator(".workspace-timeline-tick--end")).toHaveText("24:00");
  await expect(timeline.locator(".workspace-timeline-tick--hour").first()).toHaveText("00:00");
  await expect(
    timeline.locator(".workspace-timeline-tick--hour").filter({ hasText: "12:00" }),
  ).toHaveCount(1);
  await expect(
    timeline.locator(".workspace-timeline-tick--hour").filter({ hasText: "23:00" }),
  ).toHaveCount(1);
  await expect(page.getByTestId("timeline-item")).toHaveAttribute("data-draggable", "false");
  await expect(page.getByTestId("timeline-item")).toHaveAttribute("data-resizable", "false");

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1600, height: 900 },
    { width: 1366, height: 768 },
    { width: 720, height: 520 },
  ]) {
    await page.setViewportSize(viewport);
    await page.reload();
    await expect(page.getByTestId("workspace-dashboard")).toBeVisible();
    await expect(page.getByTestId("timeline-item")).toBeVisible();
    const measurements = await page.evaluate(() => {
      const timelineElement = document.querySelector<HTMLElement>(".workspace-timeline-viewport");
      const nowLine = document.querySelector<HTMLElement>(".workspace-current-time-line");
      const dashboard = document.querySelector<HTMLElement>(".workspace-dashboard");
      const rail = document.querySelector<HTMLElement>(".workspace-dashboard-rail");
      if (!timelineElement || !nowLine || !dashboard || !rail) return null;
      const timelineBox = timelineElement.getBoundingClientRect();
      const nowBox = nowLine.getBoundingClientRect();
      return {
        pageVerticalScroll:
          document.documentElement.scrollHeight > window.innerHeight + 1 ||
          document.body.scrollHeight > window.innerHeight + 1,
        mainVerticalScroll: dashboard.scrollHeight > dashboard.clientHeight + 1,
        rightRailVerticalScroll: rail.scrollHeight > rail.clientHeight + 1,
        timelineHasInternalScroll: timelineElement.scrollHeight > timelineElement.clientHeight,
        nowLineViewportRatio: (nowBox.top - timelineBox.top) / timelineBox.height,
      };
    });
    expect(measurements, `工作台视口 ${viewport.width}×${viewport.height}`).not.toBeNull();
    expect(measurements?.pageVerticalScroll).toBe(false);
    expect(measurements?.mainVerticalScroll).toBe(false);
    expect(measurements?.rightRailVerticalScroll).toBe(false);
    expect(measurements?.timelineHasInternalScroll).toBe(true);
    expect(measurements?.nowLineViewportRatio).toBeGreaterThanOrEqual(0.35);
    expect(measurements?.nowLineViewportRatio).toBeLessThanOrEqual(0.45);

    if (viewport.height >= 900) {
      await expect(page.getByRole("button", { name: /逾期事项/u })).toBeVisible();
      await expect(page.getByRole("button", { name: /无截止事项/u })).toBeVisible();
      await expect(
        page.locator(".workspace-task-list li").filter({ hasText: "无截止事项" }),
      ).toBeVisible();
    }
    if (viewport.width === 1366) {
      await expect(
        page.locator(".workspace-task-list li").filter({ hasText: "未来事项" }),
      ).toBeVisible();
      await expect(
        page.locator(".workspace-task-list li").filter({ hasText: "无截止事项" }),
      ).not.toBeVisible();
    }
    if (viewport.width === 720) {
      await expect(page.getByRole("button", { name: /工作台/u })).toBeVisible();
      await expect(page.getByRole("button", { name: /课表/u })).toBeVisible();
      await expect(page.getByRole("button", { name: "设置" })).toBeVisible();
      await expect(page.getByRole("button", { name: /任务/u })).toBeVisible();
      await expect(page.getByRole("button", { name: /日记，尚未开放/u })).toBeVisible();
      await expect(page.getByRole("button", { name: /收件箱，尚未开放/u })).toBeVisible();
      await expect(page.getByRole("button", { name: /AI，尚未开放/u })).toBeVisible();
    }
  }
});

test("minute updates move the current-time line without taking back manual scroll position", async ({
  page,
}) => {
  await seedDashboardRuntime(page);
  const timeline = page.getByRole("region", { name: "今日日程时间轴" });
  await timeline.evaluate((node) => {
    node.scrollTop = 0;
  });
  const before = await page
    .locator(".workspace-current-time-line")
    .evaluate((node) => node.getBoundingClientRect().top);
  await page.clock.fastForward(60_000);
  await expect.poll(() => timeline.evaluate((node) => node.scrollTop)).toBe(0);
  const after = await page
    .locator(".workspace-current-time-line")
    .evaluate((node) => node.getBoundingClientRect().top);
  expect(after - before).toBe(1);
});

test("crossing local midnight reloads the current day's Academic data once", async ({ page }) => {
  await seedDashboardRuntime(page, new Date(2026, 8, 23, 23, 59, 0));
  const getLoads = () =>
    page.evaluate(() =>
      (
        window as Window & { __workspaceDashboardTest: { getLoadCoursesCount(): number } }
      ).__workspaceDashboardTest.getLoadCoursesCount(),
    );
  const before = await getLoads();
  await page.clock.fastForward(60_000);
  await expect(page.getByTestId("workspace-dashboard")).toHaveAttribute("data-date", "2026-09-24");
  await expect.poll(getLoads).toBeGreaterThan(before);
  await expect(page.getByText("今天暂无日程", { exact: true }).last()).toBeVisible();
});

test("Diary and schedule routes remain explicit, and returning to Workspace reloads Academic data", async ({
  page,
}) => {
  await seedDashboardRuntime(page);
  const getLoads = () =>
    page.evaluate(() =>
      (
        window as Window & { __workspaceDashboardTest: { getLoadCoursesCount(): number } }
      ).__workspaceDashboardTest.getLoadCoursesCount(),
    );
  let previousLoads = await getLoads();
  for (const name of ["日记，尚未开放", "收件箱，尚未开放", "AI，尚未开放", "查看完整日程"]) {
    await page.getByRole("button", { name: new RegExp(name, "u") }).click();
    await expect(page.getByRole("heading", { name: "该模块尚未开放" })).toBeVisible();
    await page.getByRole("button", { name: "返回工作台" }).click();
    await expect(page.getByTestId("workspace-dashboard")).toBeVisible();
    await expect.poll(getLoads).toBeGreaterThan(previousLoads);
    previousLoads = await getLoads();
  }

  const mode = page.getByRole("navigation", { name: "产品模式" });
  previousLoads = await getLoads();
  await mode.getByRole("button", { name: "课表" }).click();
  await expect(page.getByRole("heading", { name: "大学课程表" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "课表二级导航" })).toBeVisible();
  await mode.getByRole("button", { name: "工作台" }).click();
  await expect(page.getByTestId("workspace-dashboard")).toBeVisible();
  await expect.poll(getLoads).toBeGreaterThan(previousLoads);
});

test("Dashboard cards remain visible in both light and dark themes", async ({ page }) => {
  await seedDashboardRuntime(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const visibleModules = async () => {
    await expect(page.getByRole("heading", { name: "今日日程" })).toBeVisible();
    await expect(page.getByRole("button", { name: /任务/u })).toBeVisible();
    await expect(page.getByRole("button", { name: /日记，尚未开放/u })).toBeVisible();
    await expect(page.getByRole("button", { name: /收件箱，尚未开放/u })).toBeVisible();
    await expect(page.getByRole("button", { name: /AI，尚未开放/u })).toBeVisible();
  };
  await visibleModules();

  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "作息时间" });
  await settings.getByLabel("主题").selectOption("dark");
  await settings.getByRole("button", { name: "取消" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await visibleModules();
});

test("empty Academic data still renders the complete axis and truthful empty/unavailable states", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("workspace-dashboard")).toBeVisible();
  const timeline = page.getByRole("region", { name: "今日日程时间轴" });
  await expect(timeline.getByText("今天暂无日程", { exact: true })).toBeVisible();
  await expect(timeline.getByText("00:00")).toBeVisible();
  await expect(timeline.getByText("24:00")).toBeVisible();
  await expect(page.getByText("暂无未完成学业事项")).toBeVisible();
  await expect(page.getByText("尚未开放").first()).toBeVisible();
  await expect(page.getByText(/^0$/u)).toHaveCount(0);
});
