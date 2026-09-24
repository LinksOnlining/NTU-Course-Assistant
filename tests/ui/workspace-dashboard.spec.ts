import { expect, test, type Page } from "@playwright/test";

const FIXED_NOW = new Date("2026-09-23T12:00:00");

async function seedDashboardRuntime(
  page: Page,
  currentTime = FIXED_NOW,
  courseName = "数学基础",
  plannerFixture: {
    readonly events?: readonly unknown[];
    readonly timeBlocks?: readonly unknown[];
    readonly personalTasks?: readonly unknown[];
  } = {},
  diaryFixture: { readonly hasEntry?: boolean; readonly failSave?: boolean } = {},
  inboxFixture: { readonly pendingCount?: number; readonly items?: readonly unknown[] } = {},
) {
  await page.clock.install({ time: currentTime });
  await page.addInitScript(
    ({ name, plannerFixture, diaryFixture, inboxFixture }) => {
      const course = {
        id: "dashboard-course",
        name,
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
      let personalTasks = [...(plannerFixture.personalTasks ?? [])];
      const today = new Date().toISOString().slice(0, 10);
      const diaryEntries = new Map<string, Record<string, string>>();
      const inboxItems = [...(inboxFixture.items ?? [])] as Record<string, unknown>[];
      if (diaryFixture.hasEntry) {
        diaryEntries.set(today, {
          id: "diary-fixture",
          entryDate: today,
          body: "private diary fixture body",
          createdAt: "2026-09-23T01:00:00.000Z",
          updatedAt: "2026-09-23T01:00:00.000Z",
        });
      }
      let failDiarySave = diaryFixture.failSave ?? false;
      let loadCoursesCount = 0;
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        value: {
          invoke: async (command: string, args?: Record<string, unknown>) => {
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
            if (command === "load_personal_tasks") return [...personalTasks];
            if (command === "create_personal_task" && args?.task) {
              const task = args.task as Record<string, unknown>;
              personalTasks = [...personalTasks, task];
              return task;
            }
            if (command === "load_diary_entry") return diaryEntries.get(String(args?.date)) ?? null;
            if (command === "load_diary_content_dates")
              return [...diaryEntries.keys()].sort().reverse();
            if (command === "has_diary_entry") {
              return Boolean(diaryEntries.get(String(args?.date))?.body.trim());
            }
            if (command === "count_pending_inbox_items")
              return inboxItems.filter((item) =>
                ["pending", "needs_review", "ready"].includes(String(item.status)),
              ).length;
            if (command === "load_inbox_items") return inboxItems.map((item) => ({ ...item }));
            if (command === "create_inbox_item") {
              const item = {
                id: args?.id,
                rawText: args?.rawText,
                status: "pending",
                parseKind: null,
                parsePayloadJson: null,
                parserVersion: null,
                confirmedTargetType: null,
                confirmedTargetId: null,
                createdAt: args?.createdAt,
                updatedAt: args?.createdAt,
              };
              inboxItems.unshift(item);
              return item;
            }
            if (command === "save_inbox_parse_result") {
              const item = inboxItems.find((candidate) => candidate.id === args?.id);
              if (!item) throw new Error("收件箱内容不存在");
              Object.assign(item, {
                status: args?.parseKind === "unknown" ? "needs_review" : "ready",
                parseKind: args?.parseKind,
                parsePayloadJson: args?.parsePayloadJson,
                parserVersion: args?.parserVersion,
                updatedAt: args?.updatedAt,
              });
              return { ...item };
            }
            if (command === "dismiss_inbox_item") {
              const item = inboxItems.find((candidate) => candidate.id === args?.id);
              if (!item) throw new Error("收件箱内容不存在");
              Object.assign(item, { status: "dismissed", updatedAt: args?.updatedAt });
              return;
            }
            if (command === "delete_inbox_item") {
              const index = inboxItems.findIndex((candidate) => candidate.id === args?.id);
              if (index < 0) throw new Error("收件箱内容不存在");
              inboxItems.splice(index, 1);
              return;
            }
            if (command === "confirm_inbox_as_task" || command === "confirm_inbox_as_event") {
              const item = inboxItems.find((candidate) => candidate.id === args?.id);
              if (!item) throw new Error("收件箱内容不存在");
              if (item.status === "confirmed")
                return { targetType: item.confirmedTargetType, targetId: item.confirmedTargetId };
              const isTask = command === "confirm_inbox_as_task";
              const target = args?.[isTask ? "task" : "event"] as Record<string, unknown>;
              if (isTask) personalTasks.push(target);
              Object.assign(item, {
                status: "confirmed",
                confirmedTargetType: isTask ? "personalTask" : "plannerEvent",
                confirmedTargetId: target.id,
              });
              return { targetType: item.confirmedTargetType, targetId: target.id };
            }
            if (command === "save_diary_entry" && args?.entry) {
              if (failDiarySave) throw new Error("save failed");
              const incoming = args.entry as Record<string, string>;
              const current = diaryEntries.get(incoming.entryDate);
              const saved = {
                ...incoming,
                id: current?.id ?? incoming.id,
                createdAt: current?.createdAt ?? incoming.createdAt,
              };
              diaryEntries.set(incoming.entryDate, saved);
              return saved;
            }
            if (command === "load_planner_events") return plannerFixture.events ?? [];
            if (command === "load_time_blocks") return plannerFixture.timeBlocks ?? [];
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
          getPersonalTaskCount: () => personalTasks.length,
          getDiaryBody: (date: string) => diaryEntries.get(date)?.body ?? null,
          setDiarySaveFailure: (value: boolean) => {
            failDiarySave = value;
          },
        },
      });
    },
    { name: courseName, plannerFixture, diaryFixture, inboxFixture },
  );
  await page.goto("/");
  await expect(page.getByTestId("workspace-dashboard")).toBeVisible();
  await expect(page.getByRole("heading", { name: "今日日程" })).toBeVisible();
}

