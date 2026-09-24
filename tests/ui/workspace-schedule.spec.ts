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
        deadlineDate: "2026-09-25",
        deadlineTime: "18:30",
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
    const mutations: Array<{ command: string; id?: string; startTime?: string; endTime?: string }> =
      [];
    let failNextEventUpdate = false;
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
            mutations.push({
              command,
              startTime: args?.event?.startTime,
              endTime: args?.event?.endTime,
            });
            events.push(args?.event);
            return args?.event;
          }
          if (command === "update_planner_event") {
            mutations.push({
              command,
              id: args?.event?.id,
              startTime: args?.event?.startTime,
              endTime: args?.event?.endTime,
            });
            if (failNextEventUpdate) {
              failNextEventUpdate = false;
              throw new Error("模拟保存失败");
            }
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
            mutations.push({
              command,
              id: args?.block?.id,
              startTime: args?.block?.startTime,
              endTime: args?.block?.endTime,
            });
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
          if (command === "has_diary_entry") return false;
          if (command === "plugin:updater|check") return null;
          throw new Error(`未预期的工作台日程测试命令：${command}`);
        },
      },
    });
    Object.assign(window, {
      __workspaceScheduleTest: {
        eventLoads,
        blockLoads,
        mutations,
        tasks,
        failNextUpdate: () => {
          failNextEventUpdate = true;
        },
      },
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
  // Dashboard reads the upcoming range before navigating; isolate Schedule's date-specific reads.
  await page.evaluate(() => {
    const runtime = window as Window & {
      __workspaceScheduleTest: {
        eventLoads: unknown[];
        blockLoads: unknown[];
      };
    };
    runtime.__workspaceScheduleTest.eventLoads.length = 0;
    runtime.__workspaceScheduleTest.blockLoads.length = 0;
  });
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

async function dragBy(page: Page, locator: ReturnType<Page["locator"]>, deltaY: number) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Timeline item is not visible.");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + deltaY, { steps: 5 });
  await page.mouse.up();
}

test("PlannerEvent and TimeBlock support five-minute drag/resize while Course stays read-only", async ({
  page,
}) => {
  await seedScheduleRuntime(page);
  const event = page.getByRole("button", { name: /项目讨论/u });
  await dragBy(page, event, 30);
  await expect(page.getByRole("button", { name: /11:30 至 12:30/u })).toBeVisible();

  const resizedEvent = page.getByRole("button", { name: /11:30 至 12:30/u });
  await dragBy(page, resizedEvent.locator('[data-resize-edge="end"]'), 20);
  await expect(page.getByRole("button", { name: /11:30 至 12:50/u })).toBeVisible();

  const block = page.getByRole("button", { name: /阅读论文/u });
  await dragBy(page, block, -10);
  await expect(page.getByRole("button", { name: /13:50 至 14:50/u })).toBeVisible();

  const resizedBlock = page.getByRole("button", { name: /13:50 至 14:50/u });
  await dragBy(page, resizedBlock.locator('[data-resize-edge="start"]'), 5);
  await expect(page.getByRole("button", { name: /13:55 至 14:50/u })).toBeVisible();

  const course = page.getByTestId("workspace-schedule-item").filter({ hasText: "数据结构" });
  await dragBy(page, course, 30);
  await expect(course).toContainText("09:00–10:00");
  const mutations = await page.evaluate(() => {
    const runtime = window as Window & {
      __workspaceScheduleTest: {
        mutations: Array<{ command: string; startTime?: string; endTime?: string }>;
        tasks: Array<{ deadlineDate: string | null; deadlineTime: string | null }>;
      };
    };
    return {
      mutations: runtime.__workspaceScheduleTest.mutations,
      deadline: [
        runtime.__workspaceScheduleTest.tasks[0]?.deadlineDate,
        runtime.__workspaceScheduleTest.tasks[0]?.deadlineTime,
      ],
    };
  });
  expect(mutations.mutations).toEqual([
    {
      command: "update_planner_event",
      id: "planner-event-1",
      startTime: "11:30",
      endTime: "12:30",
    },
    {
      command: "update_planner_event",
      id: "planner-event-1",
      startTime: "11:30",
      endTime: "12:50",
    },
    { command: "update_time_block", id: "time-block-1", startTime: "13:50", endTime: "14:50" },
    { command: "update_time_block", id: "time-block-1", startTime: "13:55", endTime: "14:50" },
  ]);
  expect(mutations.deadline).toEqual(["2026-09-25", "18:30"]);
});

test("conflicting drag can be cancelled or explicitly saved, and failed saves revert visual time", async ({
  page,
}) => {
  await seedScheduleRuntime(page);
  const event = page.getByRole("button", { name: /项目讨论/u });
  await dragBy(page, event, -90);
  const conflict = page.getByRole("alertdialog", { name: "发现时间冲突" });
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText("数据结构");
  await expect(conflict.getByRole("button", { name: "返回调整" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(conflict).toHaveCount(0);
  await expect(page.getByRole("button", { name: /11:00 至 12:00/u })).toBeVisible();

  await dragBy(page, page.getByRole("button", { name: /项目讨论/u }), -90);
  await page
    .getByRole("alertdialog", { name: "发现时间冲突" })
    .getByRole("button", { name: "仍然保存" })
    .click();
  await expect(page.getByRole("button", { name: /09:30 至 10:30/u })).toBeVisible();

  await page.evaluate(() => {
    const runtime = window as Window & {
      __workspaceScheduleTest: { failNextUpdate: () => void };
    };
    runtime.__workspaceScheduleTest.failNextUpdate();
  });
  await dragBy(page, page.getByRole("button", { name: /09:30 至 10:30/u }), 45);
  await expect(page.getByRole("alert")).toContainText("保存个人日程失败");
  await expect(page.getByRole("button", { name: /09:30 至 10:30/u })).toBeVisible();
});

test("keyboard editing remains available and manual Event save previews conflicts", async ({
  page,
}) => {
  await seedScheduleRuntime(page);
  const event = page.getByRole("button", { name: /项目讨论/u });
  await event.focus();
  await event.press("Enter");
  const editor = page.getByRole("dialog", { name: "编辑日程" });
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "取消" }).click();

  await page.getByRole("button", { name: "+ 添加日程" }).click();
  const create = page.getByRole("dialog", { name: "添加日程" });
  await create.getByLabel("标题").fill("人工安排");
  await create.getByLabel("开始时间").fill("09:30");
  await create.getByLabel("结束时间").fill("10:30");
  await create.getByRole("button", { name: "保存", exact: true }).click();
  const conflict = page.getByRole("alertdialog", { name: "发现时间冲突" });
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText("数据结构");
  await conflict.getByRole("button", { name: "返回调整" }).click();
  await expect(create.getByRole("button", { name: "保存", exact: true })).toBeFocused();
  await create.getByLabel("开始时间").fill("10:05");
  await create.getByLabel("结束时间").fill("10:30");
  await expect(create.getByLabel("结束时间")).toHaveValue("10:30");
  await create.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: /人工安排/u })).toBeVisible();
});

test("end-of-day 24:00 is a valid planner end boundary", async ({ page }) => {
  await seedScheduleRuntime(page);
  await page.getByRole("button", { name: "+ 添加日程" }).click();
  const editor = page.getByRole("dialog", { name: "添加日程" });
  await editor.getByLabel("标题").fill("晚间安排");
  await editor.getByLabel("开始时间").fill("23:55");
  await editor.getByLabel("结束时间").fill("24:00");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: /23:55 至 24:00/u })).toBeVisible();
});
