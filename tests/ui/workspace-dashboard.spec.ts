import { expect, test, type Page } from "@playwright/test";
import { gcj02ToWgs84, wgs84ToGcj02 } from "../../src/core/weather-coordinate.ts";

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
  routineFixture: readonly Record<string, unknown>[] = [],
) {
  await page.clock.install({ time: currentTime });
  await page.addInitScript(
    ({ name, plannerFixture, diaryFixture, inboxFixture, routineFixture }) => {
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
      let dashboardEvents = [...(plannerFixture.events ?? [])] as Record<string, any>[];
      let routines = [...routineFixture] as Record<string, any>[];
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
      let failGeocodingSearch = false;
      let failReverseGeocoding = false;
      let amapCredentialConfigured = true;
      let loadCoursesCount = 0;
      let searchDiaryReadCount = 0;
      const geocodingCalls: { command: string; args?: Record<string, unknown> }[] = [];
      const obsidianActions: string[] = [];
      let failObsidianLaunch = false;
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        value: {
          invoke: async (command: string, args?: Record<string, unknown>) => {
            if (command === "get_deepseek_api_key_status") {
              return { status: "success", value: false };
            }
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
            if (command === "get_weather_credential_status") {
              return { amapConfigured: amapCredentialConfigured, baiduConfigured: true };
            }
            if (
              command === "set_weather_provider_key" ||
              command === "delete_weather_provider_key"
            ) {
              return true;
            }
            if (command === "cancel_weather_location_search") return null;
            if (command === "get_weather_map_image") {
              return {
                mimeType: "image/png",
                bytes: [
                  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0,
                  1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 29, 99, 248,
                  207, 192, 0, 0, 3, 1, 1, 0, 201, 254, 146, 239, 0, 0, 0, 0, 73, 69, 78, 68, 174,
                  66, 96, 130,
                ],
              };
            }
            if (command === "search_weather_location") {
              geocodingCalls.push({ command, args });
              if (failGeocodingSearch) throw new Error("geocodingUnavailable");
              if (args?.query === "南通大学") {
                return [
                  {
                    displayName: "南通大学",
                    displayAddress: "江苏省 · 南通市 · 崇川区",
                    latitude: 31.934,
                    longitude: 120.874,
                    coordinateSystem: "gcj02",
                    timezone: null,
                    admin1: "江苏省",
                    admin2: "南通市",
                    admin3: "崇川区",
                    provider: "amap",
                    providerId: "AMAP-4",
                    type: "学校",
                    precision: "other",
                    source: "manual",
                  },
                ];
              }
              if (args?.query === "李家村") {
                return [
                  {
                    displayName: "李家村",
                    latitude: 34.7,
                    longitude: 116.2,
                    coordinateSystem: "gcj02",
                    timezone: null,
                    provider: "amap",
                    providerId: "AMAP-V1",
                    type: "村庄",
                    precision: "locality",
                    source: "manual",
                    displayAddress: "江苏省 · 徐州市 · 丰县 · 邢楼镇",
                    admin1: "江苏省",
                    admin2: "徐州市",
                    admin3: "丰县",
                    admin4: "邢楼镇",
                  },
                  {
                    displayName: "李家村",
                    displayAddress: "安徽省 · 淮北市 · 濉溪县 · 临涣镇",
                    latitude: 33.5,
                    longitude: 116.6,
                    coordinateSystem: "gcj02",
                    timezone: null,
                    admin1: "安徽省",
                    admin2: "淮北市",
                    admin3: "濉溪县",
                    admin4: "临涣镇",
                    provider: "baidu",
                    providerId: "BD-V2",
                    type: "村庄",
                    precision: "locality",
                    source: "manual",
                  },
                ];
              }
              if (args?.query === "江苏省南通市崇川区青年中路88号") {
                return [
                  {
                    displayName: "青年中路",
                    displayAddress: "江苏省 · 南通市 · 崇川区 · 青年中路",
                    latitude: 31.982,
                    longitude: 120.8626,
                    coordinateSystem: "gcj02",
                    timezone: null,
                    admin1: "江苏省",
                    admin2: "南通市",
                    admin3: "崇川区",
                    street: "青年中路",
                    provider: "amap",
                    providerId: "AMAP-ADDR",
                    type: "地址",
                    precision: "street",
                    source: "manual",
                  },
                ];
              }
              if (args?.query === "青年中路") {
                return [
                  {
                    displayName: "青年中路",
                    displayAddress: "江苏省 · 南通市 · 崇川区 · 文峰街道",
                    latitude: 31.982,
                    longitude: 120.8626,
                    coordinateSystem: "gcj02",
                    timezone: null,
                    admin1: "江苏省",
                    admin2: "南通市",
                    admin3: "崇川区",
                    admin4: "文峰街道",
                    street: "青年中路",
                    provider: "amap",
                    providerId: "AMAP-3",
                    type: "道路",
                    precision: "street",
                    source: "manual",
                  },
                ];
              }
              if (args?.query === "无结果地点") return [];
              return [
                {
                  displayName: "南通市",
                  displayAddress: "江苏省 · 南通市",
                  latitude: 32.1,
                  longitude: 121.1,
                  coordinateSystem: "gcj02",
                  timezone: null,
                  admin1: "江苏省",
                  admin2: "南通市",
                  provider: "amap",
                  providerId: "AMAP-1",
                  type: "城市",
                  precision: "city",
                  source: "manual",
                },
                {
                  displayName: "崇川区",
                  displayAddress: "江苏省 · 南通市 · 崇川区",
                  latitude: 31.98123,
                  longitude: 120.86234,
                  coordinateSystem: "gcj02",
                  timezone: null,
                  admin1: "江苏省",
                  admin2: "南通市",
                  admin3: "崇川区",
                  provider: "amap",
                  providerId: "AMAP-2",
                  type: "行政区",
                  precision: "district",
                  source: "manual",
                },
              ];
            }
            if (command === "reverse_geocode_weather_location") {
              geocodingCalls.push({ command, args });
              if (failReverseGeocoding) throw new Error("reverseGeocodingUnavailable");
              return {
                displayName: "观音山街道",
                displayAddress: "江苏省 · 南通市 · 崇川区 · 观音山街道",
                latitude: args?.latitude,
                longitude: args?.longitude,
                coordinateSystem: "gcj02",
                timezone: null,
                country: "中国",
                admin1: "江苏省",
                admin2: "南通市",
                admin3: "崇川区",
                admin4: "观音山街道",
                provider: "amap",
                type: "街镇",
                precision: "locality",
                source: "manual",
              };
            }
            if (command === "load_semesters") return [activeSemester];
            if (command === "load_course_overrides" || command === "load_exams") return [];
            if (command === "load_academic_tasks") return tasks;
            if (command === "load_personal_tasks") return [...personalTasks];
            if (command === "create_personal_task" && args?.task) {
              const task = args.task as Record<string, unknown>;
              personalTasks = [...personalTasks, task];
              return task;
            }
            if (command === "get_obsidian_vault") return "First";
            if (command === "open_obsidian") {
              if (failObsidianLaunch) throw new Error("Obsidian 启动失败");
              obsidianActions.push(String(args?.action));
              return null;
            }
            if (command === "load_diary_entry") return diaryEntries.get(String(args?.date)) ?? null;
            if (command === "load_diary_entries_for_search") {
              searchDiaryReadCount += 1;
              return [...diaryEntries.values()].filter((entry) => entry.body.trim());
            }
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
            if (command === "load_planner_events") {
              return dashboardEvents.filter(
                (event) => event.date >= args?.startDate && event.date <= args?.endDate,
              );
            }
            if (command === "load_all_planner_events_for_search") return [...dashboardEvents];
            if (command === "create_planner_event") {
              dashboardEvents.push(args?.event as Record<string, any>);
              return args?.event;
            }
            if (command === "load_routines") return routines.map((routine) => ({ ...routine }));
            if (command === "create_routine") {
              const routine = args?.routine as Record<string, any>;
              routines = [...routines, routine];
              return routine;
            }
            if (command === "update_routine") {
              const routine = args?.routine as Record<string, any>;
              routines = routines.map((item) => (item.id === routine.id ? routine : item));
              return routine;
            }
            if (command === "delete_routine") {
              routines = routines.filter((item) => item.id !== args?.id);
              return;
            }
            if (command === "confirm_routine_suggestion") {
              const event = args?.event as Record<string, any>;
              dashboardEvents = [...dashboardEvents, event];
              routines = routines.map((item) =>
                item.id === args?.routineId
                  ? { ...item, lastScheduledDate: args?.targetDate }
                  : item,
              );
              return event;
            }
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
          getGeocodingCalls: () => geocodingCalls,
          getSearchDiaryReadCount: () => searchDiaryReadCount,
          getObsidianActions: () => [...obsidianActions],
          setObsidianLaunchFailure: (value: boolean) => {
            failObsidianLaunch = value;
          },
          getPersonalTaskCount: () => personalTasks.length,
          getDiaryBody: (date: string) => diaryEntries.get(date)?.body ?? null,
          getRoutineScheduledDate: (id: string) =>
            routines.find((item) => item.id === id)?.lastScheduledDate ?? null,
          getEventCount: () => dashboardEvents.length,
          setDiarySaveFailure: (value: boolean) => {
            failDiarySave = value;
          },
          setGeocodingSearchFailure: (value: boolean) => {
            failGeocodingSearch = value;
          },
          setReverseGeocodingFailure: (value: boolean) => {
            failReverseGeocoding = value;
          },
          setAmapCredentialConfigured: (value: boolean) => {
            amapCredentialConfigured = value;
          },
        },
      });
    },
    { name: courseName, plannerFixture, diaryFixture, inboxFixture, routineFixture },
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
  await expect(taskItem.getByRole("region", { name: "原始内容" })).toContainText(
    "任务：整理材料 截止明天 18:00",
  );
  expect(
    await taskItem
      .locator(".workspace-inbox-raw")
      .evaluate((element) => getComputedStyle(element).userSelect),
  ).toBe("text");
  await expect(taskItem).toContainText("整理预览");
  await expect(taskItem).toContainText("尚未创建任务或日程，确认后才会保存。");
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
  await eventItem.getByRole("textbox", { name: /日期年/u }).fill("2026");
  await eventItem.getByRole("textbox", { name: /日期月/u }).fill("09");
  await eventItem.getByRole("textbox", { name: /日期日/u }).fill("24");
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
  await expect(page.getByRole("button", { name: /Obsidian，打开现有知识库/u })).toBeVisible();
  await expect(page.getByRole("button", { name: /收件箱，暂无待整理/u })).toBeVisible();
  await expect(page.getByTestId("today-assistant-panel")).toBeVisible();
  await expect(page.getByTestId("daily-summary-panel")).toHaveCount(0);
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
      const overview = document.querySelector<HTMLElement>(".workspace-today-overview");
      const nowLine = document.querySelector<HTMLElement>(".workspace-current-time-line");
      const dashboard = document.querySelector<HTMLElement>(".workspace-dashboard");
      const rail = document.querySelector<HTMLElement>(".workspace-dashboard-rail");
      const context = document.querySelector<HTMLElement>(".workspace-time-context");
      const canvas = document.querySelector<HTMLElement>(".workspace-timeline-canvas");
      const item = document.querySelector<HTMLElement>(".workspace-timeline-item");
      if (
        !timelineElement ||
        !overview ||
        !nowLine ||
        !dashboard ||
        !rail ||
        !context ||
        !canvas ||
        !item
      )
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
        overviewToDashboardGap:
          dashboard.getBoundingClientRect().top - overview.getBoundingClientRect().bottom,
        alignedColumnTops:
          Math.max(
            item.closest(".workspace-timeline-card")!.getBoundingClientRect().top,
            context.getBoundingClientRect().top,
            rail.getBoundingClientRect().top,
          ) -
          Math.min(
            item.closest(".workspace-timeline-card")!.getBoundingClientRect().top,
            context.getBoundingClientRect().top,
            rail.getBoundingClientRect().top,
          ),
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
    expect(measurements?.overviewToDashboardGap).toBeGreaterThanOrEqual(9);
    expect(measurements?.alignedColumnTops).toBeLessThanOrEqual(1);
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
      await expect(page.getByRole("button", { name: /Obsidian，打开现有知识库/u })).toBeVisible();
      await expect(page.getByRole("button", { name: /收件箱，暂无待整理/u })).toBeVisible();
      const assistant = page.getByTestId("today-assistant-panel");
      await expect(assistant).toBeVisible();
      await assistant.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(page.getByTestId("today-assistant-instruction")).toBeVisible();
      await expect(page.getByTestId("today-assistant-send")).toBeVisible();
      await expect(page.getByRole("button", { name: "安排今天" })).toBeEnabled();
      const assistantSize = await assistant.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(assistantSize.scrollWidth).toBeLessThanOrEqual(assistantSize.clientWidth + 1);
    }
  }
});

