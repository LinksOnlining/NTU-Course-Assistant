import assert from "node:assert/strict";
import { test } from "node:test";
import {
  exactOpenTaskMatch,
  findPlannerCandidateSlots,
  parseDurationMinutes,
  resolvePlannerInstruction,
  resolvePlannerTimeScope,
} from "../../src/application/ai/planner-assistant.ts";

const NOW = new Date("2026-09-26T02:00:00.000Z"); // Saturday, 10:00 Asia/Shanghai

function context({
  courses = [],
  exams = [],
  events = [],
  timeBlocks = [],
  tasks = [],
  truncatedModules = [],
} = {}) {
  return {
    moduleContexts: {
      academic: { courses, exams, deadlines: [] },
      planner: { tasks, events, timeBlocks },
    },
    budget: { truncatedModules },
  };
}

test("本地时间范围解析今天、相对日期、周范围、星期和明确日期", () => {
  assert.equal(resolvePlannerTimeScope("今晚", NOW).scope.startDate, "2026-09-26");
  assert.equal(resolvePlannerTimeScope("明天上午", NOW).scope.startDate, "2026-09-27");
  assert.deepEqual(
    [
      resolvePlannerTimeScope("明天上午", NOW).scope.windows[0],
      resolvePlannerTimeScope("明天下午", NOW).scope.windows[0],
      resolvePlannerTimeScope("明天晚上", NOW).scope.windows[0],
      resolvePlannerTimeScope("明天深夜", NOW).scope.windows[0],
    ].map(({ startMinute, endMinute }) => [startMinute, endMinute]),
    [
      [360, 720],
      [720, 1080],
      [1080, 1320],
      [1320, 1440],
    ],
  );
  assert.equal(resolvePlannerTimeScope("后天", NOW).scope.startDate, "2026-09-28");
  assert.deepEqual(
    [
      resolvePlannerTimeScope("本周", NOW).scope.startDate,
      resolvePlannerTimeScope("本周", NOW).scope.endDate,
    ],
    ["2026-09-26", "2026-09-27"],
  );
  assert.deepEqual(
    [
      resolvePlannerTimeScope("下周三", NOW).scope.startDate,
      resolvePlannerTimeScope("下周三", NOW).scope.endDate,
    ],
    ["2026-09-30", "2026-09-30"],
  );
  assert.deepEqual(
    [
      resolvePlannerTimeScope("周末", NOW).scope.startDate,
      resolvePlannerTimeScope("周末", NOW).scope.endDate,
    ],
    ["2026-09-26", "2026-09-27"],
  );
  assert.equal(resolvePlannerTimeScope("10月3日下午", NOW).scope.startDate, "2026-10-03");
  assert.equal(resolvePlannerTimeScope("10 月 3 日下午", NOW).scope.startDate, "2026-10-03");
  const exact = resolvePlannerTimeScope("明天晚上8点", NOW).scope;
  assert.equal(exact.exactStartMinute, 20 * 60);
  assert.equal(exact.dayPart, "evening");
  const nextWeekend = resolvePlannerTimeScope("下周末晚上", NOW).scope;
  assert.deepEqual([nextWeekend.startDate, nextWeekend.endDate], ["2026-10-03", "2026-10-04"]);
  assert.equal(nextWeekend.dayPart, "evening");
  const sunday = resolvePlannerTimeScope("周末晚上", new Date("2026-09-27T02:00:00.000Z")).scope;
  assert.deepEqual([sunday.startDate, sunday.endDate], ["2026-09-27", "2026-09-27"]);
  assert.equal(resolvePlannerTimeScope("明天下午19点", NOW).scope, undefined);
});