test("Dashboard Inbox count opens the local raw-first review and confirms user-edited targets", async ({
  page,
}) => {
  const initialInbox = ["inbox-seed-a", "inbox-seed-b"].map((id, index) => ({
    id,
    rawText: `待整理内容 ${index + 1}`,
    status: "ready",
    parseKind: "task",
    parsePayloadJson: JSON.stringify({
      kind: "task",
      title: `待整理内容 ${index + 1}`,
      date: null,
      startTime: null,
      endTime: null,
      deadlineDate: null,
      deadlineTime: null,
    }),
    parserVersion: "inbox-parser-v1",
    confirmedTargetType: null,
    confirmedTargetId: null,
    createdAt: `2026-09-23T11:0${index}:00.000Z`,
    updatedAt: `2026-09-23T11:0${index}:00.000Z`,
  }));
  await seedDashboardRuntime(page, FIXED_NOW, "数学基础", {}, {}, { items: initialInbox });
  const inboxCard = page.getByRole("button", { name: "收件箱，待整理 2 条" });
  await expect(inboxCard).toBeVisible();
  await inboxCard.click();
  await expect(page.getByTestId("workspace-inbox")).toBeVisible();

  await page.getByLabel("记录一条想法").fill("任务：整理材料 截止明天 18:00");
  await page.getByRole("button", { name: "添加到收件箱" }).click();
  await expect(page.locator(".workspace-inbox-count")).toContainText("待整理 3");
  const taskItem = page
    .getByTestId("inbox-item")
    .filter({ hasText: "任务：整理材料 截止明天 18:00" });
  await expect(taskItem.getByLabel("标题")).toHaveValue("整理材料");
  await taskItem.getByLabel("标题").fill("用户确认后的材料任务");
  await taskItem.getByRole("button", { name: "确认创建任务" }).click();
  await expect(taskItem.getByText("已转为任务")).toBeVisible();
  await taskItem.getByRole("button", { name: "打开任务" }).click();
  await expect(page.getByTestId("workspace-tasks")).toBeVisible();
  await expect(page.getByRole("button", { name: /收件箱，待整理 2 条/u })).toHaveCount(0);

  await page
    .getByRole("navigation", { name: "产品模式" })
    .getByRole("button", { name: "工作台" })
    .click();
  await expect(page.getByTestId("workspace-dashboard")).toBeVisible();
  await page.getByRole("button", { name: /收件箱，待整理 2 条/u }).click();
  await expect(page.getByTestId("workspace-inbox")).toBeVisible();
  const confirmedTask = page
    .getByTestId("inbox-item")
    .filter({ hasText: "任务：整理材料 截止明天 18:00" });
  await confirmedTask.getByRole("button", { name: "删除记录" }).click();
  await confirmedTask.getByRole("button", { name: "确认删除" }).click();
  const runtime = await page.evaluate(() =>
    (
      window as Window & { __workspaceDashboardTest: { getPersonalTaskCount: () => number } }
    ).__workspaceDashboardTest.getPersonalTaskCount(),
  );
  expect(runtime).toBe(1);

  await page.getByLabel("记录一条想法").fill("明天下午去图书馆");
  await page.getByRole("button", { name: "添加到收件箱" }).click();
  const eventItem = page.getByTestId("inbox-item").filter({ hasText: "明天下午去图书馆" });
  await expect(eventItem.getByRole("button", { name: "请先选择类型" })).toBeDisabled();
  await eventItem.getByLabel("整理为").selectOption("event");
  const confirmEvent = eventItem.getByRole("button", { name: "确认创建日程" });
  await expect(confirmEvent).toBeDisabled();
  await eventItem.getByLabel(/日期/u).fill("2026-09-24");
  await eventItem.getByLabel(/开始时间/u).fill("14:00");
  await eventItem.getByLabel(/结束时间/u).fill("15:00");
  await expect(confirmEvent).toBeEnabled();
  await confirmEvent.click();
  await expect(eventItem.getByText("已转为日程")).toBeVisible();

  await page.getByLabel("记录一条想法").fill("暂时保留的想法");
  await page.getByRole("button", { name: "添加到收件箱" }).click();
  const dismissedItem = page.getByTestId("inbox-item").filter({ hasText: "暂时保留的想法" });
  await dismissedItem.getByRole("button", { name: "暂不处理" }).click();
  await expect(dismissedItem.getByText("已忽略")).toBeVisible();
  await expect(dismissedItem.getByText("暂时保留的想法")).toBeVisible();
  await page.locator(".workspace-inbox-breadcrumb").click();
  await expect(page.getByRole("button", { name: "收件箱，待整理 2 条" })).toBeVisible();
});

