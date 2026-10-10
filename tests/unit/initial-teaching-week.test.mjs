import assert from "node:assert/strict";
import test from "node:test";
import { initialTeachingWeek } from "../../src/core/initial-teaching-week.ts";

const term = { firstWeekMonday: "2026-09-07", totalWeeks: 18, timezone: "Asia/Shanghai" };

test("no saved term does not leak development fixture week into production", () => {
  assert.equal(initialTeachingWeek("2026-10-10", null), 1);
  assert.equal(initialTeachingWeek("2026-10-10", null, 3), 3);
});

test("current week is derived from the real term instead of fixed week three", () => {
  assert.equal(initialTeachingWeek("2026-09-07", term), 1);
  assert.equal(initialTeachingWeek("2026-10-10", term), 5);
  assert.equal(initialTeachingWeek("2026-09-27", term), 3);
  assert.equal(initialTeachingWeek("2026-09-06", term), 1);
});
