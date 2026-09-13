import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_REMINDER_SETTINGS,
  buildReminderPlans,
  excludeHandledReminderPlans,
  createCourseOccurrence,
  findNextReminder,
  generateCourseOccurrences,
  getCourseDate,
  getReminderOccurrence,
  getTeachingWeek,
  validateTermConfig,
  validateTermConfigAgainstCourses,
} from "../../src/core/reminder.ts";

const term = { firstWeekMonday: "2026-09-07", totalWeeks: 18, timezone: "Asia/Shanghai" };
const course = {
  id: "course-1",
  name: "课程",
  teacher: null,
  classroom: null,
  weekday: 3,
  startPeriod: null,
  endPeriod: null,
  startTime: "14:00",
  endTime: "15:30",
  weeks: [1, 3, 5],
};

test("teaching weeks and weekdays use the configured Monday", () => {
  assert.equal(getTeachingWeek("2026-09-07", term), 1);
  assert.equal(getTeachingWeek("2026-09-13", term), 1);
  assert.equal(getTeachingWeek("2026-09-14", term), 2);
  assert.equal(getTeachingWeek("2027-01-10", term), 18);
  assert.equal(getTeachingWeek("2026-09-06", term), null);
  assert.equal(getTeachingWeek("2027-01-11", term), null);
  assert.equal(getCourseDate(term, 3, 3), "2026-09-23");
  assert.equal(getCourseDate(term, 1, 7), "2026-09-13");
});

test("term validation requires a Monday, supported timezone and valid week count", () => {
  assert.throws(() => validateTermConfig({ ...term, firstWeekMonday: "2026-09-08" }), RangeError);
  assert.throws(() => validateTermConfig({ ...term, totalWeeks: 0 }), RangeError);
  assert.throws(() => validateTermConfig({ ...term, timezone: "UTC" }), RangeError);
});

test("course and reminder occurrences use Shanghai wall-clock time with stable keys", () => {
  const occurrence = createCourseOccurrence(course, 3, term);
  assert.deepEqual(occurrence, {
    courseId: "course-1",
    key: "course-1:2026-09-23:14:00",
    week: 3,
    weekday: 3,
    date: "2026-09-23",
    startDateTime: "2026-09-23T14:00:00+08:00",
    endDateTime: "2026-09-23T15:30:00+08:00",
  });
  assert.deepEqual(
    generateCourseOccurrences([course], term).map((item) => item.week),
    [1, 3, 5],
  );
  assert.equal(
    getReminderOccurrence(occurrence, { enabled: true, advanceMinutes: 0 }).triggerAt,
    "2026-09-23T14:00:00+08:00",
  );
  assert.equal(
    getReminderOccurrence(occurrence, { enabled: true, advanceMinutes: 15 }).triggerAt,
    "2026-09-23T13:45:00+08:00",
  );
  assert.equal(
    getReminderOccurrence(occurrence, { enabled: true, advanceMinutes: 60 }).triggerAt,
    "2026-09-23T13:00:00+08:00",
  );
  const overnight = createCourseOccurrence(
    { ...course, weekday: 1, startTime: "00:10", endTime: "00:45", weeks: [1] },
    1,
    term,
  );
  assert.equal(
    getReminderOccurrence(overnight, { enabled: true, advanceMinutes: 30 }).triggerAt,
    "2026-09-06T23:40:00+08:00",
  );
});

test("next reminder distinguishes future, catch-up and already-started courses", () => {
  const enabled = { termConfig: term, reminderSettings: { enabled: true, advanceMinutes: 15 } };
  assert.equal(
    findNextReminder(Date.parse("2026-09-23T05:00:00Z"), [course], enabled).kind,
    "future",
  );
  assert.equal(
    findNextReminder(Date.parse("2026-09-23T05:50:00Z"), [course], enabled).kind,
    "catch-up",
  );
  assert.equal(
    findNextReminder(Date.parse("2026-09-23T06:10:00Z"), [course], enabled).kind,
    "future",
  );
  assert.equal(
    findNextReminder(Date.parse("2026-09-23T06:10:00Z"), [{ ...course, weeks: [3] }], enabled).kind,
    "none",
  );
  assert.deepEqual(
    findNextReminder(Date.parse("2026-09-01T00:00:00Z"), [course], {
      termConfig: term,
      reminderSettings: DEFAULT_REMINDER_SETTINGS,
    }),
    { kind: "none" },
  );
});

test("courses beyond the configured term remain untouched but warn", () => {
  assert.equal(validateTermConfigAgainstCourses([{ ...course, weeks: [20] }], term).length, 1);
});

test("reminder plans are stable, disabled without settings, and keep simultaneous courses", () => {
  const configuration = {
    termConfig: term,
    reminderSettings: { enabled: true, advanceMinutes: 15 },
  };
  const plans = buildReminderPlans([course, { ...course, id: "course-2" }], configuration);
  assert.equal(plans.length, 6);
  const simultaneous = plans.filter(
    (item) => item.triggerAtMilliseconds === plans[0].triggerAtMilliseconds,
  );
  assert.equal(simultaneous.length, 2);
  assert.notEqual(simultaneous[0].occurrenceKey, simultaneous[1].occurrenceKey);
  assert.deepEqual(simultaneous[0].notification, {
    courseName: "课程",
    startTime: "14:00",
    classroom: null,
  });
  assert.deepEqual(
    buildReminderPlans([course], {
      termConfig: null,
      reminderSettings: configuration.reminderSettings,
    }),
    [],
  );
});

test("restart rebuild keeps future and catch-up plans but excludes persisted handled occurrences", () => {
  const configuration = {
    termConfig: term,
    reminderSettings: { enabled: true, advanceMinutes: 15 },
  };
  const plans = buildReminderPlans([course], configuration);
  const handled = new Set(["course-1:2026-09-09:14:00"]);
  const rebuilt = excludeHandledReminderPlans(plans, handled);
  assert.equal(rebuilt.length, plans.length - 1);
  assert.ok(rebuilt.every((plan) => !handled.has(plan.occurrenceKey)));
  assert.equal(
    findNextReminder(Date.parse("2026-09-09T05:50:00Z"), [course], configuration).kind,
    "catch-up",
  );
  assert.equal(
    findNextReminder(Date.parse("2026-09-09T06:10:00Z"), [course], configuration).kind,
    "future",
  );
});
