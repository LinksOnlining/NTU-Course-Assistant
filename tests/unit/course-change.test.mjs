import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeCourseChanges } from "../../src/core/course-change.ts";

const course = (changes = {}) => ({
  id: "course-a",
  name: "大学物理B",
  teacher: "张老师",
  classroom: "A203",
  weekday: 2,
  startPeriod: 1,
  endPeriod: 2,
  startTime: "08:00",
  endTime: "09:35",
  weeks: [1, 2, 3, 4],
  ...changes,
});

const occurrence = (changes = {}) => ({
  courseId: "course-a",
  semesterId: "semester-a",
  date: "2026-09-08",
  teachingWeek: 2,
  weekday: 2,
  startPeriod: 1,
  endPeriod: 2,
  startTime: "08:00",
  endTime: "09:35",
  room: "A203",
  teacher: "张老师",
  status: "NORMAL",
  source: "BASE",
  originalOccurrenceKey: null,
  occurrenceKey: "course-a:semester-a:2026-09-08:08:00",
  appliedOverrideId: null,
  appliedOverrideKind: null,
  ...changes,
});

const override = (changes = {}) => ({
  id: "override-a",
  courseId: "course-a",
  semesterId: "semester-a",
  kind: "CANCEL",
  originalOccurrenceKey: "course-a:semester-a:2026-09-08:08:00",
  originalDate: "2026-09-08",
  targetDate: null,
  startPeriod: 1,
  endPeriod: 2,
  startTime: null,
  endTime: null,
  classroom: null,
  teacher: null,
  note: null,
  active: true,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  ...changes,
});

test("course-first summaries dedupe weekly occurrences and count changes", () => {
  const summaries = summarizeCourseChanges(
    [course()],
    [
      occurrence(),
      occurrence({
        date: "2026-09-15",
        teachingWeek: 3,
        occurrenceKey: "course-a:semester-a:2026-09-15:08:00",
      }),
    ],
    [override()],
  );
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].occurrences.length, 2);
  assert.equal(summaries[0].meetings.length, 1);
  assert.equal(summaries[0].changedCount, 1);
});

test("summaries remain one row for each stable course id", () => {
  const summaries = summarizeCourseChanges(
    [course(), course({ id: "course-b", name: "高等数学" })],
    [occurrence(), occurrence({ courseId: "course-b", occurrenceKey: "course-b-occurrence" })],
    [],
  );
  assert.deepEqual(summaries.map((item) => item.course.id).sort(), ["course-a", "course-b"]);
});

test("one course keeps every occurrence for the detail picker", () => {
  const occurrences = Array.from({ length: 16 }, (_, index) =>
    occurrence({
      date: `2026-09-${String(index + 1).padStart(2, "0")}`,
      teachingWeek: index + 1,
      occurrenceKey: `course-a-occurrence-${index + 1}`,
    }),
  );
  const [summary] = summarizeCourseChanges([course()], occurrences, []);
  assert.equal(summary.occurrences.length, 16);
});