test("Obsidian replaces the Diary card, launches only registered actions, and keeps legacy data untouched", async ({
  page,
}) => {
  await seedDashboardRuntime(page, FIXED_NOW, "数学基础", {}, { hasEntry: true });
  await page.evaluate(() =>
    Object.defineProperty(window, "isTauri", { value: true, configurable: true }),
  );
  const card = page.getByRole("button", { name: "Obsidian，打开现有知识库" });
  await expect(card).toBeVisible();
  await expect(page.getByText("private diary fixture body", { exact: true })).toHaveCount(0);
  await card.click();
  await expect(page.getByRole("heading", { name: "Obsidian" })).toBeVisible();
  await expect(page.getByText("First", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /日记正文/u })).toHaveCount(0);

  await page.getByRole("button", { name: "打开 Obsidian" }).click();
  await page.getByRole("button", { name: "打开每日笔记" }).click();
  await page.getByRole("button", { name: "查找 00 收集箱" }).click();
  const actions = await page.evaluate(() =>
    (
      window as unknown as {
        __workspaceDashboardTest: { getObsidianActions: () => string[] };
      }
    ).__workspaceDashboardTest.getObsidianActions(),
  );
  expect(actions).toEqual(["vault", "daily", "inbox"]);
  const preserved = await page.evaluate(() =>
    (
      window as unknown as {
        __workspaceDashboardTest: { getDiaryBody: (date: string) => string | null };
      }
    ).__workspaceDashboardTest.getDiaryBody("2026-09-23"),
  );
  expect(preserved).toBe("private diary fixture body");
  await page.locator(".workspace-obsidian-back").click();
  await expect(page.getByTestId("workspace-dashboard")).toBeVisible();
});

