import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildWorkspaceDashboardViewModel,
  loadWorkspaceDashboardSources,
} from "../../src/application/workspace/workspace-dashboard.ts";

const date = "2026-09-23";

function task(id, dueAt, priority = 0, status = "TODO") {
  return {
    id,
    semesterId: "semester-a",
    courseId: null,
    type: "ASSIGNMENT",
    title: id,
    note: null,
    dueAt,
    priority,
    status,
    completedAt: null,
    createdAt: "",
    updatedAt: "",
  };
}

function timelineItem(id, startTime, endTime, overrides = {}) {
  return {
    id,
    sourceType: "academicOccurrence",
    sourceRef: { type: "academicOccurrence", courseId: id, date },
    date,
    startTime,
    endTime,
    title: id,
    location: null,
    status: "normal",
    editable: false,
    draggable: false,
    resizable: false,
    occupiesTime: true,
    warnings: [],
    ...overrides,
  };
}

function personalTask(id, deadlineDate, deadlineTime = null, priority = "none", status = "open") {
  return {
    id,
    title: id,
    description: null,
    status,
    priority,
    deadlineDate,
    deadlineTime,
    createdAt: "",
    updatedAt: "",
    completedAt: null,
  };
}

function plannerItem(id, sourceType, startTime, endTime, overrides = {}) {
  return timelineItem(id, startTime, endTime, {
    sourceType,
    sourceRef: { type: sourceType, id },
    editable: true,
    draggable: true,
    resizable: true,
    ...overrides,
  });
}

test("dashboard task summary merges workspace sources, sorts deadlines and priority, and excludes completed", () => {
  const sources = {
    date,
    timelineItems: [],
    warnings: [],
    tasks: [
      task("future", "2026-09-26T12:00:00", 0),
      task("today", "2026-09-23T13:00:00", 0),
      task("overdue-low", "2026-09-23T10:00:00", 0),
      task("overdue-high", "2026-09-23T10:00:00", 1),
      task("older-overdue", "2026-09-22T18:00:00", 0),
      task("no-deadline", "", 0),
      task("completed", "2026-09-23T09:00:00", 10, "COMPLETED"),
    ],
  };
  const model = buildWorkspaceDashboardViewModel(sources, "12:00");

  assert.deepEqual(
    model.taskSummary.items.map((item) => item.id),
    ["older-overdue", "overdue-high", "overdue-low", "today"],
  );
  assert.equal(model.taskSummary.items[0].deadlineKind, "overdue");
  assert.equal(model.taskSummary.items[1].priority, 1);
  assert.equal(model.taskSummary.items[3].deadlineKind, "today");
  assert.equal(model.taskSummary.totalOpenCount, 6);
  assert.equal(model.taskSummary.hiddenCount, 2);
  assert.ok(model.taskSummary.items.every((item) => item.sourceLabel === "学业"));
  assert.equal(model.taskSummary.source, "workspace");
});

test("task preview places no-deadline tasks last and invalid dates remain explicit", () => {
  const model = buildWorkspaceDashboardViewModel(
    {
      date,
      timelineItems: [],
      warnings: [],
      tasks: [task("no-deadline", ""), task("bad-date", "not-a-date")],
    },
    "12:00",
  );
  assert.deepEqual(
    model.taskSummary.items.map((item) => item.deadlineKind),
    ["none", "invalid"],
  );
  assert.equal(model.taskSummary.items[0].deadlineLabel, "无截止日期");
  assert.equal(model.taskSummary.items[1].deadlineLabel, "截止日期待确认");
});

test("next item prefers the active occurrence, ignores cancelled items, and tracks upcoming items", () => {
  const sources = {
    date,
    timelineItems: [
      timelineItem("ended", "09:00", "10:00"),
      timelineItem("cancelled", "11:30", "12:30", { status: "cancelled", occupiesTime: false }),
      timelineItem("active", "11:45", "12:45"),
      timelineItem("later", "13:00", "14:00"),
    ],
    tasks: [],
    warnings: [],
  };
  const active = buildWorkspaceDashboardViewModel(sources, "12:00");
  assert.equal(active.nextItem?.id, "active");
  assert.equal(active.todayItemCount, 3);
  assert.equal(buildWorkspaceDashboardViewModel(sources, "12:45").nextItem?.id, "later");
  assert.equal(buildWorkspaceDashboardViewModel(sources, "14:00").nextItem, null);
  assert.equal(
    buildWorkspaceDashboardViewModel({ ...sources, timelineItems: [] }, "12:00").date,
    date,
  );
});

