import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWorkspaceContext } from "../../src/application/workspace/workspace-context.ts";
import {
  collectWorkspaceContextFragments,
  workspaceContextProviders,
} from "../../src/application/workspace/context-provider-registry.ts";
import { buildWorkspaceDashboardViewModel } from "../../src/application/workspace/workspace-dashboard.ts";

const date = "2026-09-23";

function timelineItem(id, startTime, endTime, overrides = {}) {
  return {
    id,
    sourceType: "plannerEvent",
    sourceRef: { type: "plannerEvent", id },
    date,
    startTime,
    endTime,
    title: id,
    location: null,
    status: "normal",
    editable: true,
    draggable: true,
    resizable: true,
    occupiesTime: true,
    warnings: [],
    ...overrides,
  };
}

function academicTask(id, dueAt, status = "TODO") {
  return {
    id,
    semesterId: "semester",
    courseId: null,
    type: "ASSIGNMENT",
    title: id,
    note: "must not leak",
    dueAt,
    priority: 1,
    status,
    completedAt: null,
    createdAt: "",
    updatedAt: "",
  };
}

function personalTask(id, deadlineDate, deadlineTime, status = "open") {
  return {
    id,
    title: id,
    description: "private task description",
    status,
    priority: "medium",
    deadlineDate,
    deadlineTime,
    createdAt: "",
    updatedAt: "",
    completedAt: null,
  };
}

function context(overrides = {}) {
  return buildWorkspaceContext({
    date,
    localTime: "09:30",
    timelineItems: [],
    academicTasks: [],
    personalTasks: [],
    weatherSnapshot: null,
    hasDiaryToday: false,
    pendingInboxCount: 0,
    ...overrides,
  });
}

test("context selects current and next item and computes the next free slot with buffers", () => {
  const input = {
    date,
    localTime: "09:30",
    timelineItems: [
      timelineItem("active", "09:00", "10:00", { bufferAfterMinutes: 15 }),
      timelineItem("next", "11:00", "12:00", { bufferBeforeMinutes: 10 }),
    ],
    academicTasks: [],
    personalTasks: [],
    weatherSnapshot: null,
    hasDiaryToday: false,
    pendingInboxCount: 0,
  };
  const result = buildWorkspaceContext(input);
  assert.equal(result.currentItem?.id, "active");
  assert.equal(result.nextItem?.id, "next");
  assert.deepEqual(result.nextFreeSlot, {
    date,
    startMinute: 615,
    endMinute: 650,
    durationMinutes: 35,
  });
  assert.deepEqual(result, buildWorkspaceContext(input));
});

test("context counts open, overdue, and today's tasks without counting completed tasks", () => {
  const result = context({
    localTime: "12:00",
    academicTasks: [
      academicTask("yesterday", "2026-09-22T09:00:00"),
      academicTask("due-earlier-today", `${date}T10:00:00`),
      academicTask("due-later-today", `${date}T14:00:00`),
      academicTask("completed", `${date}T08:00:00`, "COMPLETED"),
    ],
    personalTasks: [
      personalTask("personal-overdue", "2026-09-22", null),
      personalTask("personal-today", date, null),
      personalTask("no-deadline", null, null),
      personalTask("personal-completed", date, "08:00", "completed"),
    ],
  });
  assert.equal(result.openTaskCount, 6);
  assert.equal(result.overdueTaskCount, 3);
  assert.equal(result.todayTaskCount, 3);
});

test("context exposes safe weather summary and only Diary/Inbox status", () => {
  const weatherSnapshot = {
    location: {
      displayName: "南通 · 江苏 · 中国",
      latitude: 31.98,
      longitude: 120.89,
      timezone: "Asia/Shanghai",
    },
    fetchedAt: "2026-09-23T08:00:00Z",
    timezone: "Asia/Shanghai",
    current: {
      time: "2026-09-23T16:00",
      temperatureCelsius: 22,
      apparentTemperatureCelsius: 21,
      weatherCode: 2,
      isDay: true,
      humidityPercent: 65,
    },
    hourly: [],
    daily: [],
  };
  const result = context({
    weatherSnapshot,
    hasDiaryToday: true,
    pendingInboxCount: 2,
    personalTasks: [personalTask("private title", null, null)],
  });
  assert.deepEqual(result.weatherSummary, {
    location: "南通 · 江苏 · 中国",
    condition: "局部多云",
    temperature: "22°C",
  });
  assert.equal(result.hasDiaryToday, true);
  assert.equal(result.pendingInboxCount, 2);
  assert.equal(context({ weatherSnapshot: null }).weatherSummary, null);
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /private task description|must not leak|diaryBody|inboxRaw/u);
});

