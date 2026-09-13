import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWidgetViewModel } from "../../src/core/widget-view.ts";

const term = { firstWeekMonday: "2026-09-07", totalWeeks: 3, timezone: "Asia/Shanghai" };
const course = (id, weekday, startTime, classroom = "A101", weeks = [1]) => ({
  id,
  name: id,
  teacher: null,
  classroom,
  weekday,
  startPeriod: null,
  endPeriod: null,
  startTime,
  endTime: startTime === "08:00" ? "09:00" : "15:00",
  weeks,
});

test("widget today uses CourseOccurrence, sorts by time and keeps null classrooms empty", () => {
  const view = buildWidgetViewModel(
    [course("later", 3, "14:00", null), course("early", 3, "08:00"), course("other", 4, "08:00")],
    term,
    { date: "2026-09-09", time: "09:30" },
  );
  assert.equal(view.kind, "ready");
  assert.deepEqual(
    view.today.map((item) => [item.name, item.classroom, item.state]),
    [
      ["early", "A101", "ended"],
      ["later", null, "next"],
    ],
  );
  assert.equal(view.week[2].courses.length, 2);
  assert.equal(view.week[3].courses.length, 1);
});

test("widget reports no teaching week and produces stable empty day mappings", () => {
  assert.equal(
    buildWidgetViewModel([course("course", 1, "08:00")], term, {
      date: "2026-09-06",
      time: "08:00",
    }).kind,
    "outside-term",
  );
  assert.equal(
    buildWidgetViewModel([], null, { date: "2026-09-09", time: "08:00" }).kind,
    "missing-term",
  );
  const view = buildWidgetViewModel([], term, { date: "2026-09-09", time: "08:00" });
  assert.equal(view.kind, "ready");
  assert.deepEqual(
    view.week.map((day) => [day.label, day.courses.length]),
    [
      ["周一", 0],
      ["周二", 0],
      ["周三", 0],
      ["周四", 0],
      ["周五", 0],
      ["周六", 0],
      ["周日", 0],
    ],
  );
});