test("Obsidian launch failure shows error and never modifies old Diary contents", async ({
  page,
}) => {
  await seedDashboardRuntime(page, FIXED_NOW, "数学基础", {}, { hasEntry: true });
  await page.evaluate(() =>
    Object.defineProperty(window, "isTauri", { value: true, configurable: true }),
  );
  await page.getByRole("button", { name: "Obsidian，打开现有知识库" }).click();
  await page.evaluate(() =>
    (
      window as unknown as {
        __workspaceDashboardTest: { setObsidianLaunchFailure: (value: boolean) => void };
      }
    ).__workspaceDashboardTest.setObsidianLaunchFailure(true),
  );
  await page.getByRole("button", { name: "打开 Obsidian" }).click();
  await expect(page.getByRole("alert")).toContainText("Obsidian 启动失败");
  const preserved = await page.evaluate(() =>
    (
      window as unknown as {
        __workspaceDashboardTest: { getDiaryBody: (date: string) => string | null };
      }
    ).__workspaceDashboardTest.getDiaryBody("2026-09-23"),
  );
  expect(preserved).toBe("private diary fixture body");
});

test("Obsidian shortcut fits compact 720 by 520 windows", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await seedDashboardRuntime(page);
  await page.evaluate(() =>
    Object.defineProperty(window, "isTauri", { value: true, configurable: true }),
  );
  await page.getByRole("button", { name: "Obsidian，打开现有知识库" }).click();
  await expect(page.getByRole("heading", { name: "Obsidian" })).toBeVisible();
  await expect(page.getByRole("button", { name: "打开每日笔记" })).toBeVisible();
  const fit = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(fit).toBe(true);
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

test("Obsidian, Inbox and schedule routes remain explicit, and returning to Workspace reloads Academic data", async ({
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

  await expect(page.getByTestId("today-assistant-panel")).toBeVisible();
  await expect(page.getByRole("region", { name: "AI 助手" })).toBeVisible();
  await expect(page.getByTestId("workspace-dashboard")).toBeVisible();
  await expect.poll(getLoads).toBe(previousLoads);

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
  await expect(page.getByRole("heading", { name: "课表" })).toBeVisible();
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
    await expect(page.getByRole("button", { name: /Obsidian，打开现有知识库/u })).toBeVisible();
    await expect(page.getByRole("button", { name: /收件箱，暂无待整理/u })).toBeVisible();
    await expect(page.getByTestId("today-assistant-panel")).toBeVisible();
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
  await expect(page.getByTestId("today-assistant-panel")).toContainText("有需要时再问我");
  await expect(page.getByText(/^0$/u)).toHaveCount(0);
  await page.getByRole("button", { name: /今天暂无安排/u }).click();
  const details = page.getByRole("dialog", { name: "今日详情" });
  await expect(details).toContainText("今日安排（0 项）");
  await expect(details).toContainText("今天没有安排。");
  await expect(details).toContainText("今日待办（0 项）");
  await expect(details).toContainText("没有逾期或今天截止的未完成待办。");
});

test("每日简报默认不自动弹出，手动入口显示本地 fallback 且适配 720×520", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 520 });
  await seedDashboardRuntime(page);
  await expect(page.getByTestId("daily-brief-open")).toBeVisible();
  await expect(page.getByTestId("daily-brief-dialog")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("links-workplace.ai.daily-brief")))
    .toBeNull();

  await page.getByTestId("daily-brief-open").click();
  const dialog = page.getByTestId("daily-brief-dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: /今日晨报|今天还有这些事|今晚值得注意/u }),
  ).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "今日概览" })).toBeVisible();
  await expect(dialog.getByText(/本机.*整理/u)).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(720);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(520);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("daily-brief-open")).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("links-workplace.ai.daily-brief")))
    .toBeNull();
});

