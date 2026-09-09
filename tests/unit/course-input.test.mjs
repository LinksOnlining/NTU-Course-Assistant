import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCourseInput } from "../../src/core/course-input.ts";
import { formatWeeks, parseWeeks } from "../../src/core/weeks.ts";
import { TEST_TIMETABLE } from "../../src/config/timetable.ts";

for (const [source, expected] of [
  ["1-16", Array.from({ length: 16 }, (_, index) => index + 1)],
  ["7,15", [7, 15]],
  ["1-4,7,10-12", [1, 2, 3, 4, 7, 10, 11, 12]],
  ["3,1-3,2,3", [1, 2, 3]],
]) {
  test(`weeks ${source} are parsed, sorted and deduplicated`, () => {
    assert.deepEqual(parseWeeks(source), expected);
  });
}

test("validated week arrays are compacted for edit form prefill", () => {
  assert.equal(formatWeeks([12, 2, 3, 4, 7, 10, 11, 12, 1]), "1-4,7,10-12");
  assert.throws(() => formatWeeks([]), RangeError);
  assert.throws(() => formatWeeks([0, 1]), RangeError);
  assert.throws(() => formatWeeks([1, 31]), RangeError);
});

for (const source of ["", "0", "-1", "18-3", "abc", "1,,3", "1-", "31"]) {
  test(`invalid weeks ${JSON.stringify(source)} are rejected`, () => {
    assert.throws(() => parseWeeks(source), RangeError);
  });
}

const validInput = (changes = {}) => ({
  name: "  机械设计基础  ",
  teacher: " 测试教师 ",
  classroom: " JX02-407 ",
  weekday: 3,
  startTime: "14:00",
  endTime: "15:30",
  weeks: "1-4,7",
  ...changes,
});

test("valid external input creates a normalized Course without invented periods", () => {
  const result = validateCourseInput(validInput(), " course-id ", { axis: TEST_TIMETABLE.axis });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.course, {
    id: "course-id",
    name: "机械设计基础",
    teacher: "测试教师",
    classroom: "JX02-407",
    weekday: 3,
    startPeriod: null,
    endPeriod: null,
    startTime: "14:00",
    endTime: "15:30",
    weeks: [1, 2, 3, 4, 7],
  });
});

test("optional teacher and classroom become explicit null values", () => {
  const result = validateCourseInput(validInput({ teacher: "  ", classroom: "" }), "id");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.course.teacher, null);
  assert.equal(result.course.classroom, null);
});

for (const [label, changes, field] of [
  ["empty name", { name: "   " }, "name"],
  ["weekday below range", { weekday: 0 }, "weekday"],
  ["weekday above range", { weekday: 8 }, "weekday"],
  ["fractional weekday", { weekday: 2.5 }, "weekday"],
  ["invalid start", { startTime: "25:00" }, "startTime"],
  ["invalid end", { endTime: "08:60" }, "endTime"],
  ["reversed time", { startTime: "15:30", endTime: "14:00" }, "endTime"],
  ["empty weeks", { weeks: "" }, "weeks"],
  ["invalid weeks", { weeks: "abc" }, "weeks"],
]) {
  test(`${label} reports a field error and creates no Course`, () => {
    const result = validateCourseInput(validInput(changes), "id");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(typeof result.errors[field], "string");
  });
}

test("times outside the visible axis are rejected without clipping", () => {
  const result = validateCourseInput(validInput({ startTime: "06:00", endTime: "07:00" }), "id", {
    axis: TEST_TIMETABLE.axis,
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.errors.endTime, /07:00–22:00/);
});
