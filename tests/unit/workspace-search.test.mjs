import assert from "node:assert/strict";
import { test } from "node:test";
import {
  loadWorkspaceSearchData,
  searchWorkspace,
} from "../../src/application/workspace/search.ts";

function course(id, name, overrides = {}) {
  return {
    id,
    name,
    teacher: null,
    classroom: null,
    weekday: 1,
    startPeriod: null,
    endPeriod: null,
    startTime: "09:00",
    endTime: "09:45",
    weeks: [1],
    ...overrides,
  };
}

function searchData(overrides = {}) {
  return {
    academic: {
      schedule: { courses: [], periodTimes: [], warnings: [] },
      tasks: [],
      exams: [],
    },
    personalTasks: [],
    plannerEvents: [],
    diaryEntries: [],
    inboxItems: [],
    ...overrides,
  };
}

test("本机搜索使用 Unicode NFKC 与不区分大小写，并按标题匹配强度排序", () => {
  const data = searchData({
    academic: {
      schedule: {
        courses: [
          course("exact", "Ｒｅｐｏｒｔ"),
          course("prefix", "Report Writing"),
          course("contains", "Quarterly Report"),
          course("metadata", "其他课程", { teacher: "Report Instructor" }),
        ],
        periodTimes: [],
        warnings: [],
      },
      tasks: [],
      exams: [],
    },
  });

  assert.deepEqual(
    searchWorkspace("REPORT", data).map((item) => item.id),
    ["exact", "prefix", "contains", "metadata"],
  );
});

test("搜索覆盖七类本地内容并返回对应稳定 ObjectRef 与真实页面", () => {
  const data = searchData({
    academic: {
      schedule: {
        courses: [course("course-1", "needle course")],
        periodTimes: [],
        warnings: [],
      },
      tasks: [
        {
          id: "academic-task-1",
          semesterId: "semester-1",
          courseId: "course-1",
          type: "ASSIGNMENT",
          title: "needle academic task",
          note: null,
          dueAt: "2026-09-24T12:00:00.000Z",
          priority: 0,
          status: "TODO",
          completedAt: null,
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      exams: [
        {
          id: "exam-1",
          semesterId: "semester-1",
          courseId: "course-1",
          title: "needle exam",
          startsAt: "2026-10-01T01:00:00.000Z",
          endsAt: null,
          location: "A101",
          seatInfo: null,
          note: null,
          status: "SCHEDULED",
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    },
    personalTasks: [
      {
        id: "personal-task-1",
        title: "needle personal task",
        description: null,
        status: "open",
        priority: "none",
        deadlineDate: null,
        deadlineTime: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        completedAt: null,
      },
    ],
    plannerEvents: [
      {
        id: "event-1",
        title: "needle event",
        description: null,
        date: "2026-09-24",
        startTime: "15:00",
        endTime: "16:00",
        location: null,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    diaryEntries: [
      {
        id: "diary-1",
        entryDate: "2026-09-24",
        body: "needle private diary text",
        createdAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T00:00:00.000Z",
      },
    ],
    inboxItems: [
      {
        id: "inbox-1",
        rawText: "needle private captured text",
        status: "pending",
        parseKind: null,
        parsePayloadJson: null,
        parserVersion: null,
        confirmedTargetType: null,
        confirmedTargetId: null,
        createdAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T00:00:00.000Z",
      },
    ],
  });

  const results = searchWorkspace("needle", data);
  assert.deepEqual(results.map((item) => item.category).sort(), [
    "academicTask",
    "course",
    "diaryEntry",
    "exam",
    "inboxItem",
    "personalTask",
    "plannerEvent",
  ]);
  assert.deepEqual(results.find((item) => item.id === "course-1").target, {
    route: { area: "academic", page: "schedule" },
    object: { type: "course", id: "course-1" },
  });
  assert.deepEqual(results.find((item) => item.id === "event-1").target, {
    route: { area: "workspace", page: "schedule" },
    object: { type: "plannerEvent", id: "event-1" },
    date: "2026-09-24",
  });
  assert.deepEqual(results.find((item) => item.id === "diary-1").target, {
    route: { area: "workspace", page: "diary" },
    object: { type: "diaryEntry", id: "diary-1" },
    date: "2026-09-24",
  });
  assert.match(results.find((item) => item.id === "diary-1").summary, /private diary/u);
  assert.equal("bodyText" in results.find((item) => item.id === "diary-1"), false);
  assert.equal(results.find((item) => item.id === "inbox-1").target.object.type, "inboxItem");
});

test("空查询不显示结果，结果上限为 50 且相同数据排序稳定", () => {
  const data = searchData({
    academic: {
      schedule: {
        courses: Array.from({ length: 60 }, (_, index) => course(`course-${index}`, "同名")),
        periodTimes: [],
        warnings: [],
      },
      tasks: [],
      exams: [],
    },
  });
  assert.deepEqual(searchWorkspace("   ", data), []);
  const first = searchWorkspace("同名", data);
  const second = searchWorkspace("同名", data);
  assert.equal(first.length, 50);
  assert.deepEqual(
    first.map((item) => item.id),
    second.map((item) => item.id),
  );
  assert.equal(searchWorkspace("同名", data, Number.NaN).length, 50);
});

test("搜索数据通过可替换的本地读取器收集，读取失败保持失败", async () => {
  const calls = [];
  const emptyAcademic = searchData().academic;
  const reader = Object.fromEntries(
    [
      ["loadAcademic", emptyAcademic],
      ["loadPersonalTasks", []],
      ["loadPlannerEvents", []],
      ["loadDiaryEntries", []],
      ["loadInboxItems", []],
    ].map(([name, result]) => [
      name,
      async () => {
        calls.push(name);
        return result;
      },
    ]),
  );
  const loaded = await loadWorkspaceSearchData(reader);
  assert.equal(calls.length, 5);
  assert.equal(loaded.academic, emptyAcademic);
  await assert.rejects(
    loadWorkspaceSearchData({
      ...reader,
      loadDiaryEntries: async () => {
        throw new Error("offline");
      },
    }),
    /offline/u,
  );
});