test("每日显著简报只自动展示一次；手动再次打开不改变展示日期", async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("links-workplace.ai.daily-brief")) {
      localStorage.setItem(
        "links-workplace.ai.daily-brief",
        JSON.stringify({ enabled: true, lastAutoShownDate: null }),
      );
    }
  });
  await seedDashboardRuntime(page);
  const dialog = page.getByTestId("daily-brief-dialog");
  await expect(dialog).toBeVisible();
  const initial = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("links-workplace.ai.daily-brief") ?? "{}"),
  );
  expect(initial.lastAutoShownDate).toBe("2026-09-23");
  await dialog.getByRole("button", { name: "关闭今日简报" }).click();

  await page.reload();
  await expect(page.getByTestId("workspace-dashboard")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.getByTestId("daily-brief-open").click();
  await expect(dialog).toBeVisible();
  const afterManualOpen = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("links-workplace.ai.daily-brief") ?? "{}"),
  );
  expect(afterManualOpen.lastAutoShownDate).toBe("2026-09-23");
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
      {
        id: "tomorrow-task",
        title: "明日事项",
        description: null,
        status: "open",
        priority: "medium",
        deadlineDate: "2026-09-24",
        deadlineTime: "10:00",
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
  await expect(page.getByTestId("workspace-today-overview")).toContainText("5 个待办");
  await expect(page.locator(".workspace-task-list")).toContainText("个人");
  await expect(timeline).not.toContainText("只设置截止日期");
  await expect(timeline.getByTestId("timeline-item").nth(2)).toContainText("15:00–16:00");

  const overview = page.getByTestId("workspace-today-overview");
  const summaryTrigger = overview.locator(".workspace-today-overview-trigger");
  const overviewBoundsBefore = await summaryTrigger.boundingBox();
  await summaryTrigger.focus();
  await summaryTrigger.press("Enter");
  const todayDetails = page.getByRole("dialog", { name: "今日详情" });
  await expect(todayDetails).toBeVisible();
  await expect(todayDetails).toContainText("今日安排（3 项）");
  await expect(todayDetails).toContainText("今日待办（5 项）");
  await expect(todayDetails).toContainText("数学基础");
  await expect(todayDetails).toContainText("项目讨论");
  await expect(todayDetails).toContainText("完成实验报告");
  await expect(todayDetails).toContainText("逾期事项");
  await expect(todayDetails).toContainText("今天事项");
  await expect(todayDetails).toContainText("未来事项");
  await expect(todayDetails).not.toContainText("明日事项");
  await expect(todayDetails).not.toContainText("无截止事项");
  const arrangementRows = todayDetails.locator('[aria-label="今日安排列表"] > li');
  await expect(arrangementRows).toHaveCount(3);
  await expect(arrangementRows.nth(0)).toContainText("数学基础");
  await expect(arrangementRows.nth(1)).toContainText("项目讨论");
  await expect(arrangementRows.nth(2)).toContainText("完成实验报告");
  expect(await summaryTrigger.boundingBox()).toEqual(overviewBoundsBefore);
  await todayDetails.press("Escape");
  await expect(todayDetails).toHaveCount(0);
  await expect(summaryTrigger).toBeFocused();
  await summaryTrigger.press("Space");
  await expect(todayDetails).toBeVisible();
  await page.locator(".shell-brand h1").click();
  await expect(todayDetails).toHaveCount(0);

  await page.getByRole("button", { name: "查看全部", exact: true }).click();
  await expect(page.getByTestId("workspace-tasks")).toBeVisible();
  await expect(page.getByText("完成实验报告", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新建任务" }).click();
  const editor = page.getByRole("dialog", { name: "新建个人任务" });
  await editor.getByLabel("标题").fill("整理项目资料");
  await editor.getByRole("textbox", { name: "截止日期年" }).fill("2026");
  await editor.getByRole("textbox", { name: "截止日期月" }).fill("09");
  await editor.getByRole("textbox", { name: "截止日期日" }).fill("23");
  await editor.getByLabel("截止时间").fill("14:00");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("整理项目资料", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "产品模式" })
    .getByRole("button", { name: "工作台" })
    .click();
  await expect(page.getByTestId("workspace-today-overview")).toContainText("6 个待办");
  await expect(page.locator(".workspace-task-list")).toContainText("整理项目资料");
});