test("日期事实按注入时区计算，规划范围最多 31 天", () => {
  const laTomorrow = resolvePlannerTimeScope("明天晚上", NOW, "America/Los_Angeles").scope;
  assert.equal(laTomorrow.startDate, "2026-09-26");
  assert.equal(laTomorrow.absoluteStart, "2026-09-27T01:00:00.000Z");
  const justBeforeMidnight = new Date("2026-09-26T15:30:00.000Z"); // 23:30 Asia/Shanghai
  assert.equal(
    resolvePlannerTimeScope("明天上午", justBeforeMidnight).scope.startDate,
    "2026-09-27",
  );

  const today = resolvePlannerTimeScope("今天", NOW).scope.startDate;
  const within = new Date(`${today}T00:00:00.000Z`);
  within.setUTCDate(within.getUTCDate() + 31);
  const beyond = new Date(`${today}T00:00:00.000Z`);
  beyond.setUTCDate(beyond.getUTCDate() + 32);
  assert.ok(resolvePlannerTimeScope(within.toISOString().slice(0, 10), NOW).scope);
  assert.match(resolvePlannerTimeScope(beyond.toISOString().slice(0, 10), NOW).message, /31 天/u);
});

test("时长识别覆盖分钟、阿拉伯数字和中文小时，不猜未说明时长", () => {
  assert.equal(parseDurationMinutes("30 分钟"), 30);
  assert.equal(parseDurationMinutes("5 分钟"), 5);
  assert.equal(parseDurationMinutes("45分钟"), 45);
  assert.equal(parseDurationMinutes("1 小时"), 60);
  assert.equal(parseDurationMinutes("一小时"), 60);
  assert.equal(parseDurationMinutes("一个半小时"), 90);
  assert.equal(parseDurationMinutes("两小时"), 120);
  assert.equal(parseDurationMinutes("90 分钟"), 90);
  assert.equal(parseDurationMinutes("明天跑步"), null);
});

test("Planner 意图区分独立活动、已有任务、显式新任务、分析与澄清", () => {
  const event = resolvePlannerInstruction("明天晚上想跑 30 分钟", NOW);
  assert.equal(event.intent, "planEvent");
  assert.equal(event.title, "跑步");
  assert.equal(event.scope.startDate, "2026-09-27");
  assert.equal(event.scope.dayPart, "evening");
  assert.equal(event.durationMinutes, 30);
  const fullEventRequest = resolvePlannerInstruction("明天晚上想跑30分钟，帮我安排一下", NOW);
  assert.equal(fullEventRequest.intent, "planEvent");
  assert.equal(fullEventRequest.title, "跑步");
  assert.equal(fullEventRequest.scope.startDate, "2026-09-27");
  assert.equal(fullEventRequest.scope.dayPart, "evening");
  assert.equal(fullEventRequest.durationMinutes, 30);

  const task = resolvePlannerInstruction("明天下午给高数复习安排一小时", NOW);
  assert.equal(task.intent, "planExistingTask");
  assert.equal(task.taskQuery, "高数复习");
  assert.equal(task.durationMinutes, 60);
  for (const quotedTitle of ["“高数复习”", '"高数复习"', "高数复习"]) {
    assert.equal(
      resolvePlannerInstruction(`明天下午给${quotedTitle}安排1小时`, NOW).taskQuery,
      "高数复习",
    );
  }

  const findTaskTime = resolvePlannerInstruction("下周找两个小时写实验报告", NOW);
  assert.equal(findTaskTime.intent, "planExistingTask");
  assert.equal(findTaskTime.taskQuery, "写实验报告");
  assert.equal(findTaskTime.durationMinutes, 120);
  assert.equal(findTaskTime.scope.windows.length, 7);

  const activity = resolvePlannerInstruction("明天晚上参加讲座 45 分钟", NOW);
  assert.equal(activity.intent, "planEvent");
  assert.equal(activity.title, "参加讲座");

  const library = resolvePlannerInstruction("周六下午去图书馆两小时", NOW);
  assert.equal(library.intent, "planEvent");
  assert.equal(library.title, "去图书馆");
  assert.equal(library.durationMinutes, 120);

  const createTask = resolvePlannerInstruction("帮我记一个周五前交实验报告的任务", NOW);
  assert.equal(createTask.intent, "createTask");
  assert.equal(createTask.title, "交实验报告");
  assert.equal(createTask.deadlineDate, "2026-10-02");

  assert.equal(resolvePlannerInstruction("明天忙不忙", NOW).intent, "analyze");
  assert.equal(resolvePlannerInstruction("今天安排如何？请看看风险", NOW).intent, "analyze");
  assert.equal(resolvePlannerInstruction("明天有什么安排？", NOW).intent, "analyze");
  assert.equal(resolvePlannerInstruction("明天晚上跑步", NOW).intent, "clarification");
  assert.equal(resolvePlannerInstruction("明天帮我弄一下", NOW).intent, "clarification");
});