test("Workspace dashboard fits target windows, keeps only Timeline internally scrollable, and places now near 40%", async ({
  page,
}) => {
  await seedDashboardRuntime(page);
  await expect(
    page.getByTestId("timeline-item").getByText("数学基础", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /日记，今天还没有记录/u })).toBeVisible();
  await expect(page.getByRole("button", { name: /收件箱，暂无待整理/u })).toBeVisible();
  await expect(page.getByRole("button", { name: /AI，尚未开放/u })).toBeVisible();
  await expect(page.getByText("已完成事项", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("workspace-today-overview")).toBeVisible();
  await expect(page.getByTestId("workspace-today-overview")).toContainText("正在上课");
  await expect(page.getByTestId("workspace-today-overview")).not.toContainText("今日概览");
  await expect(
    page.getByTestId("workspace-today-overview").locator(".workspace-ambient"),
  ).toHaveAttribute("aria-hidden", "true");
  await expect(page.getByTestId("workspace-time-context")).toBeVisible();
  await expect(page.getByTestId("workspace-time-context")).toContainText("正在上课");
  await expect(page.getByTestId("workspace-time-context")).not.toContainText("时间概览");

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
      const context = document.querySelector<HTMLElement>(".workspace-time-context");
      const canvas = document.querySelector<HTMLElement>(".workspace-timeline-canvas");
      const item = document.querySelector<HTMLElement>(".workspace-timeline-item");
      if (!timelineElement || !nowLine || !dashboard || !rail || !context || !canvas || !item)
        return null;
      const timelineBox = timelineElement.getBoundingClientRect();
      const nowBox = nowLine.getBoundingClientRect();
      return {
        pageVerticalScroll:
          document.documentElement.scrollHeight > window.innerHeight + 1 ||
          document.body.scrollHeight > window.innerHeight + 1,
        mainVerticalScroll: dashboard.scrollHeight > dashboard.clientHeight + 1,
        rightRailVerticalScroll: rail.scrollHeight > rail.clientHeight + 1,
        threeColumnOrder:
          timelineElement.getBoundingClientRect().right < context.getBoundingClientRect().left &&
          context.getBoundingClientRect().right < rail.getBoundingClientRect().left,
        timelineHasInternalScroll: timelineElement.scrollHeight > timelineElement.clientHeight,
        nowLineViewportRatio: (nowBox.top - timelineBox.top) / timelineBox.height,
        dashboardHeight: dashboard.clientHeight,
        canvasHeight: canvas.clientHeight,
        itemTop: item.getBoundingClientRect().top - canvas.getBoundingClientRect().top,
        nowTop: nowBox.top - canvas.getBoundingClientRect().top,
      };
    });
    expect(measurements, `工作台视口 ${viewport.width}×${viewport.height}`).not.toBeNull();
    expect(measurements?.pageVerticalScroll).toBe(false);
    expect(measurements?.mainVerticalScroll).toBe(false);
    expect(measurements?.rightRailVerticalScroll).toBe(false);
    expect(measurements?.threeColumnOrder).toBe(true);
    expect(measurements?.timelineHasInternalScroll).toBe(true);
    expect(measurements?.canvasHeight).toBe(1440);
    expect(measurements?.itemTop).toBeCloseTo(690, 0);
    expect(measurements?.nowTop).toBeCloseTo(720, 0);
    if (viewport.width === 1366) expect(measurements?.dashboardHeight).toBeGreaterThan(500);
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
      await expect(page.locator(".workspace-task-list li").first()).toBeVisible();
      await expect(page.getByRole("button", { name: /工作台/u })).toBeVisible();
      await expect(page.getByRole("button", { name: /课表/u })).toBeVisible();
      await expect(page.getByRole("button", { name: "设置" })).toBeVisible();
      await expect(page.getByRole("button", { name: /任务/u })).toBeVisible();
      await expect(page.getByRole("button", { name: /日记，今天还没有记录/u })).toBeVisible();
      await expect(page.getByRole("button", { name: /收件箱，暂无待整理/u })).toBeVisible();
      await expect(page.getByRole("button", { name: /AI，尚未开放/u })).toBeVisible();
    }
  }
});

