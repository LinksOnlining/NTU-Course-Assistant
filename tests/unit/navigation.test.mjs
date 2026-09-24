import test from "node:test";
import assert from "node:assert/strict";
import {
  createAcademicOccurrenceTarget,
  createAcademicScheduleTarget,
  createAcademicTaskTarget,
  createExamTarget,
  createWorkspaceHomeTarget,
  createWorkspaceScheduleTarget,
  createWorkspaceSearchTarget,
  createWorkspaceTasksTarget,
  getAcademicHubTab,
  getShellRouteView,
  isAcademicRoute,
  isWorkspaceRoute,
  routeForAcademicHubTab,
  routeForProductMode,
} from "../../src/navigation/navigation.ts";

test("workspace home and academic schedule targets use typed routes", () => {
  assert.deepEqual(createWorkspaceHomeTarget(), {
    route: { area: "workspace", page: "home" },
  });
  assert.deepEqual(createAcademicScheduleTarget(), {
    route: { area: "academic", page: "schedule" },
  });
  assert.deepEqual(createWorkspaceTasksTarget(), {
    route: { area: "workspace", page: "tasks" },
  });
  assert.deepEqual(createWorkspaceScheduleTarget(), {
    route: { area: "workspace", page: "schedule" },
  });
  assert.deepEqual(createWorkspaceSearchTarget(), {
    route: { area: "workspace", page: "search" },
  });
});

test("area guards distinguish workspace and academic routes", () => {
  assert.equal(isWorkspaceRoute(createWorkspaceHomeTarget().route), true);
  assert.equal(isAcademicRoute(createWorkspaceHomeTarget().route), false);
  assert.equal(isAcademicRoute(createAcademicScheduleTarget().route), true);
  assert.equal(isWorkspaceRoute(createAcademicScheduleTarget().route), false);
});

test("existing Academic Tasks remains on an explicitly legacy route", () => {
  assert.deepEqual(createAcademicTaskTarget("academic-task-1"), {
    route: { area: "academic", page: "tasks-legacy" },
    object: { type: "academicTask", id: "academic-task-1" },
  });
});

test("exam target carries a stable exam object reference", () => {
  assert.deepEqual(createExamTarget("exam-1"), {
    route: { area: "academic", page: "exams" },
    object: { type: "exam", id: "exam-1" },
  });
});

test("academic occurrence reference uses course ID and canonical date, not occurrenceKey", () => {
  const date = "2026-09-23";
  const target = createAcademicOccurrenceTarget("course-1", date);
  assert.deepEqual(target, {
    route: { area: "academic", page: "schedule" },
    object: { type: "academicOccurrence", courseId: "course-1", date },
    date,
  });
  assert.equal("id" in target.object, false);
});

test("navigation target supports route, object, and date together", () => {
  const date = "2026-09-23";
  const target = {
    route: { area: "academic", page: "exams" },
    object: { type: "exam", id: "exam-1" },
    date,
  };
  assert.deepEqual(target, {
    route: { area: "academic", page: "exams" },
    object: { type: "exam", id: "exam-1" },
    date,
  });
});

test("AcademicHub tabs map to and from the unified AppRoute", () => {
  const cases = [
    ["today", { area: "workspace", page: "home" }],
    ["changes", { area: "academic", page: "changes" }],
    ["tasks", { area: "academic", page: "tasks-legacy" }],
    ["exams", { area: "academic", page: "exams" }],
    ["semesters", { area: "academic", page: "semesters" }],
  ];

  for (const [tab, route] of cases) {
    assert.deepEqual(routeForAcademicHubTab(tab), route);
    assert.equal(getAcademicHubTab(route), tab);
  }
  assert.equal(getAcademicHubTab({ area: "workspace", page: "tasks" }), null);
  assert.equal(getAcademicHubTab({ area: "academic", page: "schedule" }), null);
});

test("product mode remembers the last Academic page and defaults to the schedule", () => {
  const changes = { area: "academic", page: "changes" };
  assert.deepEqual(routeForProductMode("workspace", changes), createWorkspaceHomeTarget().route);
  assert.deepEqual(routeForProductMode("academic", null), createAcademicScheduleTarget().route);
  assert.deepEqual(routeForProductMode("academic", changes), changes);
});

test("implemented workspace routes resolve to page content; future routes stay unsupported", () => {
  assert.equal(getShellRouteView({ area: "workspace", page: "home" }), "workspace-home");
  assert.equal(getShellRouteView({ area: "workspace", page: "schedule" }), "workspace-schedule");
  assert.equal(getShellRouteView({ area: "workspace", page: "tasks" }), "workspace-tasks");
  assert.equal(getShellRouteView({ area: "academic", page: "schedule" }), "academic-schedule");
  assert.equal(getShellRouteView({ area: "academic", page: "exams" }), "academic-hub");
  assert.equal(getShellRouteView({ area: "academic", page: "tasks-legacy" }), "academic-hub");
  assert.equal(getShellRouteView({ area: "workspace", page: "diary" }), "workspace-diary");
  assert.equal(getShellRouteView({ area: "workspace", page: "inbox" }), "workspace-inbox");
  assert.equal(getShellRouteView({ area: "workspace", page: "search" }), "workspace-search");
  assert.equal(getShellRouteView({ area: "settings", page: "main" }), "unsupported");
});