test("已有任务只接受规范化后的唯一 exact match，不猜相似标题", () => {
  const planner = {
    tasks: [
      { id: "task-1", title: "高数 复习", status: "open" },
      { id: "task-2", title: "已完成任务", status: "completed" },
    ],
  };
  assert.equal(exactOpenTaskMatch("高数复习", planner).task.id, "task-1");
  assert.equal(exactOpenTaskMatch("高数", planner).task, undefined);
  assert.equal(
    exactOpenTaskMatch("高数复习", {
      tasks: [...planner.tasks, { ...planner.tasks[0], id: "task-3" }],
    }).ambiguous,
    true,
  );
});

test("候选搜索避开未来课程与取消课程，并将缓冲计入占用冲突", () => {
  const scope = resolvePlannerTimeScope("周六下午", NOW).scope;
  const slots = findPlannerCandidateSlots({
    scope,
    durationMinutes: 30,
    now: NOW,
    context: context({
      courses: [
        { title: "课程", date: "2026-09-26", start: "12:00", end: "13:00", status: "normal" },
        { title: "停课", date: "2026-09-26", start: "13:00", end: "14:00", status: "cancelled" },
      ],
    }),
  });
  assert.equal(slots[0].startTime, "13:00");

  const exactScope = resolvePlannerTimeScope("明天 13:00", NOW).scope;
  const conflict = findPlannerCandidateSlots({
    scope: exactScope,
    durationMinutes: 30,
    now: NOW,
    context: context({
      events: [
        {
          title: "缓冲占用",
          date: "2026-09-27",
          start: "13:00",
          end: "13:30",
          occupiedStart: "12:45",
          occupiedEnd: "13:45",
        },
      ],
    }),
  });
  assert.equal(conflict[0].startTime, "13:00");
  assert.ok(conflict[0].warnings.length > 0);
});

test("未来课程、日程和缓冲会阻止候选占用，冲突时间块仍保留 warning", () => {
  const scope = resolvePlannerTimeScope("明天晚上", NOW).scope;
  const courseAvoidance = findPlannerCandidateSlots({
    scope,
    durationMinutes: 30,
    now: NOW,
    context: context({
      courses: [
        { title: "晚课", date: "2026-09-27", start: "19:00", end: "20:30", status: "normal" },
      ],
    }),
  });
  assert.deepEqual([courseAvoidance[0].startTime, courseAvoidance[0].endTime], ["18:00", "18:30"]);

  const eventAvoidance = findPlannerCandidateSlots({
    scope,
    durationMinutes: 30,
    now: NOW,
    context: context({
      events: [{ title: "已有活动", date: "2026-09-27", start: "18:00", end: "19:00" }],
    }),
  });
  assert.deepEqual([eventAvoidance[0].startTime, eventAvoidance[0].endTime], ["19:00", "19:30"]);

  const buffered = findPlannerCandidateSlots({
    scope,
    durationMinutes: 30,
    now: NOW,
    context: context({
      events: [
        {
          title: "带后置缓冲的活动",
          date: "2026-09-27",
          start: "18:00",
          end: "19:00",
          occupiedStart: "18:00",
          occupiedEnd: "20:00",
        },
      ],
      timeBlocks: [
        {
          id: "block-1",
          date: "2026-09-27",
          start: "19:30",
          end: "20:00",
          occupiedStart: "19:15",
          occupiedEnd: "20:00",
        },
      ],
    }),
  });
  assert.deepEqual([buffered[0].startTime, buffered[0].endTime], ["20:00", "20:30"]);

  const warningScope = resolvePlannerTimeScope("明天晚上19:00", NOW).scope;
  const warning = findPlannerCandidateSlots({
    scope: warningScope,
    durationMinutes: 30,
    now: NOW,
    context: context({
      events: [{ title: "冲突活动", date: "2026-09-27", start: "19:00", end: "20:00" }],
    }),
  });
  assert.match(warning[0].warnings.join(" "), /冲突活动/u);
});