test("Diary dashboard status is private and the Diary route saves plain text", async ({ page }) => {
  await seedDashboardRuntime(page, FIXED_NOW, "数学基础", {}, { hasEntry: true });
  const diaryCard = page.getByRole("button", { name: /日记，今天已记录/u });
  await expect(diaryCard).toBeVisible();
  await expect(page.getByText("private diary fixture body", { exact: true })).toHaveCount(0);
  await diaryCard.click();
  const editor = page.getByRole("textbox", { name: /日记正文/u });
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue("private diary fixture body");
  const surface = page.locator(".workspace-diary-editor");
  const lightSurface = await surface.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  const darkSurface = await surface.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(darkSurface).not.toBe(lightSurface);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await editor.fill("本地日记自动保存内容");
  await page.getByRole("button", { name: /工作台.*日记/u }).click();
  await expect(page.getByTestId("workspace-dashboard")).toBeVisible();
  await expect(page.getByRole("button", { name: /日记，今天已记录/u })).toBeVisible();
  await expect(page.getByText("本地日记自动保存内容", { exact: true })).toHaveCount(0);
  const savedBody = await page.evaluate(() =>
    (
      window as unknown as {
        __workspaceDashboardTest: { getDiaryBody: (date: string) => string | null };
      }
    ).__workspaceDashboardTest.getDiaryBody("2026-09-23"),
  );
  expect(savedBody).toBe("本地日记自动保存内容");
});

test("Diary save failure keeps the draft visible and can be retried", async ({ page }) => {
  await seedDashboardRuntime(page, FIXED_NOW, "数学基础", {}, { failSave: true });
  await page.getByRole("button", { name: /日记，今天还没有记录/u }).click();
  const editor = page.getByRole("textbox", { name: /日记正文/u });
  await editor.fill("保留在编辑器中的草稿");
  await page.getByRole("button", { name: /工作台.*日记/u }).click();
  await expect(page.getByRole("alert")).toContainText("保存失败");
  await expect(editor).toHaveValue("保留在编辑器中的草稿");
  await page.evaluate(() =>
    (
      window as unknown as {
        __workspaceDashboardTest: { setDiarySaveFailure: (value: boolean) => void };
      }
    ).__workspaceDashboardTest.setDiarySaveFailure(false),
  );
  await page.getByRole("button", { name: "重试保存" }).click();
  await expect(page.getByRole("status")).toContainText("已保存");
  await page.getByRole("button", { name: /工作台.*日记/u }).click();
  await expect(page.getByRole("button", { name: /日记，今天已记录/u })).toBeVisible();
});

