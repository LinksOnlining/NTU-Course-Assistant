import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalWidgetViewModel } from "../../src/core/widget-view.ts";
import { layoutCourseOccurrences } from "../../src/core/timetable-layout.ts";
import { getTodayDashboard } from "../../src/core/today-dashboard.ts";
import { buildUnifiedReminderPlans } from "../../src/core/reminder-v2.ts";
import { summarizeCourseChanges } from "../../src/core/course-change.ts";
import { resolveCourseOccurrences } from "../../src/core/course-occurrence.ts";

const semester = {
  id: "semester-2026-spring",
  name: "2026 春季学期",
  firstWeekMonday: "2026-02-23",
  totalWeeks: 16,
  timezone: "Asia/Shanghai",
  status: "ACTIVE",
  createdAt: "2026-02-01T00:00:00+08:00",
  updatedAt: "2026-02-01T00:00:00+08:00",
};

const course = {
  id: "course-math",
  name: "高等数学",
  teacher: "王老师",
  classroom: "A101",
  weekday: 2,
  startPeriod: 3,
  endPeriod: 4,
  startTime: "10:10",
  endTime: "11:45",
  weeks: [1, 2, 3, 4, 5],
};

const originalPeriods = [
  { period: 1, startTime: "08:00", endTime: "08:45" },
  { period: 2, startTime: "08:50", endTime: "09:35" },
];
const changedPeriods = [
  { period: 1, startTime: "07:50", endTime: "08:35" },
  { period: 2, startTime: "08:45", endTime: "09:30" },
];

const override = (changes) => ({
  id: "override-1",
  courseId: course.id,
  semesterId: semester.id,
  kind: "CANCEL",
  originalOccurrenceKey: null,
  originalDate: "2026-03-10",
  targetDate: null,
  startPeriod: null,
  endPeriod: null,
  startTime: null,
  endTime: null,
  classroom: null,
  teacher: null,
  note: null,
  active: true,
  createdAt: "2026-02-01T00:00:00+08:00",
  updatedAt: "2026-02-01T00:00:00+08:00",
  ...changes,
});

test("resolves base occurrences with deterministic date and time fields", () => {
  const result = resolveCourseOccurrences([course], semester);
  assert.equal(result.length, 5);
  assert.deepEqual(result[0], {
    courseId: "course-math",
    semesterId: semester.id,
    date: "2026-02-24",
    teachingWeek: 1,
    weekday: 2,
    startPeriod: 3,
    endPeriod: 4,
    startTime: "10:10",
    endTime: "11:45",
    room: "A101",
    teacher: "王老师",
    status: "NORMAL",
    source: "BASE",
    originalOccurrenceKey: null,
    occurrenceKey: "course-math:semester-2026-spring:2026-02-24:10:10",
    appliedOverrideId: null,
    appliedOverrideKind: null,
  });
});

test("cancel keeps neighboring weeks and marks only the selected occurrence", () => {
  const result = resolveCourseOccurrences([course], semester, [override({})]);
  assert.equal(result.find((item) => item.date === "2026-03-10")?.status, "CANCELLED");
  assert.equal(result.find((item) => item.date === "2026-03-03")?.status, "NORMAL");
  assert.equal(result.find((item) => item.date === "2026-03-17")?.status, "NORMAL");
});

test("reschedule and modify keep the base course unchanged", () => {
  const result = resolveCourseOccurrences([course], semester, [
    override({
      kind: "RESCHEDULE",
      targetDate: "2026-03-12",
      startPeriod: 5,
      endPeriod: 6,
      startTime: "14:00",
      endTime: "15:35",
      classroom: "B203",
    }),
  ]);
  const moved = result.find((item) => item.date === "2026-03-12");
  assert.equal(moved?.status, "RESCHEDULED");
  assert.equal(moved?.weekday, 4);
  assert.equal(moved?.room, "B203");
  assert.equal(moved?.startPeriod, null);
  assert.equal(result.find((item) => item.date === "2026-03-10")?.status, undefined);

  const modified = resolveCourseOccurrences([course], semester, [
    override({ kind: "MODIFY", classroom: "C303", teacher: "李老师" }),
  ]).find((item) => item.date === "2026-03-10");
  assert.equal(modified?.status, "NORMAL");
  assert.equal(modified?.source, "OVERRIDE");
  assert.equal(modified?.room, "C303");
  assert.equal(modified?.teacher, "李老师");
});

test("makeup adds an extra occurrence and range filtering is stable", () => {
  const result = resolveCourseOccurrences(
    [course],
    semester,
    [
      override({
        id: "makeup-1",
        kind: "MAKEUP",
        originalDate: null,
        targetDate: "2026-03-14",
        startTime: "08:00",
        endTime: "09:35",
        classroom: "实验楼 101",
      }),
    ],
    { from: "2026-03-14", to: "2026-03-14" },
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].status, "MAKEUP");
  assert.equal(result[0].weekday, 6);
  assert.equal(result[0].date, "2026-03-14");
  assert.equal(result[0].room, "实验楼 101");
});

