import assert from "node:assert/strict";
import { test } from "node:test";
import {
  courseTiming,
  coursesOverlap,
  layoutCourseOccurrences,
  layoutCourses,
} from "../../src/core/timetable-layout.ts";
import { durationMinutes, idleMinutes, timeToMinutes } from "../../src/core/time.ts";
import { TEST_TIMETABLE } from "../../src/config/timetable.ts";

const course = (changes = {}) =>
  Object.freeze({
    id: "test-a",
    name: "测试课程",
    teacher: null,
    classroom: null,
    weekday: 1,
    startPeriod: 1,
    endPeriod: 1,
    startTime: "08:00",
    endTime: "08:45",
    weeks: Object.freeze([1, 3]),
    ...changes,
  });

test("course offset and height inputs use actual times, independent of array order or periods", () => {
  const morning = course({ startPeriod: 99, endPeriod: 99 });
  const afternoon = course({ id: "test-b", startTime: "14:00", endTime: "15:00" });
  assert.deepEqual(
    [afternoon, morning].map((c) => courseTiming(c, TEST_TIMETABLE.axis)),
    [
      { offsetMinutes: 420, durationMinutes: 60 },
      { offsetMinutes: 60, durationMinutes: 45 },
    ],
  );
});

test("geometry preserves 240 minutes of blank time", () => {
  const a = courseTiming(course({ endTime: "10:00" }), TEST_TIMETABLE.axis);
  const b = courseTiming(course({ startTime: "14:00", endTime: "15:00" }), TEST_TIMETABLE.axis);
  assert.equal(b.offsetMinutes - (a.offsetMinutes + a.durationMinutes), 240);
});

test("axis endpoints are included, outside courses rejected rather than clipped", () => {
  assert.deepEqual(courseTiming(TEST_TIMETABLE.axis, TEST_TIMETABLE.axis), {
    offsetMinutes: 0,
    durationMinutes: 900,
  });
  for (const times of [
    { startTime: "06:59", endTime: "08:00" },
    { startTime: "21:00", endTime: "22:01" },
    { startTime: "09:00", endTime: "08:00" },
  ]) {
    assert.throws(() => courseTiming(times, TEST_TIMETABLE.axis), RangeError);
  }
  assert.throws(() => courseTiming(course(), { startTime: "22:00", endTime: "07:00" }), RangeError);
});

test("course overlap requires common weekday and week", () => {
  const a = course();
  assert.equal(coursesOverlap(a, course({ weeks: [3, 5] })), true);
  assert.equal(coursesOverlap(a, course({ weekday: 2 })), false);
  assert.equal(coursesOverlap(a, course({ weeks: [2, 4] })), false);
  assert.equal(coursesOverlap(a, course({ startTime: "08:45", endTime: "09:30" })), false);
  assert.throws(() => coursesOverlap(a, course({ weekday: 2, endTime: "07:00" })), RangeError);
});

test("test configuration is explicit, valid and never a school default", () => {
  assert.equal(TEST_TIMETABLE.purpose, "test-only");
  assert.equal(durationMinutes(TEST_TIMETABLE.axis), 900);
  for (const period of TEST_TIMETABLE.periods) {
    assert(Number.isInteger(period.period) && period.period > 0);
    assert(durationMinutes(period) > 0);
    assert(timeToMinutes(period.startTime) >= timeToMinutes(TEST_TIMETABLE.axis.startTime));
  }
  assert.equal(idleMinutes(TEST_TIMETABLE.periods[0], TEST_TIMETABLE.periods[1]), 5);
});

test("layout filters current week into seven stable weekday columns", () => {
  const result = layoutCourses(
    [
      course({ id: "monday", weekday: 1, weeks: [3] }),
      course({ id: "sunday", weekday: 7, weeks: [3] }),
      course({ id: "hidden", weekday: 5, weeks: [2] }),
    ],
    3,
    TEST_TIMETABLE.axis,
  );
  assert.equal(result.length, 7);
  assert.deepEqual(
    result.map((day) => day.map((item) => item.course.id)),
    [["monday"], [], [], [], [], [], ["sunday"]],
  );
  assert.throws(() => layoutCourses([], 0, TEST_TIMETABLE.axis), RangeError);
  assert.throws(() => layoutCourses([], 1.5, TEST_TIMETABLE.axis), RangeError);
});

test("chain overlaps share a stable two-lane group without affecting later courses", () => {
  const [monday] = layoutCourses(
    [
      course({ id: "a", startTime: "08:00", endTime: "09:30" }),
      course({ id: "b", startTime: "09:00", endTime: "10:00" }),
      course({ id: "c", startTime: "09:45", endTime: "10:45" }),
      course({ id: "d", startTime: "11:00", endTime: "12:00" }),
    ],
    3,
    TEST_TIMETABLE.axis,
  );
  assert.deepEqual(
    monday.map(({ course: item, lane, laneCount }) => [item.id, lane, laneCount]),
    [
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 2],
      ["d", 0, 1],
    ],
  );
});

test("canonical occurrences drive the weekly layout and preserve the source course for editing", () => {
  const source = course({ id: "base", name: "基础课", weekday: 1, weeks: [3] });
  const occurrence = {
    courseId: "base",
    semesterId: "semester",
    date: "2026-09-14",
    teachingWeek: 3,
    weekday: 1,
    startPeriod: 2,
    endPeriod: 2,
    startTime: "09:00",
    endTime: "09:45",
    room: "B203",
    teacher: "教师乙",
    status: "RESCHEDULED",
    source: "OVERRIDE",
    originalOccurrenceKey: "base:semester:2026-09-14:08:00",
    occurrenceKey: "base:semester:2026-09-14:09:00:override",
    appliedOverrideId: "override",
    appliedOverrideKind: "RESCHEDULE",
  };
  const [monday] = layoutCourseOccurrences([source], [occurrence], 3, TEST_TIMETABLE.axis);
  assert.equal(monday.length, 1);
  assert.equal(monday[0].course.id, occurrence.occurrenceKey);
  assert.equal(monday[0].sourceCourseId, source.id);
  assert.equal(monday[0].sourceCourse, source);
  assert.equal(monday[0].occurrenceStatus, "RESCHEDULED");
  assert.equal(monday[0].course.classroom, "B203");
});

test("cancelled canonical occurrences are not rendered in the weekly layout", () => {
  const source = course({ id: "cancelled", weekday: 1, weeks: [3] });
  const occurrence = {
    courseId: source.id,
    semesterId: "semester",
    date: "2026-09-14",
    teachingWeek: 3,
    weekday: 1,
    startPeriod: 1,
    endPeriod: 1,
    startTime: "08:00",
    endTime: "08:45",
    room: null,
    teacher: null,
    status: "CANCELLED",
    source: "OVERRIDE",
    originalOccurrenceKey: "cancelled:semester:2026-09-14:08:00",
    occurrenceKey: "cancelled:semester:2026-09-14:08:00:override",
    appliedOverrideId: "override",
    appliedOverrideKind: "CANCEL",
  };
  const [monday] = layoutCourseOccurrences([source], [occurrence], 3, TEST_TIMETABLE.axis);
  assert.equal(monday.length, 0);
});