test("time context shows one duration while free, a true next gap while active, and tomorrow without repetition", () => {
  const timelineItems = [
    timelineItem("first", "09:00", "10:00", { location: "A101" }),
    timelineItem("cancelled", "10:00", "11:00", { occupiesTime: false, status: "cancelled" }),
    timelineItem("second", "12:00", "13:00"),
  ];
  const tomorrowItem = {
    ...timelineItem("tomorrow", "08:00", "09:00"),
    date: "2026-09-24",
  };
  const sources = {
    date,
    timelineItems,
    futureItems: [...timelineItems, tomorrowItem],
    tasks: [task("todo", "")],
    warnings: [],
  };
  const active = buildWorkspaceDashboardViewModel(sources, "09:30");
  assert.equal(active.timeContext.primary.label, "正在上课");
  assert.equal(active.timeContext.primary.value, "还有 30 分钟");
  assert.equal(active.timeContext.primary.location, "A101");
  assert.equal(active.timeContext.secondary?.label, "下一项安排");
  assert.equal(active.timeContext.secondary?.value, "second");
  const free = buildWorkspaceDashboardViewModel(sources, "10:30");
  assert.deepEqual(
    [
      free.timeContext.primary.label,
      free.timeContext.primary.value,
      free.timeContext.primary.detail,
    ],
    ["当前空闲", "1 小时 30 分钟", "至 12:00"],
  );
  assert.equal(free.timeContext.secondary?.label, "下一项安排");
  assert.equal(free.timeContext.secondary?.value, "second");
  assert.ok(!JSON.stringify(free.timeContext.secondary).includes("1 小时 30 分钟"));
  const tomorrow = buildWorkspaceDashboardViewModel(sources, "14:00");
  assert.equal(tomorrow.timeContext.primary.detail, "至今天结束");
  assert.equal(tomorrow.timeContext.secondary?.value, "tomorrow");
  assert.equal(tomorrow.timeContext.secondary?.detail, "明天 · 课程 · 08:00–09:00");
  assert.equal(
    buildWorkspaceDashboardViewModel({ ...sources, futureItems: timelineItems }, "14:00")
      .timeContext.secondary,
    null,
  );
  const empty = buildWorkspaceDashboardViewModel(
    { ...sources, timelineItems: [], futureItems: [tomorrowItem] },
    "10:00",
  );
  assert.equal(empty.timeContext.primary.label, "今天暂无安排");
  assert.equal(empty.timeContext.primary.value, "14 小时");
  assert.equal(empty.timeContext.secondary?.value, "tomorrow");
});

test("back-to-back courses do not invent a free slot", () => {
  const model = buildWorkspaceDashboardViewModel(
    {
      date,
      timelineItems: [
        timelineItem("first", "09:00", "10:00"),
        timelineItem("second", "10:00", "11:00"),
      ],
      tasks: [],
      warnings: [],
    },
    "09:30",
  );
  assert.equal(model.timeContext.secondary?.label, "下一项安排");
  assert.equal(model.timeContext.secondary?.value, "second");
});