test("v1.3.0 PDF-imported period indexes resolve against current periods for schedule, Today, Widget and reminders", () => {
  const importedCourse = {
    ...course,
    weekday: 2,
    startPeriod: 1,
    endPeriod: 2,
    startTime: "08:00",
    endTime: "09:35",
  };
  const original = resolveCourseOccurrences(
    [importedCourse],
    semester,
    [],
    undefined,
    originalPeriods,
  );
  const updated = resolveCourseOccurrences(
    [importedCourse],
    semester,
    [],
    undefined,
    changedPeriods,
  );
  const changesSummary = summarizeCourseChanges([importedCourse], updated, []);

  assert.deepEqual([original[0].startTime, original[0].endTime], ["08:00", "09:35"]);
  assert.deepEqual([updated[0].startTime, updated[0].endTime], ["07:50", "09:30"]);
  assert.deepEqual([updated[0].startPeriod, updated[0].endPeriod], [1, 2]);
  assert.deepEqual(
    [
      changesSummary[0].meetings[0].startPeriod,
      changesSummary[0].meetings[0].endPeriod,
      changesSummary[0].meetings[0].startTime,
      changesSummary[0].meetings[0].endTime,
    ],
    [1, 2, "07:50", "09:30"],
  );
  assert.deepEqual([importedCourse.startTime, importedCourse.endTime], ["08:00", "09:35"]);

  const date = updated[0].date;
  const dashboard = getTodayDashboard(date, "07:30", updated, [], []);
  assert.deepEqual(
    [dashboard.nextOccurrence.startTime, dashboard.nextOccurrence.endTime],
    ["07:50", "09:30"],
  );
  const widget = buildCanonicalWidgetViewModel([importedCourse], semester, updated, {
    date,
    time: "07:30",
  });
  assert.deepEqual([widget.today[0].startTime, widget.today[0].endTime], ["07:50", "09:30"]);
  const schedule = layoutCourseOccurrences([importedCourse], updated, 1, {
    startTime: "07:00",
    endTime: "10:00",
  });
  assert.deepEqual(
    [schedule[1][0].course.startTime, schedule[1][0].course.endTime],
    ["07:50", "09:30"],
  );
  const reminder = buildUnifiedReminderPlans(updated, [], [], {
    termConfig: null,
    reminderSettings: { enabled: true, advanceMinutes: 15 },
  })[0];
  assert.equal(reminder.courseStartMilliseconds, Date.parse(`${date}T07:50:00+08:00`));
  assert.equal(reminder.triggerAtMilliseconds, Date.parse(`${date}T07:35:00+08:00`));
});

test("fixed-time courses remain unchanged when periods change", () => {
  const fixedTimeCourse = { ...course, startPeriod: null, endPeriod: null };
  const result = resolveCourseOccurrences(
    [fixedTimeCourse],
    semester,
    [],
    undefined,
    changedPeriods,
  );
  assert.deepEqual([result[0].startTime, result[0].endTime], ["10:10", "11:45"]);
});

test("cancel and room overrides follow current periods while explicit reschedules stay fixed", () => {
  const periodBasedCourse = {
    ...course,
    weekday: 2,
    startPeriod: 1,
    endPeriod: 2,
    startTime: "08:00",
    endTime: "09:35",
  };
  const cancelled = resolveCourseOccurrences(
    [periodBasedCourse],
    semester,
    [override({ originalDate: "2026-03-10" })],
    undefined,
    changedPeriods,
  ).find((item) => item.date === "2026-03-10");
  assert.equal(cancelled?.status, "CANCELLED");
  assert.deepEqual([cancelled?.startTime, cancelled?.endTime], ["07:50", "09:30"]);

  const roomChanged = resolveCourseOccurrences(
    [periodBasedCourse],
    semester,
    [override({ kind: "MODIFY", classroom: "C303" })],
    undefined,
    changedPeriods,
  ).find((item) => item.date === "2026-03-10");
  assert.deepEqual(
    [roomChanged?.startTime, roomChanged?.endTime, roomChanged?.room],
    ["07:50", "09:30", "C303"],
  );

  const rescheduled = resolveCourseOccurrences(
    [periodBasedCourse],
    semester,
    [
      override({
        kind: "RESCHEDULE",
        originalDate: "2026-03-10",
        targetDate: "2026-03-12",
        startTime: "14:00",
        endTime: "15:35",
      }),
    ],
    undefined,
    changedPeriods,
  ).find((item) => item.date === "2026-03-12");
  assert.deepEqual([rescheduled?.startTime, rescheduled?.endTime], ["14:00", "15:35"]);
  assert.deepEqual([rescheduled?.startPeriod, rescheduled?.endPeriod], [null, null]);
});

test("makeup does not replace the original occurrence", () => {
  const result = resolveCourseOccurrences([course], semester, [
    override({
      id: "makeup-2",
      kind: "MAKEUP",
      originalOccurrenceKey: null,
      originalDate: null,
      targetDate: "2026-03-14",
      startTime: "08:00",
      endTime: "09:35",
    }),
  ]);
  assert.equal(result.filter((item) => item.status === "NORMAL").length, 5);
  assert.equal(result.filter((item) => item.status === "MAKEUP").length, 1);
  assert.equal(result.find((item) => item.date === "2026-03-10")?.status, "NORMAL");
});

test("revoking an override restores the base occurrence", () => {
  const result = resolveCourseOccurrences([course], semester, [override({ active: false })]);
  assert.equal(result.find((item) => item.date === "2026-03-10")?.status, "NORMAL");
});

test("the newest active override wins for the same occurrence", () => {
  const result = resolveCourseOccurrences([course], semester, [
    override({
      id: "older",
      kind: "RESCHEDULE",
      targetDate: "2026-03-12",
      startTime: "14:00",
      endTime: "15:35",
      updatedAt: "2026-03-01T00:00:00+08:00",
    }),
    override({
      id: "newer",
      kind: "MODIFY",
      classroom: "C303",
      updatedAt: "2026-03-02T00:00:00+08:00",
    }),
  ]);
  const item = result.find((occurrence) => occurrence.date === "2026-03-10");
  assert.equal(item?.room, "C303");
  assert.equal(
    result.some((occurrence) => occurrence.date === "2026-03-12"),
    false,
  );
});

test("same input produces the same ordering and keys", () => {
  const first = resolveCourseOccurrences([course], semester, [override({})]);
  const second = resolveCourseOccurrences([course], semester, [override({})]);
  assert.deepEqual(first, second);
});
