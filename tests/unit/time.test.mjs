import assert from "node:assert/strict";
import { test } from "node:test";
import {
  timeToMinutes,
  offsetMinutes,
  durationMinutes,
  idleMinutes,
  timeRangesOverlap,
} from "../../src/core/time.ts";

const range = (startTime, endTime) => ({ startTime, endTime });

for (const [clock, minutes] of [
  ["00:00", 0],
  ["07:00", 420],
  ["08:00", 480],
  ["12:30", 750],
  ["14:30", 870],
  ["23:59", 1439],
]) {
  test(`HH:mm ${clock} → ${minutes}`, () => assert.equal(timeToMinutes(clock), minutes));
}

test("offset is based on clock time, with a signed value before origin", () => {
  assert.equal(offsetMinutes("08:00", "07:00"), 60);
  assert.equal(offsetMinutes("07:00", "07:00"), 0);
  assert.equal(offsetMinutes("06:30", "07:00"), -30);
});

test("duration is in real minutes", () => {
  assert.equal(durationMinutes(range("08:00", "08:45")), 45);
  assert.equal(durationMinutes(range("23:00", "23:59")), 59);
});

test("four-hour break is preserved", () => {
  assert.equal(idleMinutes(range("08:00", "10:00"), range("14:00", "15:00")), 240);
});

test("adjacent courses have zero gap and no overlap", () => {
  const a = range("08:00", "08:45"),
    b = range("08:45", "09:30");
  assert.equal(idleMinutes(a, b), 0);
  assert.equal(timeRangesOverlap(a, b), false);
  assert.equal(timeRangesOverlap(b, a), false);
});

test("overlap has zero free gap; detection is symmetric", () => {
  const a = range("08:00", "09:30"),
    b = range("09:00", "10:00");
  assert.equal(idleMinutes(a, b), 0);
  assert.equal(idleMinutes(b, a), 0);
  assert.equal(timeRangesOverlap(a, b), true);
  assert.equal(timeRangesOverlap(b, a), true);
  assert.equal(timeRangesOverlap(a, range("08:15", "08:30")), true);
  assert.equal(timeRangesOverlap(a, a), true);
  assert.equal(timeRangesOverlap(a, range("10:00", "11:00")), false);
});

for (const value of [
  "24:00",
  "25:00",
  "08:60",
  "08:99",
  "",
  "abc",
  "8:00",
  "08:0",
  " 08:00",
  "08:00\n",
  "08:00:00",
  null,
  800,
  undefined,
]) {
  test(`reject invalid clock ${JSON.stringify(value)}`, () => {
    assert.throws(() => timeToMinutes(value), RangeError);
  });
}

for (const invalid of [
  range("09:00", "08:00"),
  range("08:00", "08:00"),
  range("23:00", "01:00"),
  range("abc", "09:00"),
  range("08:00", "24:00"),
]) {
  test(`all interval functions reject ${JSON.stringify(invalid)}`, () => {
    const valid = range("08:00", "09:00");
    assert.throws(() => durationMinutes(invalid), RangeError);
    assert.throws(() => idleMinutes(invalid, valid), RangeError);
    assert.throws(() => idleMinutes(valid, invalid), RangeError);
    assert.throws(() => timeRangesOverlap(invalid, valid), RangeError);
    assert.throws(() => timeRangesOverlap(valid, invalid), RangeError);
  });
}

test("offset validates both arguments", () => {
  assert.throws(() => offsetMinutes("bad", "07:00"), RangeError);
  assert.throws(() => offsetMinutes("08:00", "bad"), RangeError);
});
