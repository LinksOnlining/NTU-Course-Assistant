import assert from "node:assert/strict";
import { test } from "node:test";
import { courseTiming, coursesOverlap } from "../../src/core/timetable-layout.ts";
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