test("a new local date and time deterministically refresh current-item selection", () => {
  const earlier = timelineItem("earlier", "23:00", "23:30");
  const afterMidnight = {
    ...timelineItem("after-midnight", "00:15", "00:45"),
    date: "2026-09-24",
  };
  const items = [earlier, afterMidnight];
  const beforeMidnight = context({
    localTime: "23:10",
    timelineItems: [earlier],
    futureItems: items,
  });
  const afterMidnightContext = context({
    date: "2026-09-24",
    localTime: "00:20",
    timelineItems: [afterMidnight],
    futureItems: items,
  });
  assert.equal(beforeMidnight.currentItem?.id, "earlier");
  assert.equal(beforeMidnight.nextItem?.id, "after-midnight");
  assert.equal(afterMidnightContext.currentItem?.id, "after-midnight");
  assert.equal(afterMidnightContext.localTime, "00:20");
});

test("an empty day is fully available, with unavailable Diary and Inbox represented only as status", () => {
  const result = context({ localTime: "08:00", pendingInboxCount: 0 });
  assert.equal(result.currentItem, null);
  assert.equal(result.nextItem, null);
  assert.deepEqual(result.nextFreeSlot, {
    date,
    startMinute: 480,
    endMinute: 1440,
    durationMinutes: 960,
  });
  assert.equal(result.hasDiaryToday, false);
  assert.equal(result.pendingInboxCount, 0);
});

test("next free slot advances to the next available local day when today is fully occupied", () => {
  const fullDay = timelineItem("all-day", "00:00", "24:00");
  const tomorrow = {
    ...timelineItem("tomorrow-event", "08:00", "09:00"),
    date: "2026-09-24",
  };
  const result = context({
    localTime: "12:00",
    timelineItems: [fullDay],
    futureItems: [fullDay, tomorrow],
  });
  assert.deepEqual(result.nextFreeSlot, {
    date: "2026-09-24",
    startMinute: 0,
    endMinute: 480,
    durationMinutes: 480,
  });
});

test("Dashboard overview and module status are projected from WorkspaceContext", () => {
  const timeline = timelineItem("current", "09:00", "10:00");
  const model = buildWorkspaceDashboardViewModel(
    {
      date,
      timelineItems: [timeline],
      futureItems: [timeline],
      tasks: [academicTask("due-today", `${date}T14:00:00`)],
      personalTasks: [personalTask("open-task", null, null)],
      hasDiaryToday: true,
      pendingInboxCount: 2,
      warnings: [],
    },
    "09:30",
  );
  assert.equal(model.context.currentItem?.id, "current");
  assert.equal(model.todayItemCount, model.context.todayItemCount);
  assert.equal(model.hasDiaryToday, model.context.hasDiaryToday);
  assert.equal(model.pendingInboxCount, model.context.pendingInboxCount);
  assert.equal(model.todaySummaryText, "1 项安排 · 2 个待办");
});

test("Routine suggestion is contributed through its registered Context provider", () => {
  const result = context({
    localTime: "18:00",
    routines: [
      {
        id: "run",
        title: "跑步",
        targetDurationMinutes: 40,
        weekdaysMask: 1 << 2,
        preferredStartTime: "18:00",
        preferredEndTime: "21:00",
        enabled: true,
        lastScheduledDate: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ],
  });

  assert.deepEqual(result.routineSuggestion, {
    routineId: "run",
    title: "跑步",
    targetDate: date,
    startTime: "18:00",
    endTime: "18:40",
    targetDurationMinutes: 40,
  });
});

test("Weather Context provider failure is isolated from Diary and Inbox contributions", () => {
  const providers = [
    ...workspaceContextProviders.filter((provider) => provider.moduleId !== "weather"),
    {
      id: "weather.context",
      moduleId: "weather",
      order: 30,
      provide(input) {
        assert.deepEqual(Object.keys(input), ["weatherSnapshot"]);
        throw new Error("weather context failure");
      },
    },
  ];
  const fragments = collectWorkspaceContextFragments(
    {
      "diary.context": { hasDiaryToday: true },
      "inbox.context": { pendingInboxCount: 2 },
      "weather.context": { weatherSnapshot: null },
      "routine.context": { today: date, now: "09:30", routines: [], timelineItems: [] },
    },
    providers,
  );

  assert.equal(fragments.hasDiaryToday, true);
  assert.equal(fragments.pendingInboxCount, 2);
  assert.equal(fragments.weatherSummary, undefined);
});
