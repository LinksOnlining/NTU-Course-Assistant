import test from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(moved?.startPeriod, 5);
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