test("明天晚上全空且请求 30 分钟时返回最早精确候选及本地时间事实", () => {
  const scope = resolvePlannerTimeScope("明天晚上", NOW).scope;
  const [candidate] = findPlannerCandidateSlots({
    scope,
    durationMinutes: 30,
    now: NOW,
    context: context(),
  });
  assert.deepEqual(
    {
      candidateId: candidate.candidateId,
      start: candidate.start,
      end: candidate.end,
      date: candidate.date,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      durationMinutes: candidate.durationMinutes,
      warnings: candidate.warnings,
      sourceWindow: candidate.sourceWindow,
    },
    {
      candidateId: "slot-20260927-1800-1830",
      start: "2026-09-27T10:00:00.000Z",
      end: "2026-09-27T10:30:00.000Z",
      date: "2026-09-27",
      startTime: "18:00",
      endTime: "18:30",
      durationMinutes: 30,
      warnings: [],
      sourceWindow: "2026-09-27 18:00–22:00",
    },
  );
  const [sameCandidate] = findPlannerCandidateSlots({
    scope,
    durationMinutes: 30,
    now: NOW,
    context: context(),
  });
  assert.equal(sameCandidate.candidateId, candidate.candidateId, "候选编号应可重复计算");
});

test("用户指定 20:00 时只生成该 30 分钟候选，不改时也不延长到午夜", () => {
  const scope = resolvePlannerTimeScope("明天晚上20:00", NOW).scope;
  const [candidate] = findPlannerCandidateSlots({
    scope,
    durationMinutes: 30,
    now: NOW,
    context: context(),
  });
  assert.deepEqual(
    [
      candidate.candidateId,
      candidate.date,
      candidate.startTime,
      candidate.endTime,
      candidate.durationMinutes,
    ],
    ["slot-20260927-2000-2030", "2026-09-27", "20:00", "20:30", 30],
  );

  const midnightEnd = resolvePlannerTimeScope("明天深夜23:30", NOW).scope;
  assert.deepEqual(
    findPlannerCandidateSlots({
      scope: midnightEnd,
      durationMinutes: 30,
      now: NOW,
      context: context(),
    }),
    [],
    "same-day Planner events cannot serialize 24:00 as an end time",
  );
});

test("候选受当前时间、业务边界和不完整上下文约束", () => {
  const past = resolvePlannerTimeScope("今天 09:00", NOW).scope;
  assert.deepEqual(
    findPlannerCandidateSlots({ scope: past, durationMinutes: 30, now: NOW, context: context() }),
    [],
  );
  const currentMinute = resolvePlannerTimeScope("今天 10:00", NOW).scope;
  assert.deepEqual(
    findPlannerCandidateSlots({
      scope: currentMinute,
      durationMinutes: 30,
      now: NOW,
      context: context(),
    }),
    [],
  );
  const tooLong = resolvePlannerTimeScope("明天下午", NOW).scope;
  assert.deepEqual(
    findPlannerCandidateSlots({
      scope: tooLong,
      durationMinutes: 720,
      now: NOW,
      context: context(),
    }),
    [],
  );
  assert.deepEqual(
    findPlannerCandidateSlots({
      scope: tooLong,
      durationMinutes: 30,
      now: NOW,
      context: context({ truncatedModules: ["academic"] }),
    }),
    [],
  );
  const fiveMinuteScope = resolvePlannerTimeScope("明天晚上18:00", NOW).scope;
  assert.deepEqual(
    findPlannerCandidateSlots({
      scope: fiveMinuteScope,
      durationMinutes: 5,
      now: NOW,
      context: context(),
    }).map(({ startTime, endTime }) => [startTime, endTime]),
    [["18:00", "18:05"]],
  );
  const lateEvening = resolvePlannerTimeScope("明天晚上21:45", NOW).scope;
  assert.deepEqual(
    findPlannerCandidateSlots({
      scope: lateEvening,
      durationMinutes: 30,
      now: NOW,
      context: context(),
    }),
    [],
  );
});
