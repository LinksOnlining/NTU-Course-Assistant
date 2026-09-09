import assert from "node:assert/strict";
import { test } from "node:test";
import { TEST_PERIOD_TIMES } from "../../src/config/timetable.ts";
import {
  getTimelineBounds,
  periodRangeToTimeRange,
  periodToTime,
  timeRangeToPeriods,
  validatePeriodTimes,
} from "../../src/core/period-time.ts";

test("test-only period configuration is complete, ordered and valid", () => {
  assert.doesNotThrow(() => validatePeriodTimes(TEST_PERIOD_TIMES));
  assert.deepEqual(
    TEST_PERIOD_TIMES.map(({ period }) => period),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );
});

test("a period maps to its exact configured time", () => {
  assert.deepEqual(periodToTime(1, TEST_PERIOD_TIMES), {
    period: 1,
    startTime: "08:00",
    endTime: "08:45",
  });
  assert.equal(periodToTime(12, TEST_PERIOD_TIMES), null);
});

test("a contiguous period range maps to endpoint times", () => {
  assert.deepEqual(periodRangeToTimeRange({ startPeriod: 1, endPeriod: 3 }, TEST_PERIOD_TIMES), {
    startTime: "08:00",
    endTime: "10:40",
  });
  assert.equal(periodRangeToTimeRange({ startPeriod: 11, endPeriod: 12 }, TEST_PERIOD_TIMES), null);
});

test("time ranges map back only on exact configured boundaries", () => {
  assert.deepEqual(
    timeRangeToPeriods({ startTime: "08:00", endTime: "09:35" }, TEST_PERIOD_TIMES),
    { startPeriod: 1, endPeriod: 2 },
  );
  assert.equal(
    timeRangeToPeriods({ startTime: "08:10", endTime: "09:20" }, TEST_PERIOD_TIMES),
    null,
  );
});

test("period ranges reject invalid positive-integer ordering", () => {
  for (const range of [
    { startPeriod: 0, endPeriod: 1 },
    { startPeriod: 2, endPeriod: 1 },
    { startPeriod: 1.5, endPeriod: 2 },
  ]) {
    assert.throws(() => periodRangeToTimeRange(range, TEST_PERIOD_TIMES), RangeError);
  }
  assert.throws(() => periodToTime(0, TEST_PERIOD_TIMES), RangeError);
});

test("period configuration rejects duplicate and unsorted periods", () => {
  assert.throws(
    () =>
      validatePeriodTimes([
        { period: 2, startTime: "08:00", endTime: "08:45" },
        { period: 2, startTime: "08:50", endTime: "09:35" },
      ]),
    RangeError,
  );
  assert.throws(
    () =>
      validatePeriodTimes([
        { period: 2, startTime: "08:00", endTime: "08:45" },
        { period: 1, startTime: "08:50", endTime: "09:35" },
      ]),
    RangeError,
  );
});

test("period configuration rejects invalid clocks and reversed intervals", () => {
  assert.throws(
    () => validatePeriodTimes([{ period: 1, startTime: "24:00", endTime: "08:45" }]),
    RangeError,
  );
  assert.throws(
    () => validatePeriodTimes([{ period: 1, startTime: "09:00", endTime: "08:45" }]),
    RangeError,
  );
});

test("normal breaks are kept while overlapping periods are rejected", () => {
  assert.doesNotThrow(() =>
    validatePeriodTimes([
      { period: 1, startTime: "08:00", endTime: "08:45" },
      { period: 2, startTime: "08:50", endTime: "09:35" },
    ]),
  );
  assert.throws(
    () =>
      validatePeriodTimes([
        { period: 1, startTime: "08:00", endTime: "08:45" },
        { period: 2, startTime: "08:40", endTime: "09:25" },
      ]),
    RangeError,
  );
});

test("timeline bounds expand to whole hours around custom periods", () => {
  assert.deepEqual(
    getTimelineBounds({ startTime: "07:00", endTime: "22:00" }, [
      { period: 1, startTime: "06:30", endTime: "07:15" },
      { period: 2, startTime: "22:00", endTime: "22:30" },
    ]),
    { startTime: "06:00", endTime: "23:00" },
  );
});
