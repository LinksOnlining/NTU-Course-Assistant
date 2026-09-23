import assert from "node:assert/strict";
import { test } from "node:test";
import { projectAcademicOccurrencesToTimelineItems } from "../../src/application/timeline/academic-timeline.ts";

const course = {
  id: "course-a",
  name: "数学基础",
  teacher: "教师甲",
  classroom: "A101",
  weekday: 3,
  startPeriod: 1,
  endPeriod: 2,
  startTime: "08:00",
  endTime: "09:35",
  weeks: [1],
};

function occurrence(overrides = {}) {
  return {
    courseId: "course-a",
    semesterId: "semester-a",
    date: "2026-09-23",
    teachingWeek: 1,
    weekday: 3,
    startPeriod: 1,
    endPeriod: 2,
    startTime: "08:00",
    endTime: "09:35",
    room: "A101",
    teacher: "教师甲",
    status: "NORMAL",
    source: "BASE",
    originalOccurrenceKey: null,
    occurrenceKey: "mutable-clock-key",
    appliedOverrideId: null,
    appliedOverrideKind: null,
    ...overrides,
  };
}

test("Academic occurrence projects canonical fields and stable Course+date identity", () => {
  const [item] = projectAcademicOccurrencesToTimelineItems([occurrence()], [course]);
  assert.deepEqual(item, {
    id: "academic:course-a:2026-09-23",
    sourceType: "academicOccurrence",
    sourceRef: { type: "academicOccurrence", courseId: "course-a", date: "2026-09-23" },
    date: "2026-09-23",
    startTime: "08:00",
    endTime: "09:35",
    title: "数学基础",
    location: "A101",
    status: "normal",
    editable: false,
    draggable: false,
    resizable: false,
    occupiesTime: true,
    warnings: [],
  });
  assert.doesNotMatch(item.id, /mutable-clock-key|08:00/u);
});

test("cancelled, rescheduled, makeup, and room-change data remain canonical projections", () => {
  const items = projectAcademicOccurrencesToTimelineItems(
    [
      occurrence({ status: "CANCELLED", source: "OVERRIDE", appliedOverrideId: "cancel-1" }),
      occurrence({
        date: "2026-09-24",
        status: "RESCHEDULED",
        source: "OVERRIDE",
        appliedOverrideId: "move-1",
        startTime: "13:00",
        endTime: "14:00",
        room: "B202",
      }),
      occurrence({
        date: "2026-09-24",
        status: "MAKEUP",
        source: "OVERRIDE",
        appliedOverrideId: "makeup-1",
        startTime: "15:00",
        endTime: "16:00",
      }),
    ],
    [course],
  );

  assert.equal(items[0].status, "cancelled");
  assert.equal(items[0].occupiesTime, false);
  assert.equal(items[1].status, "rescheduled");
  assert.equal(items[1].startTime, "13:00");
  assert.equal(items[1].location, "B202");
  assert.equal(items[2].status, "makeup");
  assert.equal(items[2].startTime, "15:00");
  assert.ok(items.every((item) => !item.editable && !item.draggable && !item.resizable));
});

test("same-course same-day makeup gets a stable projection suffix without clock identity", () => {
  const items = projectAcademicOccurrencesToTimelineItems(
    [
      occurrence({ status: "CANCELLED", source: "OVERRIDE", appliedOverrideId: "cancel-1" }),
      occurrence({
        status: "MAKEUP",
        source: "OVERRIDE",
        appliedOverrideId: "makeup-1",
        startTime: "15:00",
        endTime: "16:00",
      }),
    ],
    [course],
  );

  assert.deepEqual(
    items.map((item) => item.id),
    [
      "academic:course-a:2026-09-23:override:cancel-1",
      "academic:course-a:2026-09-23:override:makeup-1",
    ],
  );
});

test("missing Course title is visible as a warning instead of silently dropping the item", () => {
  const [item] = projectAcademicOccurrencesToTimelineItems([occurrence()], []);
  assert.equal(item.title, "课程");
  assert.deepEqual(item.warnings, ["未找到对应课程名称。"]);
});