test("Weather stays offline until explicit location search and uses converted selected coordinates", async ({
  page,
}) => {
  const requests: string[] = [];
  let failForecast = false;
  page.on("request", (request) => {
    if (request.url().includes("open-meteo.com")) requests.push(request.url());
  });
  await page.route("https://api.open-meteo.com/**", async (route) => {
    if (failForecast) {
      await route.abort();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        timezone: "Asia/Shanghai",
        current: {
          time: "2026-09-23T20:00",
          temperature_2m: 22,
          apparent_temperature: 21,
          weather_code: 2,
          is_day: 1,
          relative_humidity_2m: 65,
        },
        hourly: {
          time: Array.from(
            { length: 8 },
            (_, index) => `2026-09-23T${String(20 + index).padStart(2, "0")}:00`,
          ),
          temperature_2m: Array.from({ length: 8 }, (_, index) => 22 + index),
          weather_code: Array(8).fill(2),
          precipitation_probability: Array(8).fill(10),
        },
        daily: {
          time: Array.from(
            { length: 7 },
            (_, index) => `2026-09-${String(23 + index).padStart(2, "0")}`,
          ),
          temperature_2m_max: Array(7).fill(27),
          temperature_2m_min: Array(7).fill(19),
          weather_code: Array(7).fill(2),
          precipitation_probability_max: Array(7).fill(10),
        },
      }),
    });
  });
  await seedDashboardRuntime(page);
  expect(requests).toEqual([]);

  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "天气" })
    .click();
  await expect(settings.getByTestId("weather-settings").getByLabel("启用天气")).not.toBeChecked();
  await settings.getByLabel("启用天气").check();
  await settings.getByLabel("搜索地点").fill("崇川区");
  expect(requests).toEqual([]);
  await settings.getByRole("button", { name: "搜索地点" }).click();
  const districtResult = settings.getByRole("button", { name: /崇川区.*江苏省.*南通市/u });
  await expect(districtResult).toBeVisible();
  await districtResult.click();
  await settings.getByLabel("温度单位").selectOption("fahrenheit");
  await settings.getByLabel("搜索地点").fill("青年中路");
  await settings.getByRole("button", { name: "搜索地点" }).click();
  const streetResult = settings.getByRole("button", { name: /青年中路.*江苏省.*文峰街道/u });
  await expect(streetResult).toBeVisible();
  await streetResult.click();
  await settings.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("button", { name: /天气：青年中路，72°F/u })).toBeVisible();
  expect(requests.some((url) => url.includes("api.open-meteo.com/v1/forecast"))).toBe(true);
  const geocodingCalls = await page.evaluate(() =>
    (window as any).__workspaceDashboardTest.getGeocodingCalls(),
  );
  expect(geocodingCalls.map((call: any) => call.args.query)).toEqual(["崇川区", "青年中路"]);
  expect(requests.some((url) => url.includes("photon.komoot.io"))).toBe(false);
  const forecastUrls = requests
    .filter((url) => url.includes("api.open-meteo.com/v1/forecast"))
    .map((url) => new URL(url));

  expect(requests.some((url) => url.includes("geocoding-api.open-meteo.com"))).toBe(false);
  const expectedDistrict = gcj02ToWgs84(31.98123, 120.86234);
  const expectedStreet = gcj02ToWgs84(31.982, 120.8626);
  expect(Number(forecastUrls[0].searchParams.get("latitude"))).toBeCloseTo(
    expectedDistrict.latitude,
    5,
  );
  expect(Number(forecastUrls[0].searchParams.get("longitude"))).toBeCloseTo(
    expectedDistrict.longitude,
    5,
  );
  expect(Number(forecastUrls.at(-1)!.searchParams.get("latitude"))).toBeCloseTo(
    expectedStreet.latitude,
    5,
  );
  expect(Number(forecastUrls.at(-1)!.searchParams.get("longitude"))).toBeCloseTo(
    expectedStreet.longitude,
    5,
  );
  const weatherTrigger = page.getByRole("button", { name: /天气：青年中路，72°F/u });
  const weatherTriggerBounds = await weatherTrigger.boundingBox();
  expect(weatherTriggerBounds!.height).toBeGreaterThanOrEqual(36);
  await weatherTrigger.click();
  const popover = page.getByRole("dialog", { name: "青年中路" });
  expect(await weatherTrigger.boundingBox()).toEqual(weatherTriggerBounds);
  await expect(popover.locator(".weather-location-hierarchy")).toContainText(
    "江苏省 · 南通市 · 崇川区 · 文峰街道",
  );
  await expect(popover).toContainText("精度：道路级");
  await expect(popover).toContainText("手动选择 · 精度：道路级");
  await page.mouse.move(0, 0);
  const headerStyle = await page.locator(".weather-header-button").evaluate((element) => {
    const style = getComputedStyle(element);
    const alpha = Number(style.backgroundColor.match(/,\s*([0-9.]+)\)$/u)?.[1]);
    return {
      borderTopWidth: style.borderTopWidth,
      transparentBackground: alpha < 1,
      color: style.color,
      backgroundColor: style.backgroundColor,
    };
  });
  expect(headerStyle.borderTopWidth).toBe("0px");
  expect(headerStyle.transparentBackground).toBe(true);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  const darkHeaderStyle = await page.locator(".weather-header-button").evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, backgroundColor: style.backgroundColor };
  });
  expect(darkHeaderStyle.color).not.toBe(darkHeaderStyle.backgroundColor);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await expect(popover).toContainText("未来 6 小时");
  await expect(popover).toContainText("未来 7 天");
  await expect(popover).toContainText("Open-Meteo");
  await expect(popover.locator(".weather-daily-list .weather-forecast-item")).toHaveCount(7);
  failForecast = true;
  await popover.getByRole("button", { name: "刷新天气" }).click();
  await expect(popover).toContainText("正在显示缓存天气；暂时无法更新");
  await expect(popover).toContainText("缓存天气");
  await page.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);
  await expect(weatherTrigger).toBeFocused();
  await weatherTrigger.click();
  await expect(popover).toBeVisible();
  await page.locator(".shell-brand h1").click();
  await expect(popover).toHaveCount(0);
});

test("Weather location search distinguishes duplicate villages and classifies school/address results", async ({
  page,
}) => {
  await seedDashboardRuntime(page);
  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "天气" })
    .click();
  await settings.getByLabel("启用天气").check();
  await settings.getByLabel("搜索地点").fill("李家村");
  await settings.getByLabel("上级地区提示（可选）").fill("江苏省徐州市丰县");
  await settings.getByRole("button", { name: "搜索地点" }).click();
  const results = settings.getByLabel("地点搜索结果");
  await expect(results.getByRole("button")).toHaveCount(2);
  await expect(results).toContainText("江苏省 · 徐州市 · 丰县 · 邢楼镇");
  await expect(results).toContainText("安徽省 · 淮北市 · 濉溪县 · 临涣镇");
  await expect(results).toContainText("村庄");
  let calls = await page.evaluate(() =>
    (window as any).__workspaceDashboardTest.getGeocodingCalls(),
  );
  expect(calls.at(-1).args.adminHint).toBe("江苏省徐州市丰县");

  await settings.getByLabel("搜索地点").fill("南通大学");
  await settings.getByRole("button", { name: "搜索地点" }).click();
  await expect(results).toContainText("学校");
  await expect(results).toContainText("南通大学");

  await settings.getByLabel("搜索地点").fill("江苏省南通市崇川区青年中路88号");
  await settings.getByRole("button", { name: "搜索地点" }).click();
  await expect(results).toContainText("地址");
  await expect(results).toContainText("江苏省 · 南通市 · 崇川区 · 青年中路");

  await settings.getByLabel("搜索地点").fill("无结果地点");
  await settings.getByRole("button", { name: "搜索地点" }).click();
  await expect(results).toContainText("没有找到合适的文字搜索结果");
  await expect(settings.getByRole("button", { name: "在地图上选择" })).toBeVisible();
  await expect(settings.getByText("使用经纬度", { exact: true })).toBeVisible();
});