test("dashboard timeline merges courses, independent events and task time blocks, excluding cancelled count", () => {
  const course = timelineItem("course", "09:00", "10:00");
  const event = plannerItem("event", "plannerEvent", "11:00", "12:00", {
    bufferBeforeMinutes: 15,
    bufferAfterMinutes: 10,
  });
  const timeBlock = plannerItem("block", "timeBlock", "13:00", "14:00", {
    title: "个人任务安排",
  });
  const cancelled = timelineItem("cancelled", "15:00", "16:00", {
    status: "cancelled",
    occupiesTime: false,
  });
  const model = buildWorkspaceDashboardViewModel(
    {
      date,
      timelineItems: [course, event, timeBlock, cancelled],
      futureItems: [course, event, timeBlock, cancelled],
      tasks: [],
      personalTasks: [personalTask("task-with-deadline", date, "17:00")],
      warnings: [],
    },
    "10:30",
  );

  assert.deepEqual(
    model.timelineItems.map((item) => item.sourceType),
    ["academicOccurrence", "plannerEvent", "timeBlock", "academicOccurrence"],
  );
  assert.equal(model.todayItemCount, 3);
  assert.equal(model.taskSummary.totalOpenCount, 1);
  assert.equal(model.taskSummary.items[0].sourceLabel, "个人");
  assert.equal(model.timeContext.primary.value, "15 分钟");
  assert.equal(model.timeContext.primary.detail, "至 10:45");
  assert.equal(model.timeContext.secondary?.value, "event");
  assert.equal(model.timeContext.secondary?.sourceLabel, "日程");
});

test("time context names the source of active planner events and accounts for their buffer", () => {
  const event = plannerItem("event", "plannerEvent", "11:00", "12:00", {
    title: "团队会议",
    bufferBeforeMinutes: 15,
    bufferAfterMinutes: 20,
  });
  const sources = {
    date,
    timelineItems: [event],
    futureItems: [event],
    tasks: [],
    personalTasks: [],
    warnings: [],
  };

  const before = buildWorkspaceDashboardViewModel(sources, "10:50");
  assert.equal(before.timeContext.primary.label, "即将开始");
  assert.equal(before.timeContext.primary.value, "还有 10 分钟");
  assert.equal(before.timeContext.primary.sourceLabel, "日程");
  assert.equal(before.timeContext.primary.detail, "日程 · 11:00–12:00");

  const active = buildWorkspaceDashboardViewModel(sources, "11:30");
  assert.equal(active.timeContext.primary.label, "正在进行");
  assert.equal(active.timeContext.primary.value, "还有 30 分钟");
  assert.equal(active.timeContext.primary.title, "团队会议");
  assert.equal(active.timeContext.primary.sourceLabel, "日程");
  assert.equal(active.timeContext.secondary?.label, "下一段空闲");
  assert.equal(active.timeContext.secondary?.detail, "12:20–24:00");

  const after = buildWorkspaceDashboardViewModel(sources, "12:10");
  assert.equal(after.timeContext.primary.label, "安排缓冲");
  assert.equal(after.timeContext.primary.value, "剩余 10 分钟");
});

test("mixed personal and academic tasks sort by urgency, timed deadline, then priority", () => {
  const model = buildWorkspaceDashboardViewModel(
    {
      date,
      timelineItems: [],
      tasks: [
        task("学业-今天", "2026-09-23T18:00:00", 1),
        task("学业-未来", "2026-09-24T08:00:00", 1),
      ],
      personalTasks: [
        personalTask("个人-逾期", "2026-09-22", null, "low"),
        personalTask("个人-今天-日期", date, null, "high"),
        personalTask("个人-今天-时间", date, "18:00", "medium"),
        personalTask("个人-完成", date, "10:00", "high", "completed"),
      ],
      warnings: [],
    },
    "12:00",
  );

  assert.deepEqual(
    model.taskSummary.items.map((item) => item.id),
    ["个人-逾期", "个人-今天-时间", "学业-今天", "个人-今天-日期"],
  );
  assert.deepEqual(
    model.taskSummary.items.map((item) => item.sourceLabel),
    ["个人", "个人", "学业", "个人"],
  );
  assert.equal(model.taskSummary.totalOpenCount, 5);
  assert.equal(
    model.timelineItems.length,
    0,
    "PersonalTask deadlines alone are not timeline items",
  );
});

test("task previews use natural relative dates without changing dueAt", () => {
  const sources = {
    date,
    timelineItems: [],
    warnings: [],
    tasks: [
      task("today", "2026-09-23T18:00:00"),
      task("tomorrow", "2026-09-24T18:00:00"),
      task("weekday", "2026-09-25T18:00:00"),
      task("later", "2026-10-02T18:00:00"),
    ],
  };
  const preview = buildWorkspaceDashboardViewModel(sources, "08:00").taskSummary.items;
  assert.deepEqual(
    preview.map((item) => item.deadlineLabel),
    ["今天 18:00", "明天 18:00", "周五 18:00", "10月2日 18:00"],
  );
  assert.equal(preview[1].dueAt, "2026-09-24T18:00:00");
});

