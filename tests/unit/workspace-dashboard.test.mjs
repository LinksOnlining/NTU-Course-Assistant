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

test("dashboard task summary preserves AcademicTask source, sorts deadlines and priority, and excludes completed", () => {
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
  assert.equal(active.todayItemCount, 4);
  assert.equal(buildWorkspaceDashboardViewModel(sources, "12:45").nextItem?.id, "later");
  assert.equal(buildWorkspaceDashboardViewModel(sources, "14:00").nextItem, null);
  assert.equal(
    buildWorkspaceDashboardViewModel({ ...sources, timelineItems: [] }, "12:00").date,
    date,
  );
});

test("time context shows one duration while free, a true next gap while active, and tomorrow without repetition", () => {
  const sources = {
    date,
    timelineItems: [
      timelineItem("first", "09:00", "10:00", { location: "A101" }),
      timelineItem("cancelled", "10:00", "11:00", { occupiesTime: false, status: "cancelled" }),
      timelineItem("second", "12:00", "13:00"),
    ],
    tomorrowItems: [timelineItem("tomorrow", "08:00", "09:00")],
    tasks: [task("todo", "")],
    warnings: [],
  };
  const active = buildWorkspaceDashboardViewModel(sources, "09:30");
  assert.equal(active.timeContext.primary.label, "正在上课");
  assert.equal(active.timeContext.primary.value, "还有 30 分钟");
  assert.equal(active.timeContext.primary.location, "A101");
  assert.equal(active.timeContext.secondary?.label, "下一段空闲");
  assert.equal(active.timeContext.secondary?.value, "2 小时");
  assert.equal(active.timeContext.secondary?.detail, "10:00–12:00");
  const free = buildWorkspaceDashboardViewModel(sources, "10:30");
  assert.deepEqual(
    [
      free.timeContext.primary.label,
      free.timeContext.primary.value,
      free.timeContext.primary.detail,
    ],
    ["当前空闲", "1 小时 30 分钟", "至 12:00"],
  );
  assert.equal(free.timeContext.secondary?.label, "下一节课");
  assert.equal(free.timeContext.secondary?.value, "second");
  assert.ok(!JSON.stringify(free.timeContext.secondary).includes("1 小时 30 分钟"));
  const tomorrow = buildWorkspaceDashboardViewModel(sources, "14:00");
  assert.equal(tomorrow.timeContext.primary.detail, "至今天结束");
  assert.equal(tomorrow.timeContext.secondary?.value, "tomorrow");
  assert.equal(tomorrow.timeContext.secondary?.detail, "明天 08:00–09:00");
  assert.equal(
    buildWorkspaceDashboardViewModel({ ...sources, tomorrowItems: [] }, "14:00").timeContext
      .secondary,
    null,
  );
  const empty = buildWorkspaceDashboardViewModel({ ...sources, timelineItems: [] }, "10:00");
  assert.equal(empty.timeContext.primary.label, "今天无课程");
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
  assert.equal(model.timeContext.secondary?.label, "下一节课");
  assert.equal(model.timeContext.secondary?.value, "second");
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
  });

  assert.deepEqual(calls, ["schedule", "hub:none"]);
  assert.equal(sources.timelineItems.length, 1);
  assert.equal(sources.timelineItems[0].title, "星期三课程");
  assert.equal(sources.timelineItems[0].sourceRef.date, date);
  assert.equal(sources.tasks[0].id, "real-task");
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
