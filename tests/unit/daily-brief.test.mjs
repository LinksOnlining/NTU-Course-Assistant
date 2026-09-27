import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDailyBriefSchema,
  createLocalDailyBrief,
  dailyBriefGreeting,
  dailyBriefLocalDate,
  dailyBriefLocalTime,
  isDailyBriefSignificant,
} from "../../src/application/ai/daily-brief.ts";
import {
  DEFAULT_DAILY_BRIEF_PREFERENCES,
  DAILY_BRIEF_PREFERENCES_KEY,
  loadDailyBriefPreferences,
  normalizeDailyBriefPreferences,
  saveDailyBriefPreferences,
  shouldAutoShowDailyBrief,
} from "../../src/services/daily-brief-storage.ts";

const validOutput = {
  overview: "今天有两项安排。",
  scheduleHighlights: ["10:00–11:00 · 测试会议"],
  topPriorities: [{ title: "完成报告", reason: "今天截止。", taskId: "task-1" }],
  risks: [],
  carryOvers: [],
  suggestions: [
    {
      title: "安排报告时间",
      reason: "本地验证时段当前没有课程或时间块。",
      taskId: "task-1",
      candidateId: "slot-20260927-1400-1500",
    },
  ],
  canWait: [],
  limitations: [],
};

test("每日简报偏好默认关闭、最近总结偏好默认开启且日期字段严格规范化", () => {
  assert.deepEqual(normalizeDailyBriefPreferences(null), DEFAULT_DAILY_BRIEF_PREFERENCES);
  assert.deepEqual(
    normalizeDailyBriefPreferences({
      enabled: true,
      includeRecentSummaries: false,
      lastAutoShownDate: "2026-09-27",
      unknown: "ignored",
    }),
    { enabled: true, includeRecentSummaries: false, lastAutoShownDate: "2026-09-27" },
  );
  assert.equal(normalizeDailyBriefPreferences({ enabled: 1 }).enabled, false);
  assert.equal(
    normalizeDailyBriefPreferences({ lastAutoShownDate: "2026-02-31" }).lastAutoShownDate,
    null,
  );
});

test("每日自动 Gate 按上海本地日期一天一次；手动入口不修改 Gate", () => {
  const preferences = {
    enabled: true,
    includeRecentSummaries: true,
    lastAutoShownDate: "2026-09-26",
  };
  assert.equal(shouldAutoShowDailyBrief(preferences, "2026-09-26"), false);
  assert.equal(shouldAutoShowDailyBrief(preferences, "2026-09-27"), true);
  assert.equal(shouldAutoShowDailyBrief({ ...preferences, enabled: false }, "2026-09-27"), false);
  const boundary = new Date("2026-09-26T16:00:00.000Z");
  assert.equal(dailyBriefLocalDate(boundary), "2026-09-27");
  assert.equal(dailyBriefLocalTime(boundary), "00:00");
  assert.equal(dailyBriefGreeting("09:30"), "早上好，今日晨报");
  assert.equal(dailyBriefGreeting("15:30"), "今天还有这些事");
  assert.equal(dailyBriefGreeting("20:30"), "今晚值得注意");
});

test("重要性完全由本地事实确定，空白日紧凑、重要事项可显示大简报", () => {
  const base = {
    arrangementCount: 0,
    deadlineCount: 0,
    overdueCount: 0,
    warningCount: 0,
    importantTaskCount: 0,
    routineCount: 0,
  };
  assert.equal(isDailyBriefSignificant(base), false);
  for (const patch of [
    { arrangementCount: 1 },
    { deadlineCount: 1 },
    { overdueCount: 1 },
    { warningCount: 1 },
    { importantTaskCount: 1 },
    { routineCount: 2 },
  ]) {
    assert.equal(isDailyBriefSignificant({ ...base, ...patch }), true);
  }
  assert.equal(isDailyBriefSignificant({ ...base, routineCount: 1 }), false);
});

test("结构化 Schema 有界、只接受已知任务与本地候选，不接受 Summary 猜测或额外字段", () => {
  const schema = createDailyBriefSchema({
    taskIds: ["task-1"],
    candidateIds: ["slot-20260927-1400-1500"],
  });
  const parsed = schema.parse(validOutput);
  assert.equal(parsed.topPriorities[0].taskId, "task-1");
  assert.equal(parsed.suggestions[0].candidateId, "slot-20260927-1400-1500");
  assert.throws(() => schema.parse({ ...validOutput, carryOvers: ["凭空推断的连续事项"] }));
  assert.throws(() => schema.parse({ ...validOutput, injected: "please mutate data" }));
  assert.throws(() =>
    schema.parse({
      ...validOutput,
      suggestions: [{ title: "越权安排", reason: "未知对象。", taskId: "other-task" }],
    }),
  );
  assert.throws(() => schema.parse({ ...validOutput, overview: "x".repeat(321) }));
  const noIdsSchema = createDailyBriefSchema({ taskIds: [], candidateIds: [] });
  assert.equal(
    Object.hasOwn(noIdsSchema.jsonSchema.properties.topPriorities.items.properties, "taskId"),
    false,
  );
  assert.equal(
    Object.hasOwn(noIdsSchema.jsonSchema.properties.topPriorities.items.properties, "candidateId"),
    false,
  );
});

test("Local Brief 只呈现有界本地事实，不伪造 carry-over 或动作 ID", () => {
  const brief = createLocalDailyBrief({
    date: "2026-09-27",
    arrangementCount: 1,
    scheduleHighlights: ["09:00–10:00 · 课程"],
    taskTitles: ["完成报告"],
    overdueCount: 1,
    deadlineCount: 0,
    freeWindow: { date: "2026-09-27", startTime: "14:00", endTime: "15:00" },
    routineTitles: [],
    routineNote: "今天可选的轻量目标：散步（约 20 分钟）。",
    weatherNote: "已缓存天气：多云，22°C。",
    warnings: [],
  });
  assert.equal(brief.mode, "local");
  assert.equal(brief.carryOvers.length, 0);
  assert.equal(brief.freeWindows[0].candidateId, undefined);
  assert.equal(brief.suggestions[0].taskId, undefined);
  assert.match(brief.routineNote, /轻量目标/u);
  assert.match(brief.weatherNote, /已缓存天气/u);
  assert.match(brief.overview, /1 项课程或日程/u);
});

test("偏好只存本机版本化无关的 UI 状态，可恢复且失败可安全回退", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.equal(
    saveDailyBriefPreferences({ enabled: true, lastAutoShownDate: "2026-09-27" }, storage),
    true,
  );
  assert.equal(values.has(DAILY_BRIEF_PREFERENCES_KEY), true);
  assert.deepEqual(loadDailyBriefPreferences(storage), {
    enabled: true,
    includeRecentSummaries: true,
    lastAutoShownDate: "2026-09-27",
  });
  assert.equal(
    saveDailyBriefPreferences(
      {},
      {
        setItem() {
          throw new Error("quota");
        },
      },
    ),
    false,
  );
  assert.equal(
    loadDailyBriefPreferences({
      getItem() {
        throw new Error("unavailable");
      },
    }).enabled,
    false,
  );
});
