import assert from "node:assert/strict";
import { test } from "node:test";
import {
  detectWeekdayAxis,
  parseNtuPdfTimetable,
  parsePdfWeeks,
} from "../../src/importers/ntu-pdf/parse.ts";
import {
  headerItems,
  insufficientAxisExtraction,
  periods,
  xAxisExtraction,
  yAxisExtraction,
} from "../fixtures/ntu-pdf-sanitized.mjs";

test("PDF week syntax supports ranges, odd/even, discrete weeks and ignores duration counts", () => {
  assert.deepEqual(parsePdfWeeks("1-6周（单）"), [1, 3, 5]);
  assert.deepEqual(parsePdfWeeks("2-8周(双)"), [2, 4, 6, 8]);
  assert.deepEqual(parsePdfWeeks("7周,15周"), [7, 15]);
  assert.deepEqual(parsePdfWeeks("(共1周)/17周"), [17]);
  assert.equal(parsePdfWeeks("无周数"), null);
});

test("weekday axis detection recognizes x and tolerates small coordinate drift", () => {
  assert.equal(detectWeekdayAxis(headerItems(xAxisExtraction)), "x");
});

test("weekday axis detection recognizes rotated y-axis layouts", () => {
  assert.equal(detectWeekdayAxis(headerItems(yAxisExtraction)), "y");
});

test("weekday axis detection does not guess when evidence is insufficient or tied", () => {
  assert.equal(detectWeekdayAxis(headerItems(insufficientAxisExtraction)), null);
  assert.equal(
    detectWeekdayAxis([
      { page: 1, text: "一", x: 100, y: 100, width: 10, height: 10 },
      { page: 1, text: "三", x: 200, y: 200, width: 10, height: 10 },
      { page: 1, text: "日", x: 300, y: 300, width: 10, height: 10 },
    ]),
    null,
  );
});

test("x-axis fixture parses fixed fields, multiline names, weeks, rooms and teachers", () => {
  const candidates = parseNtuPdfTimetable(xAxisExtraction, {
    periods,
    isUsingTestSchedule: true,
  });
  assert.deepEqual(
    candidates.map((candidate) => [
      candidate.name,
      candidate.weekday,
      candidate.startPeriod,
      candidate.endPeriod,
    ]),
    [
      ["结构基础", 1, 1, 2],
      ["跨行课程-国际方向", 3, 3, 3],
      ["实验方法", 7, 2, 2],
    ],
  );
  assert.deepEqual(candidates[0].weeks, [1, 3, 5]);
  assert.deepEqual(candidates[1].weeks, [2, 4, 6, 8]);
  assert.deepEqual(candidates[2].weeks, [7, 15]);
  assert.equal(candidates[0].classroom, "JX01-101");
  assert.equal(candidates[2].classroom, null);
  assert.equal(candidates[0].teacher, "教师甲");
  assert(candidates[2].issues.some((issue) => issue.code === "unassigned-classroom"));
});

test("three non-fixed practice lines remain separate reviewable candidates", () => {
  const candidates = parseNtuPdfTimetable(yAxisExtraction, {
    periods,
    isUsingTestSchedule: false,
  });
  const practices = candidates.filter((candidate) => candidate.startPeriod === null);
  assert.equal(candidates.filter((candidate) => candidate.startPeriod !== null).length, 1);
  assert.equal(practices.length, 3);
  assert.deepEqual(
    practices.map((candidate) => candidate.name),
    ["生产实习", "综合训练B", "劳动教育（二）"],
  );
  assert.deepEqual(
    practices.map((candidate) => candidate.weeks),
    [[17], [1, 2], Array.from({ length: 17 }, (_, index) => index + 1)],
  );
  for (const candidate of practices) {
    assert.equal(candidate.weekday, null);
    assert.equal(candidate.startPeriod, null);
    assert.equal(candidate.endPeriod, null);
    assert.equal(candidate.resolvedTime, null);
    assert(candidate.issues.some((issue) => issue.code === "missing-weekday"));
    assert(candidate.issues.some((issue) => issue.code === "missing-period"));
  }
});

test("insufficient weekday evidence preserves the candidate with a blocking issue", () => {
  const [candidate] = parseNtuPdfTimetable(insufficientAxisExtraction, {
    periods,
    isUsingTestSchedule: false,
  });
  assert(candidate);
  assert.equal(candidate.name, "待确认课程");
  assert.equal(candidate.weekday, null);
  assert.equal(candidate.startPeriod, 1);
  assert(candidate.issues.some((issue) => issue.code === "missing-weekday"));
});

test("test-only periods block actual-time resolution instead of posing as official times", () => {
  const [testCandidate] = parseNtuPdfTimetable(xAxisExtraction, {
    periods,
    isUsingTestSchedule: true,
  });
  const [confirmedCandidate] = parseNtuPdfTimetable(xAxisExtraction, {
    periods,
    isUsingTestSchedule: false,
  });
  assert.equal(testCandidate.resolvedTime, null);
  assert(testCandidate.issues.some((issue) => issue.code === "test-schedule"));
  assert.deepEqual(confirmedCandidate.resolvedTime, {
    startTime: "08:00",
    endTime: "09:35",
  });
  assert(!confirmedCandidate.issues.some((issue) => issue.code === "test-schedule"));
});

test("candidate ids, order and complete parser results are deterministic", () => {
  const options = { periods, isUsingTestSchedule: true };
  const first = parseNtuPdfTimetable(yAxisExtraction, options);
  const second = parseNtuPdfTimetable(yAxisExtraction, options);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map((candidate) => candidate.id)).size, first.length);
  assert.deepEqual(
    first.map((candidate) => candidate.name),
    ["设计基础", "生产实习", "综合训练B", "劳动教育（二）"],
  );
});

test("issues have field ownership and stable de-duplicated identities", () => {
  const candidates = parseNtuPdfTimetable(yAxisExtraction, {
    periods,
    isUsingTestSchedule: true,
  });
  for (const candidate of candidates) {
    const keys = candidate.issues.map((issue) => `${issue.code}:${issue.field}`);
    assert.equal(new Set(keys).size, keys.length);
    assert(candidate.issues.every((issue) => issue.field.length > 0));
    assert(candidate.issues.every((issue) => ["warning", "blocking"].includes(issue.severity)));
  }
});