test("Weather map picker and manual coordinates keep coordinate-only locations usable", async ({
  page,
}) => {
  await page.route("https://api.open-meteo.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        timezone: "Asia/Shanghai",
        current: {
          time: "2026-09-23T20:00",
          temperature_2m: 22,
          apparent_temperature: 21,
          weather_code: 2,
          is_day: 1,
          relative_humidity_2m: 65,
        },
        hourly: {
          time: ["2026-09-23T20:00"],
          temperature_2m: [22],
          weather_code: [2],
          precipitation_probability: [10],
        },
        daily: {
          time: Array.from(
            { length: 7 },
            (_, index) => "2026-09-" + String(23 + index).padStart(2, "0"),
          ),
          temperature_2m_max: Array(7).fill(27),
          temperature_2m_min: Array(7).fill(19),
          weather_code: Array(7).fill(2),
          precipitation_probability_max: Array(7).fill(10),
        },
      }),
    });
  });
  await seedDashboardRuntime(page);
  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "天气" })
    .click();
  await settings.getByLabel("启用天气").check();
  await settings.getByRole("button", { name: "在地图上选择" }).click();
  const mapPicker = settings.getByRole("region", { name: "地图选点" });
  const map = mapPicker.getByRole("button", { name: "地图，点击选择坐标或拖动平移" });
  await expect(map).toBeVisible();
  await expect
    .poll(() => map.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await map.click({ position: { x: 100, y: 120 } });
  await mapPicker.getByRole("button", { name: "使用此地图位置" }).click();
  await expect(settings.getByLabel("当前天气设置")).toContainText("地图选定位置");
  await expect(settings).toContainText("地图选点");

  await settings.getByText("使用经纬度", { exact: true }).click();
  await settings.getByLabel("纬度").fill("31.2304");
  await settings.getByLabel("经度").fill("121.4737");
  await settings.getByLabel("输入坐标类型").selectOption("wgs84");
  await settings.getByRole("button", { name: "使用此坐标" }).click();
  await expect(settings.getByLabel("当前天气设置")).toContainText("手动坐标");
  await expect(settings).toContainText("手动选择 · 精度：地点名称暂不可解析");
});

test("Weather map picker stays unavailable without the AMap rendering credential", async ({
  page,
}) => {
  await seedDashboardRuntime(page);
  await page.evaluate(() =>
    (window as any).__workspaceDashboardTest.setAmapCredentialConfigured(false),
  );
  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "天气" })
    .click();
  await settings.getByLabel("启用天气").check();

  const mapButton = settings.getByRole("button", { name: "在地图上选择" });
  await expect(mapButton).toBeDisabled();
  await expect(settings.getByRole("region", { name: "地图选点" })).toHaveCount(0);
  await expect(settings).toContainText("地图选点需要先配置高德 Web Service 密钥");
  await expect(settings.getByText("使用经纬度", { exact: true })).toBeVisible();
});

test("当前位置只在双重显式确认后请求，坐标先模糊化且低精度时保留手动入口", async ({ page }) => {
  const requests: string[] = [];
  await page.addInitScript(() => {
    const state = { calls: 0, accuracy: 250 };
    Object.assign(window, { __weatherGeoTest: state });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(
          success: PositionCallback,
          _error?: PositionErrorCallback | null,
          _options?: PositionOptions,
        ) {
          state.calls += 1;
          success({
            coords: {
              latitude: 31.2226,
              longitude: 120.8974,
              accuracy: state.accuracy,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            } as GeolocationCoordinates,
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      },
    });
  });
  page.on("request", (request) => {
    if (request.url().includes("open-meteo.com")) requests.push(request.url());
  });
  await page.route("https://api.open-meteo.com/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        timezone: "Asia/Shanghai",
        current: {
          time: "2026-09-23T20:00",
          temperature_2m: 22,
          apparent_temperature: 21,
          weather_code: 2,
          is_day: 1,
          relative_humidity_2m: 65,
        },
        hourly: {
          time: Array.from(
            { length: 8 },
            (_, index) => `2026-09-23T${String(20 + index).padStart(2, "0")}:00`,
          ),
          temperature_2m: Array(8).fill(22),
          weather_code: Array(8).fill(2),
          precipitation_probability: Array(8).fill(10),
        },
        daily: {
          time: Array.from(
            { length: 7 },
            (_, index) => `2026-09-${String(23 + index).padStart(2, "0")}`,
          ),
          temperature_2m_max: Array(7).fill(27),
          temperature_2m_min: Array(7).fill(19),
          weather_code: Array(7).fill(2),
          precipitation_probability_max: Array(7).fill(10),
        },
      }),
    });
  });
  await seedDashboardRuntime(page);
  expect(await page.evaluate(() => (window as any).__weatherGeoTest.calls)).toBe(0);

  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "天气" })
    .click();
  await settings.getByLabel("启用天气").check();
  await settings.getByRole("button", { name: "使用当前位置" }).click();
  const locationConsent = settings.getByRole("region", { name: "当前位置使用说明" });
  await expect(locationConsent).toBeVisible();
  await locationConsent.getByRole("button", { name: "取消" }).click();
  expect(await page.evaluate(() => (window as any).__weatherGeoTest.calls)).toBe(0);

  await settings.getByRole("button", { name: "使用当前位置" }).click();
  await settings.getByRole("button", { name: "同意并定位" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__weatherGeoTest.calls)).toBe(1);
  await expect.poll(() => requests.some((url) => url.includes("api.open-meteo.com"))).toBe(true);
  const reverseCall = await page.evaluate(() =>
    (window as any).__workspaceDashboardTest
      .getGeocodingCalls()
      .find((call: any) => call.command === "reverse_geocode_weather_location"),
  );
  const forecastUrl = new URL(requests.find((url) => url.includes("api.open-meteo.com"))!);
  const expectedInternal = wgs84ToGcj02(31.223, 120.897);
  expect(reverseCall.args.latitude).toBeCloseTo(expectedInternal.latitude, 5);
  expect(reverseCall.args.longitude).toBeCloseTo(expectedInternal.longitude, 5);
  expect(requests.some((url) => url.includes("photon.komoot.io"))).toBe(false);
  expect(Number(forecastUrl.searchParams.get("latitude"))).toBeCloseTo(31.223, 4);
  expect(Number(forecastUrl.searchParams.get("longitude"))).toBeCloseTo(120.897, 4);

  await settings.getByRole("button", { name: "取消" }).click();
  const weatherButton = page.getByRole("button", { name: /天气：观音山街道/u });
  await expect(weatherButton).toBeVisible();
  await weatherButton.click();
  const details = page.getByRole("dialog", { name: "观音山街道" });
  await expect(details.locator(".weather-location-hierarchy")).toContainText(
    "江苏省 · 南通市 · 崇川区 · 观音山街道",
  );
  await expect(details).toContainText("当前位置 · 精度：街镇/片区级");
  await expect(page.locator("body")).not.toContainText("31.223");
  await expect(page.locator("body")).not.toContainText("不应保留的道路名");
  await page.keyboard.press("Escape");
  await expect(weatherButton).toBeFocused();

  await page.getByRole("button", { name: "设置" }).click();
  const reopenedSettings = page.getByRole("dialog", { name: "设置" });
  await reopenedSettings
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "天气" })
    .click();
  await page.evaluate(() => ((window as any).__weatherGeoTest.accuracy = 15_000));
  await reopenedSettings.getByRole("button", { name: "使用当前位置" }).click();
  await reopenedSettings.getByRole("button", { name: "同意并定位" }).click();
  await expect(reopenedSettings.getByRole("alert")).toContainText("精度较低");
  await expect(reopenedSettings.getByLabel("搜索地点")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__weatherGeoTest.calls)).toBe(2);

  await page.evaluate(() => {
    (window as any).__weatherGeoTest.accuracy = 250;
    (window as any).__workspaceDashboardTest.setReverseGeocodingFailure(true);
  });
  await reopenedSettings.getByRole("button", { name: "使用当前位置" }).click();
  await reopenedSettings
    .getByRole("region", { name: "当前位置使用说明" })
    .getByRole("button", { name: "同意并定位" })
    .click();
  await expect(reopenedSettings.getByRole("status")).toContainText("地点名称暂时无法解析");
  await expect(page.getByRole("button", { name: /天气：当前位置/u })).toBeVisible();
  expect(requests.some((url) => url.includes("api.open-meteo.com/v1/forecast"))).toBe(true);
});