test("Diary date switch flushes pending text and remains usable at compact height", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await seedDashboardRuntime(page);
  await page.getByRole("button", { name: /日记，今天还没有记录/u }).click();
  const editor = page.getByRole("textbox", { name: /日记正文/u });
  await expect(editor).toBeVisible();
  await editor.fill("前一天切换前保存");
  await page.getByRole("button", { name: "前一天" }).click();
  await expect(page.getByRole("textbox", { name: /2026-09-22 日记正文/u })).toBeVisible();
  const savedBody = await page.evaluate(() =>
    (
      window as unknown as {
        __workspaceDashboardTest: { getDiaryBody: (date: string) => string | null };
      }
    ).__workspaceDashboardTest.getDiaryBody("2026-09-23"),
  );
  expect(savedBody).toBe("前一天切换前保存");
  await expect(page.getByRole("heading", { name: "日记" })).toBeVisible();
});

test("00:00 and 24:00 labels stay inside the timeline without shifting minute geometry", async ({
  page,
}) => {
  await seedDashboardRuntime(page);
  const viewport = page.getByRole("region", { name: "今日日程时间轴" });
  const first = viewport.locator(".workspace-timeline-tick--hour").first();
  const last = viewport.locator(".workspace-timeline-tick--end");
  await viewport.evaluate((node) => {
    node.scrollTop = 0;
  });
  expect(
    await first.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const view = document.querySelector(".workspace-timeline-viewport")!.getBoundingClientRect();
      return box.top >= view.top && box.bottom <= view.bottom;
    }),
  ).toBe(true);
  await viewport.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  expect(
    await last.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const view = document.querySelector(".workspace-timeline-viewport")!.getBoundingClientRect();
      const canvas = document.querySelector(".workspace-timeline-canvas")!.getBoundingClientRect();
      return box.top >= view.top && box.bottom <= view.bottom && box.bottom <= canvas.bottom + 1;
    }),
  ).toBe(true);
});

test("Time Context clamps a long course title to two lines without losing its full text", async ({
  page,
}) => {
  const title = "毛泽东思想和中国特色社会主义理论体系概论与当代社会专题研究";
  await seedDashboardRuntime(page, FIXED_NOW, title);
  const course = page.locator(".workspace-time-course").first();
  await expect(course).toHaveAttribute("title", title);
  const style = await course.evaluate((node) => {
    const css = getComputedStyle(node);
    return { clamp: css.webkitLineClamp, overflow: css.overflow };
  });
  expect(style).toEqual({ clamp: "2", overflow: "hidden" });
});

test("idle Time Context presents the free duration once and identifies the next course", async ({
  page,
}) => {
  await seedDashboardRuntime(page, new Date("2026-09-23T10:00:00"));
  const context = page.getByTestId("workspace-time-context");
  await expect(context).toContainText("当前空闲");
  await expect(context).toContainText("至 11:30");
  await expect(context).toContainText("下一项安排");
  await expect(context.getByText("1 小时 30 分钟", { exact: true })).toHaveCount(1);
});