test("workspace loader reuses Academic application reads and canonical occurrence resolution", async () => {
  const calls = [];
  const sources = await loadWorkspaceDashboardSources(date, null, {
    async loadScheduleData() {
      calls.push("schedule");
      return {
        courses: [
          {
            id: "course-a",
            name: "星期三课程",
            teacher: null,
            classroom: "A101",
            weekday: 3,
            startPeriod: null,
            endPeriod: null,
            startTime: "10:00",
            endTime: "11:00",
            weeks: [1],
          },
        ],
        periodTimes: null,
        warnings: ["课程结构警告"],
      };
    },
    async loadHubData(options) {
      calls.push(`hub:${options.fallbackSemesterId ?? "none"}`);
      return {
        semesters: [
          {
            id: "semester-a",
            name: "当前学期",
            firstWeekMonday: "2026-09-21",
            totalWeeks: 16,
            timezone: "Asia/Shanghai",
            status: "ACTIVE",
            createdAt: "",
            updatedAt: "",
          },
        ],
        overrides: [],
        tasks: [task("real-task", "")],
        exams: [],
      };
    },
    async loadPlannerEvents(startDate, endDate) {
      calls.push(`events:${startDate}:${endDate}`);
      return [];
    },
    async loadTimeBlocks(startDate, endDate) {
      calls.push(`blocks:${startDate}:${endDate}`);
      return [];
    },
    async loadPersonalTasks() {
      calls.push("personal-tasks");
      return [];
    },
    async hasDiaryEntry(checkDate) {
      calls.push(`diary-status:${checkDate}`);
      return true;
    },
  });

  assert.deepEqual(calls, [
    "schedule",
    "hub:none",
    "events:2026-09-23:2026-09-30",
    "blocks:2026-09-23:2026-09-30",
    "personal-tasks",
    "diary-status:2026-09-23",
  ]);
  assert.equal(sources.timelineItems.length, 1);
  assert.equal(sources.timelineItems[0].title, "星期三课程");
  assert.equal(sources.timelineItems[0].sourceRef.date, date);
  assert.equal(sources.tasks[0].id, "real-task");
  assert.deepEqual(sources.futureItems, sources.timelineItems);
  assert.deepEqual(sources.personalTasks, []);
  assert.equal(sources.hasDiaryToday, true);
  assert.equal(buildWorkspaceDashboardViewModel(sources, "08:00").hasDiaryToday, true);
  assert.deepEqual(sources.warnings, ["课程结构警告"]);
});

test("legacy active term is read-only fallback and archived-only data is not reclassified active", async () => {
  const calls = [];
  const termConfig = {
    firstWeekMonday: "2026-09-21",
    totalWeeks: 16,
    timezone: "Asia/Shanghai",
  };
  const reader = {
    async loadScheduleData() {
      return { courses: [], periodTimes: [], warnings: [] };
    },
    async loadHubData(options) {
      calls.push(options.fallbackSemesterId);
      return {
        semesters: [],
        overrides: [],
        tasks: [],
        exams: [],
      };
    },
  };
  const legacy = await loadWorkspaceDashboardSources(date, termConfig, reader);
  assert.equal(calls[0], "legacy-active-semester");
  assert.deepEqual(legacy.timelineItems, []);

  const archived = await loadWorkspaceDashboardSources(date, termConfig, {
    ...reader,
    async loadHubData() {
      return {
        semesters: [
          {
            id: "archived",
            name: "旧学期",
            firstWeekMonday: "2026-09-21",
            totalWeeks: 16,
            timezone: "Asia/Shanghai",
            status: "ARCHIVED",
            createdAt: "",
            updatedAt: "",
          },
        ],
        overrides: [],
        tasks: [],
        exams: [],
      };
    },
  });
  assert.deepEqual(archived.timelineItems, []);
});
