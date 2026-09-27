import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDailySummaryDraft,
  deriveDailySummaryCarryOvers,
  getDailySummaryByDate,
  getRecentDailySummaries,
  recentDailySummaryRange,
  saveDailySummary,
  validateDailySummaryDraft,
} from "../../src/application/workspace/daily-summary.ts";

const summary = (date, values = {}) => ({
  id: `summary-${date}`,
  summaryDate: date,
  overview: "当天概览",
  highlights: [],
  unfinished: [],
  tomorrowNotes: [],
  createdAt: "2026-09-27T12:00:00.000Z",
  updatedAt: "2026-09-27T12:00:00.000Z",
  revision: 1,
  ...values,
});

test("本地总结草稿只记录实际完成状态并归纳学业、日程和次日例行提醒", () => {
  const draft = createDailySummaryDraft({
    date: "2026-09-27",
    now: new Date("2026-09-27T12:00:00.000Z"),
    id: "local-draft",
    arrangements: [
      {
        id: "course",
        title: "数学课",
        startTime: "09:00",
        endTime: "10:00",
        sourceLabel: "课程",
        cancelled: false,
      },
      {
        id: "cancelled",
        title: "取消课程",
        startTime: "10:00",
        endTime: "11:00",
        sourceLabel: "课程",
        cancelled: true,
      },
    ],
    timelineItems: [
      { id: "tomorrow-event", title: "项目讨论", date: "2026-09-28", startTime: "14:00" },
    ],
    personalTasks: [
      {
        id: "done",
        title: "已完成任务",
        status: "completed",
        completedAt: "2026-09-27T08:00:00.000Z",
      },
      {
        id: "not-done-today",
        title: "此前完成任务",
        status: "completed",
        completedAt: "2026-09-26T08:00:00.000Z",
      },
      { id: "open", title: "个人待办", status: "open", deadlineDate: "2026-09-28" },
    ],
    academicTasks: [
      {
        id: "academic-done",
        title: "完成实验",
        status: "COMPLETED",
        completedAt: "2026-09-27T09:00:00.000Z",
        dueAt: "2026-09-28T00:00:00.000Z",
      },
      {
        id: "academic-open",
        title: "未交作业",
        status: "TODO",
        completedAt: null,
        dueAt: "2026-09-28T00:00:00.000Z",
      },
    ],
    routines: [
      { id: "routine", title: "晨间阅读", enabled: true, weekdaysMask: 1 << 0 },
      { id: "disabled-routine", title: "关闭的习惯", enabled: false, weekdaysMask: 1 << 0 },
    ],
  });

  assert.equal(draft.id, "local-draft");
  assert.deepEqual(draft.highlights, ["已完成任务", "完成实验"]);
  assert.deepEqual(draft.unfinished, ["个人待办", "未交作业"]);
  assert.ok(draft.tomorrowNotes.includes("待办：个人待办"));
  assert.ok(draft.tomorrowNotes.includes("学业事项：未交作业"));
  assert.ok(draft.tomorrowNotes.includes("日程：14:00 项目讨论"));
  assert.ok(draft.tomorrowNotes.includes("例行提醒（未排期）：晨间阅读"));
  assert.ok(!draft.tomorrowNotes.some((note) => note.includes("关闭的习惯")));
  assert.match(draft.overview, /1 项课程或日程/u);
  assert.equal(validateDailySummaryDraft(draft), null);
});

test("完成时间按用户本地日历日期归入总结", () => {
  const completedAt = new Date(2026, 8, 27, 0, 15).toISOString();
  const draft = createDailySummaryDraft({
    date: "2026-09-27",
    now: new Date(2026, 8, 27, 12),
    arrangements: [],
    timelineItems: [],
    personalTasks: [
      { id: "local-day", title: "本地当天", status: "completed", completedAt },
      {
        id: "previous-day",
        title: "前一天",
        status: "completed",
        completedAt: new Date(2026, 8, 26, 23, 45).toISOString(),
      },
    ],
    academicTasks: [],
  });

  assert.deepEqual(draft.highlights, ["本地当天"]);
});

