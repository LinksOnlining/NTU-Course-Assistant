import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadWorkspaceScheduleDay,
  shiftWorkspaceScheduleDate,
} from "../../src/application/workspace/workspace-schedule.ts";

const date = "2026-09-23";

function createReader() {
  const calls = [];
  const semester = {
    id: "semester-1",
    name: "测试学期",
    firstWeekMonday: "2026-09-21",
    totalWeeks: 16,
    timezone: "Asia/Shanghai",
    status: "ACTIVE",
    createdAt: "",
    updatedAt: "",
  };
  const course = {
    id: "course-1",
    name: "数据结构",
    teacher: null,
    classroom: "A101",
    weekday: 3,
    startPeriod: null,
    endPeriod: null,
    weeks: [1],
    startTime: "09:00",
    endTime: "10:00",
  };
  const event = {
    id: "event-1",
    title: "项目讨论",
    description: null,
    date,
    startTime: "11:00",
    endTime: "12:00",
    location: "线上",
    bufferBeforeMinutes: 10,
    bufferAfterMinutes: 15,
    createdAt: "",
    updatedAt: "",
  };
  const block = {
    id: "block-1",
    personalTaskId: "task-1",
    date,
    startTime: "14:00",
    endTime: "15:00",
    bufferBeforeMinutes: 20,
    bufferAfterMinutes: 30,
    createdAt: "",
    updatedAt: "",
  };
  const task = {
    id: "task-1",
    title: "阅读论文",
    description: null,
    status: "open",
    priority: "medium",
    deadlineDate: null,
    deadlineTime: null,
    createdAt: "",
    updatedAt: "",
    completedAt: null,
  };
  return {
    calls,
    reader: {
      async loadScheduleData() {
        return { courses: [course], periodTimes: null, warnings: [] };
      },
      async loadHubData(options) {
        calls.push(["hub", options]);
        return { semesters: [semester], overrides: [], tasks: [], exams: [] };
      },
      async loadEvents(from) {
        calls.push(["events", from]);
        return from === date ? [event] : [];
      },
      async loadTimeBlocks(from) {
        calls.push(["blocks", from]);
        return from === date ? [block] : [];
      },
      async loadTasks() {
        return [task];
      },
    },
  };
}

test("Workspace Schedule composes bounded Academic, Event, and TimeBlock projections", async () => {
  const { calls, reader } = createReader();
  const result = await loadWorkspaceScheduleDay(date, null, reader);
  assert.deepEqual(
    calls.filter(([kind]) => kind === "events"),
    [["events", date]],
  );
  assert.deepEqual(
    calls.filter(([kind]) => kind === "blocks"),
    [["blocks", date]],
  );
  assert.deepEqual(
    result.timelineItems.map((item) => [item.sourceType, item.title]),
    [
      ["academicOccurrence", "数据结构"],
      ["plannerEvent", "项目讨论"],
      ["timeBlock", "阅读论文"],
    ],
  );
  assert.equal(result.timelineItems[0].editable, false);
  assert.equal(result.timelineItems[1].editable, true);
  assert.equal(result.timelineItems[2].editable, true);
  assert.equal(result.timelineItems[2].startTime, "14:00");
  assert.equal(result.timelineItems[2].endTime, "15:00");
});

test("Workspace Schedule uses configured legacy term only when no semester exists", async () => {
  const { reader } = createReader();
  const result = await loadWorkspaceScheduleDay(
    date,
    { firstWeekMonday: "2026-09-21", totalWeeks: 16, timezone: "Asia/Shanghai" },
    {
      ...reader,
      async loadHubData(options) {
        assert.equal(options.fallbackSemesterId, "legacy-active-semester");
        return { semesters: [], overrides: [], tasks: [], exams: [] };
      },
    },
  );
  assert.equal(result.timelineItems[0].sourceType, "academicOccurrence");
});

test("schedule date shift validates inputs and handles local month/leap boundaries", () => {
  assert.equal(shiftWorkspaceScheduleDate("2026-09-30", 1), "2026-10-01");
  assert.equal(shiftWorkspaceScheduleDate("2028-02-28", 1), "2028-02-29");
  assert.throws(() => shiftWorkspaceScheduleDate("2026-02-30", 1), /日期无效/u);
});

test("invalid schedule dates do not load any source data", async () => {
  const { calls, reader } = createReader();
  await assert.rejects(loadWorkspaceScheduleDay("not-a-date", null, reader), /有效的日程日期/u);
  assert.deepEqual(calls, []);
});
