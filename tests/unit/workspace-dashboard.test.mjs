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
