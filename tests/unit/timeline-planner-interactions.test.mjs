import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeFreeTimeIntervals,
  effectiveOccupancy,
  findTimelineConflicts,
  formatTimelineMinute,
  moveTimelineInterval,
  resizeTimelineInterval,
} from "../../src/application/timeline/planner-interactions.ts";

function item(id, startTime, endTime, overrides = {}) {
  return {
    id,
    sourceType: "plannerEvent",
    sourceRef: { type: "plannerEvent", id },
    date: "2026-09-24",
    startTime,
    endTime,
    title: id,
    location: null,
    status: "normal",
    editable: true,
    draggable: true,
    resizable: true,
    occupiesTime: true,
    warnings: [],
    ...overrides,
  };
}

test("effective occupancy applies buffers without changing actual timeline time", () => {
  const event = item("event", "14:00", "15:00", {
    bufferBeforeMinutes: 10,
    bufferAfterMinutes: 15,
  });
  assert.deepEqual(effectiveOccupancy(event), { startMinute: 830, endMinute: 915 });
  assert.equal(event.startTime, "14:00");
  assert.equal(event.endTime, "15:00");
});

test("conflicts include buffer overlaps, exclude touching intervals and self", () => {
  const buffered = item("buffered", "14:00", "15:00", { bufferAfterMinutes: 15 });
  const actualOverlap = item("actual", "15:05", "16:00");
  const adjacent = item("adjacent", "15:15", "16:00");
  assert.deepEqual(findTimelineConflicts([buffered], actualOverlap), [buffered]);
  assert.deepEqual(findTimelineConflicts([buffered], adjacent), []);
  assert.deepEqual(findTimelineConflicts([buffered], { ...buffered, title: "edited" }), []);
});

test("cancelled and non-occupying items do not conflict or consume free time", () => {
  const cancelled = item("cancelled", "09:00", "10:00", {
    status: "cancelled",
    occupiesTime: false,
  });
  const candidate = item("candidate", "09:15", "09:45");
  assert.deepEqual(findTimelineConflicts([cancelled], candidate), []);
  assert.deepEqual(computeFreeTimeIntervals([cancelled]), [{ startMinute: 0, endMinute: 1440 }]);
});

test("free time merges overlapping and adjacent effective intervals and clips day bounds", () => {
  const intervals = [
    item("first", "00:05", "01:00", { bufferBeforeMinutes: 10, bufferAfterMinutes: 10 }),
    item("second", "01:10", "02:00"),
    item("last", "23:30", "24:00", { bufferAfterMinutes: 30 }),
  ];
  assert.deepEqual(computeFreeTimeIntervals(intervals), [{ startMinute: 120, endMinute: 1410 }]);
});

test("drag snaps to five-minute deltas and clamps to the same day", () => {
  assert.deepEqual(moveTimelineInterval(600, 660, 13), {
    startMinute: 615,
    endMinute: 675,
  });
  assert.deepEqual(moveTimelineInterval(1380, 1440, 100), {
    startMinute: 1380,
    endMinute: 1440,
  });
  assert.deepEqual(moveTimelineInterval(0, 30, -100), { startMinute: 0, endMinute: 30 });
});

test("resize snaps, preserves a five-minute minimum, and clamps at 00:00/24:00", () => {
  assert.deepEqual(resizeTimelineInterval(600, 660, "start", 100), {
    startMinute: 655,
    endMinute: 660,
  });
  assert.deepEqual(resizeTimelineInterval(600, 660, "end", -100), {
    startMinute: 600,
    endMinute: 605,
  });
  assert.deepEqual(resizeTimelineInterval(0, 30, "start", -100), {
    startMinute: 0,
    endMinute: 30,
  });
  assert.deepEqual(resizeTimelineInterval(1380, 1430, "end", 100), {
    startMinute: 1380,
    endMinute: 1440,
  });
  assert.equal(formatTimelineMinute(1440), "24:00");
});