test("reduced motion keeps Overview, Time Context and Settings available", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedDashboardRuntime(page);
  await expect(page.getByTestId("workspace-today-overview")).toBeVisible();
  await expect(page.getByTestId("workspace-time-context")).toBeVisible();
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
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

test("Diary, Inbox and schedule routes remain explicit, and returning to Workspace reloads Academic data", async ({
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
  await page.getByRole("button", { name: /收件箱，暂无待整理/u }).click();
  await expect(page.getByTestId("workspace-inbox")).toBeVisible();
  await page.locator(".workspace-inbox-breadcrumb").click();
  await expect(page.getByTestId("workspace-dashboard")).toBeVisible();
  await expect.poll(getLoads).toBeGreaterThan(previousLoads);
  previousLoads = await getLoads();

  for (const name of ["AI，尚未开放"]) {
    await page.getByRole("button", { name: new RegExp(name, "u") }).click();
    await expect(page.getByRole("heading", { name: "该模块尚未开放" })).toBeVisible();
    await page.getByRole("button", { name: "返回工作台" }).click();
    await expect(page.getByTestId("workspace-dashboard")).toBeVisible();
    await expect.poll(getLoads).toBeGreaterThan(previousLoads);
    previousLoads = await getLoads();
  }

  await page.getByRole("button", { name: /查看完整日程/u }).click();
  await expect(page.getByTestId("workspace-schedule")).toBeVisible();
  await expect(page.getByRole("heading", { name: "日程", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "完整日程时间轴" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "产品模式" })
    .getByRole("button", { name: "工作台" })
    .click();
  await expect(page.getByTestId("workspace-dashboard")).toBeVisible();

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
    await expect(page.getByRole("button", { name: /日记，今天还没有记录/u })).toBeVisible();
    await expect(page.getByRole("button", { name: /收件箱，暂无待整理/u })).toBeVisible();
    await expect(page.getByRole("button", { name: /AI，尚未开放/u })).toBeVisible();
  };
  await visibleModules();

  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "外观" })
    .click();
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
  await expect(page.getByTestId("workspace-time-context")).toContainText("今天暂无安排");
  await expect(timeline.getByText("00:00")).toBeVisible();
  await expect(timeline.getByText("24:00")).toBeVisible();
  await expect(page.getByText("暂无未完成任务")).toBeVisible();
  await expect(page.getByText("尚未开放").first()).toBeVisible();
  await expect(page.getByText(/^0$/u)).toHaveCount(0);
});

test("Dashboard combines course, planner event and task block while keeping personal deadlines off the timeline", async ({
  page,
}) => {
  await seedDashboardRuntime(page, FIXED_NOW, "数学基础", {
    events: [
      {
        id: "dashboard-event",
        title: "项目讨论",
        description: null,
        date: "2026-09-23",
        startTime: "14:00",
        endTime: "14:45",
        location: "会议室",
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        createdAt: "",
        updatedAt: "",
      },
    ],
    timeBlocks: [
      {
        id: "dashboard-block",
        personalTaskId: "dashboard-personal-task",
        date: "2026-09-23",
        startTime: "15:00",
        endTime: "16:00",
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        createdAt: "",
        updatedAt: "",
      },
    ],
    personalTasks: [
      {
        id: "dashboard-personal-task",
        title: "完成实验报告",
        description: null,
        status: "open",
        priority: "high",
        deadlineDate: "2026-09-23",
        deadlineTime: "18:00",
        createdAt: "",
        updatedAt: "",
        completedAt: null,
      },
      {
        id: "deadline-only-task",
        title: "只设置截止日期",
        description: null,
        status: "open",
        priority: "medium",
        deadlineDate: "2026-09-23",
        deadlineTime: "16:30",
        createdAt: "",
        updatedAt: "",
        completedAt: null,
      },
    ],
  });

  const timeline = page.getByRole("region", { name: "今日日程时间轴" });
  await expect(timeline.getByTestId("timeline-item")).toHaveCount(3);
  await expect(timeline.getByTestId("timeline-item").nth(1)).toHaveAttribute(
    "data-source-type",
    "plannerEvent",
  );
  await expect(timeline).toContainText("项目讨论");
  await expect(timeline).toContainText("完成实验报告");
  await expect(page.getByTestId("workspace-today-overview")).toContainText("3 项安排");
  await expect(page.getByTestId("workspace-today-overview")).toContainText("6 个待办");
  await expect(page.locator(".workspace-task-list")).toContainText("个人");
  await expect(timeline).not.toContainText("只设置截止日期");
  await expect(timeline.getByTestId("timeline-item").nth(2)).toContainText("15:00–16:00");

  await page.getByRole("button", { name: "查看全部", exact: true }).click();
  await expect(page.getByTestId("workspace-tasks")).toBeVisible();
  await expect(page.getByText("完成实验报告", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新建任务" }).click();
  const editor = page.getByRole("dialog", { name: "新建个人任务" });
  await editor.getByLabel("标题").fill("整理项目资料");
  await editor.getByLabel("截止日期").fill("2026-09-23");
  await editor.getByLabel("截止时间").fill("14:00");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("整理项目资料", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "产品模式" })
    .getByRole("button", { name: "工作台" })
    .click();
  await expect(page.getByTestId("workspace-today-overview")).toContainText("7 个待办");
  await expect(page.locator(".workspace-task-list")).toContainText("整理项目资料");
});
