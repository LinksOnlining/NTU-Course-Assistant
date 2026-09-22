import test from "node:test";
import assert from "node:assert/strict";
import { getTodayDashboard } from "../../src/core/today-dashboard.ts";
import {
  buildReminderInstances,
  buildReminderTargets,
  buildUnifiedReminderPlans,
} from "../../src/core/reminder-v2.ts";

const occurrence = {
  courseId: "c1",
  semesterId: "s1",
  date: "2026-09-21",
  teachingWeek: 3,
  weekday: 1,
  startPeriod: 1,
  endPeriod: 2,
  startTime: "10:10",
  endTime: "11:45",
  room: "A101",
  teacher: "王老师",
  status: "NORMAL",
  source: "BASE",
  originalOccurrenceKey: null,
  occurrenceKey: "c1:s1:2026-09-21:10:10",
  appliedOverrideId: null,
  appliedOverrideKind: null,
};

const task = {
  id: "t1",
  semesterId: "s1",
  courseId: "c1",
  type: "ASSIGNMENT",
  title: "实验报告",
  note: null,
  dueAt: "2026-09-21T18:00:00+08:00",
  priority: 1,
  status: "TODO",
  completedAt: null,
  createdAt: "2026-09-01T00:00:00+08:00",
  updatedAt: "2026-09-01T00:00:00+08:00",
};

test("today dashboard separates changes, due tasks and next occurrence", () => {
  const dashboard = getTodayDashboard("2026-09-21", "09:00", [occurrence], [task], []);
  assert.equal(dashboard.nextOccurrence?.courseId, "c1");
  assert.equal(dashboard.todayOccurrences.length, 1);
  assert.equal(dashboard.dueToday.length, 1);
  assert.equal(dashboard.overdueTasks.length, 0);
});

test("completed tasks are excluded from reminder targets", () => {
  const targets = buildReminderTargets([occurrence], [task], []);
  assert.equal(targets.length, 2);
  const instances = buildReminderInstances(
    [{ id: "r1", targetType: "TASK", targetId: "t1", offsetsMinutes: [120, 60], enabled: true }],
    targets,
    Date.parse("2026-09-21T10:00:00+08:00"),
  );
  assert.equal(instances.length, 2);
  assert.notEqual(instances[0].occurrenceKey, instances[1].occurrenceKey);
});

test("unified reminder plans include course, task and exam offsets", () => {
  const plans = buildUnifiedReminderPlans(
    [occurrence],
    [task],
    [
      {
        id: "e1",
        semesterId: "s1",
        courseId: null,
        title: "期末考试",
        startsAt: "2026-09-25T14:00:00+08:00",
        endsAt: null,
        location: "B203",
        seatInfo: null,
        note: null,
        status: "SCHEDULED",
        createdAt: "2026-09-01T00:00:00+08:00",
        updatedAt: "2026-09-01T00:00:00+08:00",
      },
    ],
    { termConfig: null, reminderSettings: { enabled: true, advanceMinutes: 15 } },
  );
  assert.equal(plans.length, 6);
  assert.equal(plans.filter((plan) => plan.occurrenceKey.startsWith("exam:")).length, 3);
});
