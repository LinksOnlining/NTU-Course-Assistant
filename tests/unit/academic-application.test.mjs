import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadAcademicHubData,
  loadAcademicScheduleData,
  resolveAcademicOccurrences,
} from "../../src/application/academic/academic-application.ts";
import { resolveCourseOccurrences } from "../../src/core/course-occurrence.ts";

const activeSemester = {
  id: "semester-current",
  name: "当前学期",
  firstWeekMonday: "2026-09-07",
  totalWeeks: 16,
  timezone: "Asia/Shanghai",
  status: "ACTIVE",
  createdAt: "",
  updatedAt: "",
};

test("schedule loader returns courses, nullable period times, and storage warnings", async () => {
  const courses = [{ id: "course-1" }];
  const periodTimes = [{ period: 1, startTime: "08:00", endTime: "08:45" }];
  const warnings = ["课程数据提示"];
  const calls = [];
  const result = await loadAcademicScheduleData({
    async loadCourses() {
      calls.push("courses");
      return { courses, warnings };
    },
    async loadPeriodTimes() {
      calls.push("periodTimes");
      return periodTimes;
    },
  });

  assert.deepEqual(result, { courses, periodTimes, warnings });
  assert.deepEqual(calls.sort(), ["courses", "periodTimes"]);
});

test("schedule loader preserves read failures", async () => {
  const failure = new Error("课程读取失败");
  await assert.rejects(
    loadAcademicScheduleData({
      async loadCourses() {
        throw failure;
      },
      async loadPeriodTimes() {
        return null;
      },
    }),
    failure,
  );
});

test("hub loader reads active semester data and parallelizes its independent reads", async () => {
  const calls = [];
  const overrides = [{ id: "override-1" }];
  const tasks = [{ id: "task-1" }];
  const exams = [{ id: "exam-1" }];
  const data = await loadAcademicHubData(
    {},
    {
      async loadSemesters() {
        calls.push("semesters");
        return [activeSemester];
      },
      async loadCourseOverrides(semesterId) {
        calls.push(`overrides:${semesterId}`);
        return overrides;
      },
      async loadAcademicTasks(semesterId) {
        calls.push(`tasks:${semesterId}`);
        return tasks;
      },
      async loadExams(semesterId) {
        calls.push(`exams:${semesterId}`);
        return exams;
      },
    },
  );

  assert.deepEqual(data, { semesters: [activeSemester], overrides, tasks, exams });
  assert.equal(calls[0], "semesters");
  assert.deepEqual(calls.slice(1).sort(), [
    "exams:semester-current",
    "overrides:semester-current",
    "tasks:semester-current",
  ]);
});

test("hub loader honors selected and legacy fallback semester without inventing one for archived-only data", async () => {
  const loadedIds = [];
  const reader = {
    async loadSemesters() {
      return [activeSemester, { ...activeSemester, id: "semester-archived", status: "ARCHIVED" }];
    },
    async loadCourseOverrides(id) {
      loadedIds.push(id);
      return [];
    },
    async loadAcademicTasks(id) {
      loadedIds.push(id);
      return [];
    },
    async loadExams(id) {
      loadedIds.push(id);
      return [];
    },
  };

  await loadAcademicHubData({ semesterId: "semester-archived" }, reader);
  await loadAcademicHubData({ fallbackSemesterId: "legacy" }, reader);
  assert.equal(loadedIds.length, 6);
  assert.ok(loadedIds.slice(0, 3).every((id) => id === "semester-archived"));
  assert.ok(loadedIds.slice(3).every((id) => id === "semester-current"));

  const noActive = {
    ...reader,
    async loadSemesters() {
      return [{ ...activeSemester, status: "ARCHIVED" }];
    },
  };
  loadedIds.length = 0;
  const data = await loadAcademicHubData({ fallbackSemesterId: "legacy" }, noActive);
  assert.deepEqual(loadedIds, []);
  assert.deepEqual(data.overrides, []);
});

test("hub loader uses the legacy fallback only when no semester exists", async () => {
  const loadedIds = [];
  const reader = {
    async loadSemesters() {
      return [];
    },
    async loadCourseOverrides(id) {
      loadedIds.push(id);
      return [];
    },
    async loadAcademicTasks(id) {
      loadedIds.push(id);
      return [];
    },
    async loadExams(id) {
      loadedIds.push(id);
      return [];
    },
  };

  const data = await loadAcademicHubData({ fallbackSemesterId: "legacy" }, reader);
  assert.deepEqual(loadedIds, ["legacy", "legacy", "legacy"]);
  assert.deepEqual(data.semesters, []);
});

test("hub loader preserves storage errors", async () => {
  const failure = new Error("学习数据读取失败");
  await assert.rejects(
    loadAcademicHubData(
      {},
      {
        async loadSemesters() {
          return [activeSemester];
        },
        async loadCourseOverrides() {
          throw failure;
        },
        async loadAcademicTasks() {
          return [];
        },
        async loadExams() {
          return [];
        },
      },
    ),
    failure,
  );
});

test("application occurrence entry keeps the canonical resolver result", () => {
  const args = [[], activeSemester, [], undefined, []];
  assert.deepEqual(resolveAcademicOccurrences(...args), resolveCourseOccurrences(...args));
});
