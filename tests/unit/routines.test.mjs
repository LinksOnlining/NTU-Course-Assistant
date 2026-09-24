import assert from "node:assert/strict";
import { test } from "node:test";
import {
  confirmRoutineSuggestion,
  suggestRoutine,
  validateRoutineDraft,
} from "../../src/application/planner/routines.ts";

const today = "2026-09-23"; // Wednesday

function routine(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function item(startTime, endTime, overrides = {}) {
  return {
    id: `event-${startTime}`,
    sourceType: "plannerEvent",
    sourceRef: { type: "plannerEvent", id: `event-${startTime}` },
    date: today,
    startTime,
    endTime,
    title: "占用",
    location: null,
    status: "normal",
    editable: true,
    draggable: true,
    resizable: true,
    occupiesTime: true,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    warnings: [],
    ...overrides,
  };
}

test("日常习惯建议按星期、启用状态、当天已安排与时长筛选", () => {
  const base = { today, now: "18:00", routines: [routine()], timelineItems: [] };
  assert.equal(suggestRoutine(base)?.startTime, "18:00");
  assert.equal(suggestRoutine({ ...base, today: "2026-09-24" }), null);
  assert.equal(suggestRoutine({ ...base, routines: [routine({ enabled: false })] }), null);
  assert.equal(
    suggestRoutine({ ...base, routines: [routine({ lastScheduledDate: today })] }),
    null,
  );
  assert.equal(
    suggestRoutine({
      ...base,
      timelineItems: [item("18:00", "23:30")],
    }),
    null,
  );
});

test("选择最早的合适空闲段并同时考虑 buffer 与偏好窗口", () => {
  const base = { today, now: "18:00", routines: [routine()], timelineItems: [] };
  const withBuffer = suggestRoutine({
    ...base,
    timelineItems: [item("18:30", "19:00", { bufferBeforeMinutes: 20 })],
  });
  assert.equal(withBuffer?.startTime, "19:00");
  assert.equal(withBuffer?.endTime, "19:40");

  const tooShortWindow = suggestRoutine({
    ...base,
    routines: [routine({ preferredStartTime: "18:00", preferredEndTime: "18:30" })],
    timelineItems: [],
  });
  assert.equal(tooShortWindow, null);

  const laterFit = suggestRoutine({
    ...base,
    timelineItems: [item("18:00", "19:00")],
  });
  assert.equal(laterFit?.startTime, "19:00");
});

test("多个习惯按创建时间和 ID 稳定排序", () => {
  const suggestion = suggestRoutine({
    today,
    now: "18:00",
    routines: [routine({ id: "later", createdAt: "2026-09-02" }), routine({ id: "first" })],
    timelineItems: [],
  });
  assert.equal(suggestion?.routineId, "first");
});

test("Routine 表单校验成对窗口与星期掩码", () => {
  const draft = {
    title: "跑步",
    targetDurationMinutes: 40,
    weekdaysMask: 21,
    preferredStartTime: "18:00",
    preferredEndTime: "21:00",
    enabled: true,
  };
  assert.equal(validateRoutineDraft(draft), null);
  assert.match(validateRoutineDraft({ ...draft, weekdaysMask: 0 }), /适用星期/u);
  assert.match(validateRoutineDraft({ ...draft, preferredEndTime: null }), /同时填写/u);
});

test("只有确认日程时调用原子确认仓储，取消不写事件或 Routine", async () => {
  const calls = [];
  const repository = {
    confirmRoutineSuggestion: async (...args) => {
      calls.push(args);
      return args[2];
    },
  };
  const draft = {
    title: "跑步",
    description: "",
    date: today,
    startTime: "18:00",
    endTime: "18:40",
    location: "",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
  };

  assert.equal(calls.length, 0, "打开后取消 Editor 不调用确认 use case");
  const saved = await confirmRoutineSuggestion(
    "run",
    today,
    draft,
    repository,
    new Date("2026-09-23T10:00:00.000Z"),
    "event-run",
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "run");
  assert.equal(calls[0][1], today);
  assert.equal(saved.id, "event-run");
  assert.equal(saved.title, "跑步");
});
