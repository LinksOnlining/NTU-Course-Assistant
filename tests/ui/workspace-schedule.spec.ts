import { expect, test, type Page } from "@playwright/test";

const date = "2026-09-23";

async function seedScheduleRuntime(page: Page) {
  await page.clock.install({ time: new Date("2026-09-23T12:00:00") });
  await page.addInitScript((today) => {
    const semester = {
      id: "schedule-semester",
      name: "测试学期",
      firstWeekMonday: "2026-09-21",
      totalWeeks: 16,
      timezone: "Asia/Shanghai",
      status: "ACTIVE",
      createdAt: "",
      updatedAt: "",
    };
    const course = {
      id: "schedule-course",
      name: "数据结构",
      teacher: "教师甲",
      classroom: "A101",
      weekday: 3,
      startPeriod: null,
      endPeriod: null,
      weeks: [1],
      startTime: "09:00",
      endTime: "10:00",
    };
    const tasks = [
      {
        id: "personal-task-1",
        title: "阅读论文",
        description: null,
        status: "open",
        priority: "medium",
        deadlineDate: null,
        deadlineTime: null,
        createdAt: "",
        updatedAt: "",
        completedAt: null,
      },
    ];
    const events: Array<Record<string, any>> = [
      {
        id: "planner-event-1",
        title: "项目讨论",
        description: "检查进度",
        date: today,
        startTime: "11:00",
        endTime: "12:00",
        location: "线上",
        bufferBeforeMinutes: 10,
        bufferAfterMinutes: 15,
        createdAt: "",
        updatedAt: "",
      },
    ];
    const blocks: Array<Record<string, any>> = [
      {
        id: "time-block-1",
        personalTaskId: "personal-task-1",
        date: today,
        startTime: "14:00",
        endTime: "15:00",
        bufferBeforeMinutes: 20,
        bufferAfterMinutes: 30,
        createdAt: "",
        updatedAt: "",
      },
    ];
    const eventLoads: Array<{ startDate: string; endDate: string }> = [];
    const blockLoads: Array<{ startDate: string; endDate: string }> = [];
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string, args?: Record<string, any>) => {
          if (command === "load_courses") return { courses: [course], warnings: [] };
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
          if (command === "load_semesters") return [semester];
          if (command === "load_course_overrides" || command === "load_exams") return [];
          if (command === "load_academic_tasks") return [];
          if (command === "load_personal_tasks") return [...tasks];
          if (command === "load_planner_events") {
            eventLoads.push({ startDate: args?.startDate, endDate: args?.endDate });
            return events.filter(
              (event) => event.date >= args?.startDate && event.date <= args?.endDate,
            );
          }
          if (command === "load_time_blocks") {
            blockLoads.push({ startDate: args?.startDate, endDate: args?.endDate });
            return blocks.filter(
              (block) => block.date >= args?.startDate && block.date <= args?.endDate,
            );
          }
          if (command === "create_planner_event") {
            events.push(args?.event);
            return args?.event;
          }
          if (command === "update_planner_event") {
            const index = events.findIndex((event) => event.id === args?.event?.id);
            if (index < 0) throw new Error("个人日程不存在。");
            events[index] = args?.event;
            return args?.event;
          }
          if (command === "delete_planner_event") {
            const index = events.findIndex((event) => event.id === args?.id);
            if (index < 0) throw new Error("个人日程不存在。");
            events.splice(index, 1);
            return;
          }
          if (command === "create_time_block") {
            blocks.push(args?.block);
            return args?.block;
          }
          if (command === "update_time_block") {
            const index = blocks.findIndex((block) => block.id === args?.block?.id);
            if (index < 0) throw new Error("时间块不存在。");
            blocks[index] = args?.block;
            return args?.block;
          }
          if (command === "delete_time_block") {
            const index = blocks.findIndex((block) => block.id === args?.id);
            if (index < 0) throw new Error("时间块不存在。");
            blocks.splice(index, 1);
            return;
          }
          if (command === "load_handled_reminder_keys") return [];
          if (
            command === "refresh_reminder_schedule" ||
            command === "trace_runtime_event" ||
            command === "plugin:event|unlisten"
          ) {
            return;
          }
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:updater|check") return null;
          throw new Error(`未预期的工作台日程测试命令：${command}`);
        },
      },
    });
    Object.assign(window, {
      __workspaceScheduleTest: { eventLoads, blockLoads },
    });
  }, date);
  await page.goto("/");
  await expect(page.getByTestId("workspace-dashboard")).toBeVisible();
  await page.getByRole("button", { name: /查看完整日程/u }).click();
  await expect(page.getByTestId("workspace-schedule")).toBeVisible();
}