test("每日总结校验拒绝无效日历日期、空概览和超出上限的字段", () => {
  const base = summary("2026-09-27");
  assert.match(validateDailySummaryDraft({ ...base, summaryDate: "2026-02-30" }), /日期无效/u);
  assert.match(validateDailySummaryDraft({ ...base, overview: " " }), /概览不能为空/u);
  assert.match(
    validateDailySummaryDraft({ ...base, highlights: Array(9).fill("事项") }),
    /最多 8 条/u,
  );
  assert.match(validateDailySummaryDraft({ ...base, unfinished: ["x".repeat(181)] }), /最多 8 条/u);
  assert.equal(
    validateDailySummaryDraft({ ...base, highlights: [], unfinished: [], tomorrowNotes: [] }),
    null,
  );
});

test("近期总结严格采用前三个日历日期窗口，跳过缺失日且排除 D-4", () => {
  assert.deepEqual(recentDailySummaryRange("2026-09-27"), {
    from: "2026-09-24",
    to: "2026-09-26",
  });
});

test("Recent Summary projection sorts newest first, omits D-4/current date and bounds fields", async () => {
  const queried = [];
  const repository = {
    async loadDailySummary() {
      return null;
    },
    async loadDailySummariesInRange(from, to) {
      queried.push([from, to]);
      return [
        summary("2026-09-23", { overview: "D-4" }),
        summary("2026-09-24", { overview: "older" }),
        summary("2026-09-26", { overview: "newer", highlights: ["h".repeat(200)] }),
        summary("2026-09-27", { overview: "today" }),
      ];
    },
    async saveDailySummary(value) {
      return value;
    },
  };
  const recent = await getRecentDailySummaries("2026-09-27", repository);
  assert.deepEqual(queried, [["2026-09-24", "2026-09-26"]]);
  assert.deepEqual(
    recent.map((item) => item.summaryDate),
    ["2026-09-26", "2026-09-24"],
  );
  assert.equal(recent[0].highlights[0].length, 100);
  assert.equal("id" in recent[0], false);
  assert.ok(new TextEncoder().encode(JSON.stringify(recent)).byteLength <= 8_192);
});

test("Daily Brief carry-over needs yesterday's summary and an exact currently open task", () => {
  const older = summary("2026-09-24", {
    unfinished: ["实验报告"],
    tomorrowNotes: ["待办：实验报告", "日程：14:00 讨论"],
  });
  assert.deepEqual(deriveDailySummaryCarryOvers("2026-09-27", [older], ["实验报告"]), []);
  const yesterday = summary("2026-09-26", {
    unfinished: ["实验报告"],
    tomorrowNotes: ["待办：实验报告", "例行提醒（未排期）：晨间阅读"],
  });
  assert.deepEqual(deriveDailySummaryCarryOvers("2026-09-27", [yesterday, older], ["实验报告"]), [
    "继续推进：实验报告",
  ]);
  assert.deepEqual(deriveDailySummaryCarryOvers("2026-09-27", [yesterday], []), []);
});

test("Application summary use cases validate before repository access and use injected repository", async () => {
  const calls = [];
  const saved = summary("2026-09-27");
  const repository = {
    async loadDailySummary(date) {
      calls.push(["get", date]);
      return saved;
    },
    async loadDailySummariesInRange(from, to) {
      calls.push(["range", from, to]);
      return [];
    },
    async saveDailySummary(value) {
      calls.push(["save", value]);
      return value;
    },
  };
  assert.equal(await getDailySummaryByDate("2026-09-27", repository), saved);
  assert.equal(await saveDailySummary(saved, repository), saved);
  await assert.rejects(getDailySummaryByDate("2026-02-30", repository), /日期无效/u);
  await assert.rejects(saveDailySummary({ ...saved, overview: "" }, repository), /概览不能为空/u);
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ["get", "save"],
  );
});