test("地点搜索错误与天气预报错误分开显示，搜索失败后可重试", async ({ page }) => {
  await seedDashboardRuntime(page);
  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "天气" })
    .click();
  await settings.getByLabel("启用天气").check();
  await settings.getByLabel("搜索地点").fill("南通大学");
  await page.evaluate(() =>
    (window as any).__workspaceDashboardTest.setGeocodingSearchFailure(true),
  );
  await settings.getByRole("button", { name: "搜索地点" }).click();
  await expect(settings.getByRole("alert")).toHaveText(
    "地点搜索服务暂时不可用，请重试，或使用地图/经纬度选点。",
  );
  await expect(settings.getByRole("button", { name: "搜索地点" })).toBeEnabled();

  await page.evaluate(() =>
    (window as any).__workspaceDashboardTest.setGeocodingSearchFailure(false),
  );
  await settings.getByRole("button", { name: "搜索地点" }).click();
  await expect(settings.getByRole("button", { name: /南通大学/u })).toBeVisible();
  await expect(settings.getByRole("alert")).toHaveCount(0);
});

test("failed Weather requests never block offline core routes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem(
      "links-workplace.weather.settings",
      JSON.stringify({
        enabled: true,
        location: {
          displayName: "南通 · 江苏 · 中国",
          latitude: 31.98,
          longitude: 120.89,
          timezone: "Asia/Shanghai",
        },
        temperatureUnit: "celsius",
      }),
    );
  });
  await page.route("https://api.open-meteo.com/**", (route) => route.abort());
  await seedDashboardRuntime(page);
  await expect(page.getByTestId("workspace-dashboard")).toBeVisible();
  await page.getByRole("button", { name: /天气：南通/u }).click();
  await expect(page.getByRole("alert").filter({ hasText: "天气数据暂时不可用" })).toBeVisible();
  await page.getByRole("button", { name: "关闭天气详情" }).click();

  await page.getByRole("button", { name: "任务", exact: true }).click();
  await expect(page.getByTestId("workspace-tasks")).toBeVisible();
  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "天气" })
    .click();
  await expect(settings.getByTestId("weather-settings")).toBeVisible();
  await settings.getByRole("button", { name: "取消" }).click();

  await page
    .getByRole("navigation", { name: "产品模式" })
    .getByRole("button", { name: "课表" })
    .click();
  await expect(page.getByRole("heading", { name: "课表" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "产品模式" })
    .getByRole("button", { name: "工作台" })
    .click();
  await page.getByRole("button", { name: /查看完整日程/u }).click();
  await expect(page.getByTestId("workspace-schedule")).toBeVisible();
  await page
    .getByRole("navigation", { name: "产品模式" })
    .getByRole("button", { name: "工作台" })
    .click();
  await page.getByRole("button", { name: /Obsidian，打开现有知识库/u }).click();
  await expect(page.getByRole("heading", { name: "Obsidian", exact: true })).toBeVisible();
  await page.locator(".workspace-obsidian-back").click();
  await page.getByRole("button", { name: /收件箱，暂无待整理/u }).click();
  await expect(page.getByTestId("workspace-inbox")).toBeVisible();
  await page.locator(".workspace-inbox-breadcrumb").click();
  await expect(page.getByTestId("workspace-dashboard")).toBeVisible();
  expect(errors).toEqual([]);
});

test("日常习惯建议取消不写入，确认后保存为日程", async ({ page }) => {
  const routine = {
    id: "routine-run",
    title: "跑步",
    targetDurationMinutes: 40,
    weekdaysMask: 1 << 2,
    preferredStartTime: "18:00",
    preferredEndTime: "21:00",
    enabled: true,
    lastScheduledDate: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  await seedDashboardRuntime(page, FIXED_NOW, "数学基础", {}, {}, {}, [routine]);
  const suggestion = page.getByTestId("routine-suggestion");
  await expect(suggestion).toContainText("跑步 · 40 分钟");
  await suggestion.getByRole("button", { name: "安排" }).click();

  const editor = page.getByRole("dialog", { name: "添加日程" });
  await expect(editor.getByLabel("标题")).toHaveValue("跑步");
  await expect(editor.getByRole("textbox", { name: "日期年" })).toHaveValue("2026");
  await expect(editor.getByRole("textbox", { name: "日期月" })).toHaveValue("09");
  await expect(editor.getByRole("textbox", { name: "日期日" })).toHaveValue("23");
  await expect(editor.getByLabel("开始时间")).toHaveValue("18:00");
  await expect(editor.getByLabel("结束时间")).toHaveValue("18:40");
  await editor.getByRole("button", { name: "取消" }).click();
  expect(await page.evaluate(() => (window as any).__workspaceDashboardTest.getEventCount())).toBe(
    0,
  );
  expect(
    await page.evaluate(() =>
      (window as any).__workspaceDashboardTest.getRoutineScheduledDate("routine-run"),
    ),
  ).toBeNull();

  await page
    .getByRole("navigation", { name: "产品模式" })
    .getByRole("button", { name: "工作台" })
    .click();
  const refreshedSuggestion = page.getByTestId("routine-suggestion");
  await expect(refreshedSuggestion).toBeVisible();
  await refreshedSuggestion.getByRole("button", { name: "安排" }).click();
  const confirmedEditor = page.getByRole("dialog", { name: "添加日程" });
  await confirmedEditor.getByRole("button", { name: "保存" }).click();
  await expect(page.getByTestId("workspace-schedule")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__workspaceDashboardTest.getEventCount())).toBe(
    1,
  );
  expect(
    await page.evaluate(() =>
      (window as any).__workspaceDashboardTest.getRoutineScheduledDate("routine-run"),
    ),
  ).toBe("2026-09-23");
  expect(
    await page.evaluate(() => (window as any).__workspaceDashboardTest.getPersonalTaskCount()),
  ).toBe(0);
});