test("Workspace Schedule navigates one day at a time and loads only the selected planner date", async ({
  page,
}) => {
  await seedScheduleRuntime(page);
  const dateElement = page.getByTestId("workspace-schedule-date");
  await expect(dateElement).toHaveAttribute("datetime", date);
  await page.getByRole("button", { name: "上一天" }).click();
  await expect(dateElement).toHaveAttribute("datetime", "2026-09-22");
  await expect(page.getByText("这一天暂无安排")).toBeVisible();
  await page.getByRole("button", { name: "下一天" }).click();
  await expect(dateElement).toHaveAttribute("datetime", date);
  await page.getByRole("button", { name: "下一天" }).click();
  await expect(dateElement).toHaveAttribute("datetime", "2026-09-24");
  await page.getByRole("button", { name: "回到今天" }).click();
  await expect(dateElement).toHaveAttribute("datetime", date);
  const reads = await page.evaluate(() => {
    const runtime = window as Window & {
      __workspaceScheduleTest: {
        eventLoads: Array<{ startDate: string; endDate: string }>;
        blockLoads: Array<{ startDate: string; endDate: string }>;
      };
    };
    return runtime.__workspaceScheduleTest;
  });
  expect(reads.eventLoads.length).toBeGreaterThanOrEqual(4);
  expect(reads.blockLoads.length).toBe(reads.eventLoads.length);
  expect(reads.eventLoads.every((range) => range.startDate === range.endDate)).toBe(true);
  expect(reads.eventLoads.map((range) => range.startDate)).toContain("2026-09-22");
  expect(reads.eventLoads.map((range) => range.startDate)).toContain("2026-09-24");
});

test("Unified day timeline shows read-only Course and editable Event/TimeBlock with CRUD", async ({
  page,
}) => {
  await seedScheduleRuntime(page);
  const items = page.getByTestId("workspace-schedule-item");
  await expect(items).toHaveCount(3);
  const course = items.filter({ hasText: "数据结构" });
  await expect(course).toHaveAttribute("data-source-type", "academicOccurrence");
  await expect(course).toHaveAttribute("data-editable", "false");
  await expect(course).toHaveAttribute("title", /A101/u);
  await expect(items.filter({ hasText: "项目讨论" })).toHaveAttribute("data-editable", "true");
  await expect(items.filter({ hasText: "阅读论文" })).toHaveAttribute("data-editable", "true");

  await page.getByRole("button", { name: /项目讨论/u }).click();
  const eventEditor = page.getByRole("dialog", { name: "编辑日程" });
  await expect(eventEditor).toBeVisible();
  await eventEditor.getByLabel("标题").fill("修改后的项目讨论");
  await eventEditor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: /修改后的项目讨论/u })).toBeVisible();

  await page.getByRole("button", { name: /阅读论文/u }).click();
  const blockEditor = page.getByRole("dialog", { name: "编辑任务时间" });
  await expect(blockEditor.getByLabel("关联任务")).toHaveValue("personal-task-1");
  await expect(blockEditor.getByText("时间块没有独立标题，会使用所关联任务的名称。")).toBeVisible();
  await blockEditor.getByRole("button", { name: "取消" }).click();

  await page.getByRole("button", { name: "+ 添加日程" }).click();
  const newEditor = page.getByRole("dialog", { name: "添加日程" });
  await newEditor.getByLabel("标题").fill("阅读课程计划");
  await newEditor.getByLabel("开始时间").fill("16:00");
  await newEditor.getByLabel("结束时间").fill("17:00");
  await newEditor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: /阅读课程计划/u })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: /修改后的项目讨论/u }).click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("button", { name: /修改后的项目讨论/u })).toHaveCount(0);
});

test("Workspace Schedule renders empty days in light/dark themes and target viewports", async ({
  page,
}) => {
  await seedScheduleRuntime(page);
  await page.getByRole("button", { name: "上一天" }).click();
  await expect(page.getByText("这一天暂无安排")).toBeVisible();
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(page.getByRole("region", { name: "完整日程时间轴" })).toBeVisible();

  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "外观" })
    .click();
  await settings.getByLabel("主题").selectOption("dark");
  await settings.getByRole("button", { name: "取消" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.setViewportSize({ width: 720, height: 520 });
  await expect(page.getByTestId("workspace-schedule")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ 添加日程" })).toBeVisible();
  await expect(page.getByRole("region", { name: "完整日程时间轴" })).toBeVisible();
});
