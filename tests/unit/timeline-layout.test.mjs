import assert from "node:assert/strict";
import { test } from "node:test";
import {
  layoutTimelineItems,
  timeToDayMinute,
  TIMELINE_DAY_MINUTES,
  TIMELINE_MIN_ITEM_HEIGHT,
} from "../../src/application/timeline/timeline-layout.ts";

function item(id, startTime, endTime, overrides = {}) {
  return {
    id,
    sourceType: "academicOccurrence",
    sourceRef: { type: "academicOccurrence", courseId: id, date: "2026-09-23" },
    date: "2026-09-23",
    startTime,
    endTime,
    title: id,
    location: null,
    status: "normal",
    editable: false,
    draggable: false,
    resizable: false,
    occupiesTime: true,
    warnings: [],
    ...overrides,
  };
}

test("timeline spans 00:00 through 24:00 at one pixel per minute with hour and half-hour ticks", () => {
  const layout = layoutTimelineItems([]);
  assert.equal(layout.height, TIMELINE_DAY_MINUTES);
  assert.equal(layout.ticks.length, 49);
  assert.deepEqual(layout.ticks[0], { minute: 0, label: "00:00", kind: "hour" });
  assert.deepEqual(layout.ticks[1], { minute: 30, label: null, kind: "half-hour" });
  assert.deepEqual(layout.ticks.at(-1), {
    minute: 1440,
    label: "24:00",
    kind: "end",
  });
});

test("a single item and adjacent intervals keep their time proportions and share one lane", () => {
  const layout = layoutTimelineItems([item("a", "08:00", "08:45"), item("b", "08:45", "09:30")]);
  assert.deepEqual(
    layout.placements.map(({ id, top, height, lane, laneCount }) => ({
      id,
      top,
      height,
      lane,
      laneCount,
    })),
    [
      { id: "a", top: 480, height: 45, lane: 0, laneCount: 1 },
      { id: "b", top: 525, height: 45, lane: 0, laneCount: 1 },
    ],
  );
});

test("two and three simultaneous intervals receive equal horizontal lanes", () => {
  const two = layoutTimelineItems([item("a", "09:00", "10:00"), item("b", "09:15", "09:45")]);
  assert.deepEqual(
    two.placements.map(({ lane, laneCount, leftPercent, widthPercent }) => ({
      lane,
      laneCount,
      leftPercent,
      widthPercent,
    })),
    [
      { lane: 0, laneCount: 2, leftPercent: 0, widthPercent: 50 },
      { lane: 1, laneCount: 2, leftPercent: 50, widthPercent: 50 },
    ],
  );

  const three = layoutTimelineItems([
    item("a", "09:00", "10:00"),
    item("b", "09:10", "09:50"),
    item("c", "09:20", "09:40"),
  ]);
  assert.ok(three.placements.every((placement) => placement.laneCount === 3));
  assert.ok(
    three.placements.every((placement) => Math.abs(placement.widthPercent - 100 / 3) < 0.001),
  );
});

test("contained intervals and overlap chains receive deterministic non-overlapping lanes", () => {
  const layout = layoutTimelineItems([
    item("outer", "08:00", "10:00"),
    item("inner", "08:30", "09:00"),
    item("chain", "09:45", "10:30"),
  ]);
  assert.deepEqual(
    layout.placements.map((placement) => placement.lane),
    [0, 1, 1],
  );
  assert.deepEqual(
    layout.placements.map((placement) => placement.laneCount),
    [2, 2, 2],
  );
});

test("day boundaries and short visual intervals are clipped without changing source times", () => {
  const short = item("short", "23:50", "24:00");
  const layout = layoutTimelineItems([short]);
  assert.deepEqual(layout.placements[0], {
    id: "short",
    top: 1430,
    height: 10,
    leftPercent: 0,
    widthPercent: 100,
    lane: 0,
    laneCount: 1,
  });
  assert.equal(short.endTime, "24:00");
  assert.equal(TIMELINE_MIN_ITEM_HEIGHT, 24);
  assert.equal(timeToDayMinute("24:00", true), 1440);
  assert.equal(timeToDayMinute("24:00"), null);
});

test("invalid, reversed, and out-of-day items are skipped with explicit warnings", () => {
  const layout = layoutTimelineItems([
    item("invalid", "08:75", "09:00"),
    item("reversed", "11:00", "10:00"),
    item("outside", "23:30", "25:00"),
  ]);
  assert.deepEqual(layout.placements, []);
  assert.deepEqual(
    layout.warnings.map((warning) => warning.itemId),
    ["invalid", "reversed", "outside"],
  );
});