test("设置中的日常习惯可新增、编辑、停用和删除", async ({ page }) => {
  await seedDashboardRuntime(page);
  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "日常习惯" })
    .click();
  const panel = settings.getByTestId("routine-settings");
  await expect(panel).toBeVisible();
  await panel.getByLabel("名称").fill("骑行");
  await panel.getByLabel("目标时长（分钟）").fill("30");
  await panel.getByRole("button", { name: "新增习惯" }).click();
  const row = panel.getByRole("listitem").filter({ hasText: "骑行" });
  await expect(row).toBeVisible();
  await expect(row.getByLabel("启用骑行")).toBeChecked();
  await row.getByLabel("启用骑行").uncheck();
  await expect(row.getByLabel("启用骑行")).not.toBeChecked();
  await row.getByRole("button", { name: "编辑" }).click();
  await panel.getByLabel("名称").fill("室内骑行");
  await panel.getByRole("button", { name: "保存修改" }).click();
  const updated = panel.getByRole("listitem").filter({ hasText: "室内骑行" });
  await expect(updated).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await updated.getByRole("button", { name: "删除" }).click();
  await expect(panel.getByRole("listitem")).toHaveCount(0);
});

test("本机搜索可定位私人日记，支持无结果、键盘返回与多种窗口尺寸", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("links-workplace.theme-preference", "dark");
  });
  const searchEvent = {
    id: "search-event",
    title: "搜索结果日程",
    description: null,
    date: "2026-09-24",
    startTime: "15:00",
    endTime: "16:00",
    location: "A101",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    createdAt: "2026-09-20T00:00:00.000Z",
    updatedAt: "2026-09-20T00:00:00.000Z",
  };
  await seedDashboardRuntime(
    page,
    FIXED_NOW,
    "数学基础",
    { events: [searchEvent] },
    { hasEntry: true },
  );
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page
      .locator(".workspace-task-list strong")
      .first()
      .evaluate((element) => getComputedStyle(element).userSelect),
  ).toBe("text");
  await page.getByRole("button", { name: "搜索本机内容" }).click();
  const search = page.getByRole("searchbox", { name: "搜索本机内容" });
  await expect(search).toBeFocused();
  expect(
    await page.locator(".shell-header").evaluate((element) => getComputedStyle(element).userSelect),
  ).toBe("none");
  const searchField = page.locator(".workspace-search-field");
  const searchBoundsBeforeFocus = await searchField.boundingBox();
  await search.blur();
  await search.focus();
  expect(await searchField.boundingBox()).toEqual(searchBoundsBeforeFocus);
  const descriptionBounds = await page
    .locator(".workspace-search-header > div > p:last-child")
    .boundingBox();
  const inputBounds = await searchField.boundingBox();
  const descriptionGap = inputBounds!.y - (descriptionBounds!.y + descriptionBounds!.height);
  expect(descriptionGap).toBeGreaterThanOrEqual(10);
  expect(descriptionGap).toBeLessThanOrEqual(16);
  expect(
    await page.evaluate(() => (window as any).__workspaceDashboardTest.getSearchDiaryReadCount()),
  ).toBe(0);
  await page.evaluate(() => {
    window.fetch = async () => {
      throw new Error("本机搜索不得发起网络请求");
    };
  });
  await search.fill("PRIVATE");
  const clearButton = page.getByRole("button", { name: "清除搜索" });
  await expect(clearButton).toHaveText("×");
  await clearButton.focus();
  await expect(clearButton).toBeFocused();
  await clearButton.click();
  await search.fill("PRIVATE");
  const diaryResult = page.locator('.workspace-search-result[data-search-category="diaryEntry"]');
  await expect(diaryResult).toHaveCount(1);
  await expect(diaryResult).toHaveAttribute("data-object-type", "diaryEntry");
  expect(
    await diaryResult.locator("strong").evaluate((element) => getComputedStyle(element).userSelect),
  ).toBe("text");

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1600, height: 900 },
    { width: 1366, height: 768 },
    { width: 720, height: 520 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.locator(".workspace-search-page").evaluate((element) => {
        const pageElement = element as HTMLElement;
        return pageElement.scrollWidth <= pageElement.clientWidth + 1;
      }),
    ).toBe(true);
  }

  await diaryResult.click();
  await expect(page.getByLabel("2026-09-23 日记正文")).toHaveValue("private diary fixture body");
  await page.getByRole("button", { name: "搜索本机内容" }).click();
  const reopenedSearch = page.getByRole("searchbox", { name: "搜索本机内容" });
  await expect(reopenedSearch).toBeFocused();
  await reopenedSearch.fill("no-such-local-record");
  await expect(page.getByText("没有找到相关内容。", { exact: true })).toBeVisible();
  await reopenedSearch.press("Escape");
  await expect(page.getByTestId("workspace-dashboard")).toBeVisible();

  await page.getByRole("button", { name: "搜索本机内容" }).click();
  await page.getByRole("searchbox", { name: "搜索本机内容" }).fill("搜索结果日程");
  const eventResult = page.locator('.workspace-search-result[data-search-category="plannerEvent"]');
  await expect(eventResult).toHaveAttribute("data-object-type", "plannerEvent");
  await eventResult.click();
  await expect(page.getByTestId("workspace-schedule")).toHaveAttribute("data-date", "2026-09-24");
  await expect(page.getByText("搜索结果日程", { exact: true })).toBeVisible();
});
