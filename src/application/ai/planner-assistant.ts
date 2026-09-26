import type { AiContextBundle, AiJsonValue } from "./context.ts";
import { computeFreeTimeIntervals, effectiveOccupancy } from "../timeline/index.ts";
import type { TimelineItem } from "../timeline/types.ts";

export const PLANNER_DAY_PARTS = Object.freeze({
  morning: Object.freeze({ startMinute: 6 * 60, endMinute: 12 * 60 }),
  afternoon: Object.freeze({ startMinute: 12 * 60, endMinute: 18 * 60 }),
  evening: Object.freeze({ startMinute: 18 * 60, endMinute: 22 * 60 }),
  late: Object.freeze({ startMinute: 22 * 60, endMinute: 24 * 60 }),
});

export const PLANNER_MAX_HORIZON_DAYS = 31;

export type PlannerDayPart = keyof typeof PLANNER_DAY_PARTS;
export type PlannerIntent =
  "analyze" | "planEvent" | "planExistingTask" | "createTask" | "clarification";

export interface PlannerTimeWindow {
  readonly date: string;
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface PlannerTimeScope {
  readonly startDate: string;
  readonly endDate: string;
  readonly absoluteStart: string;
  readonly absoluteEnd: string;
  readonly sourceExpression: string;
  readonly precision: "day" | "dayPart" | "exactTime";
  readonly dayPart: PlannerDayPart | null;
  readonly exactStartMinute: number | null;
  readonly timezone: string;
  readonly windows: readonly PlannerTimeWindow[];
}

export type PlannerInstructionResolution =
  | { readonly intent: "analyze"; readonly scope: PlannerTimeScope }
  | {
      readonly intent: "planEvent";
      readonly scope: PlannerTimeScope;
      readonly title: string;
      readonly durationMinutes: number;
    }
  | {
      readonly intent: "planExistingTask";
      readonly scope: PlannerTimeScope;
      readonly taskQuery: string;
      readonly durationMinutes: number;
    }
  | {
      readonly intent: "createTask";
      readonly title: string;
      readonly deadlineDate: string | null;
      readonly priority: "none" | "low" | "medium" | "high";
    }
  | { readonly intent: "clarification"; readonly message: string };

export interface PlannerCandidateSlot {
  readonly candidateId: string;
  readonly start: string;
  readonly end: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly durationMinutes: number;
  readonly warnings: readonly string[];
  readonly sourceWindow: string;
}

type RecordValue = Record<string, unknown>;

const WEEKDAY_WORDS: Readonly<Record<string, number>> = Object.freeze({
  周一: 1,
  星期一: 1,
  礼拜一: 1,
  周二: 2,
  星期二: 2,
  礼拜二: 2,
  周三: 3,
  星期三: 3,
  礼拜三: 3,
  周四: 4,
  星期四: 4,
  礼拜四: 4,
  周五: 5,
  星期五: 5,
  礼拜五: 5,
  周六: 6,
  星期六: 6,
  礼拜六: 6,
  周日: 7,
  星期日: 7,
  礼拜日: 7,
  周天: 7,
  星期天: 7,
});

/** Local trusted routing. Provider output never chooses intent or capability. */
export function resolvePlannerInstruction(
  instruction: string,
  now: Date,
  timezone = "Asia/Shanghai",
): PlannerInstructionResolution {
  const text = instruction.trim().slice(0, 500);
  if (!text) return { intent: "clarification", message: "想先看看哪一天或哪类安排？" };

  if (isExplicitTaskCreation(text)) {
    const title = extractTaskTitle(text);
    if (!title) return { intent: "clarification", message: "想创建什么任务？请补充任务名称。" };
    return {
      intent: "createTask",
      title,
      deadlineDate: parseDeadlineDate(text, now, timezone),
      priority: parsePriority(text),
    };
  }

  const scopeResult = resolvePlannerTimeScope(text, now, timezone);
  const taskPlanningMatch =
    /(?:给|为)\s*([^，。！？]{1,50}?)\s*(?:安排|规划|排(?:一下|一段|个)?|留出)/u.exec(text);
  const findTaskTimeMatch =
    /(?:找|留出)\s*(?:(?:\d+(?:\.5)?|(?:一|两|二|三|四|五|六|七|八|九|十)(?:个)?(?:半)?)\s*(?:分钟|小时)|半小时|半个小时|一刻钟|一小时半)\s*(?:时间)?\s*(?:来)?\s*((?:完成|写|做|复习|准备|背|练习)[^，。！？]{1,40})/u.exec(
      text,
    );
  const taskQueryCandidate = taskPlanningMatch?.[1]?.trim() ?? findTaskTimeMatch?.[1]?.trim() ?? "";
  const existingTaskRequest =
    /(?:已有任务|现有任务|这个任务|该任务).{0,30}(?:安排|排|时间块)/u.test(text) ||
    (Boolean(taskQueryCandidate) &&
      !/^(?:我|我们|我自己|我们自己|自己)$/u.test(taskQueryCandidate));
  const activityTitle = extractEventTitle(text);
  const durationMinutes = parseDurationMinutes(text);
  const analyzeRequest =
    /(?:忙不忙|排得满|安排如何|看看|分析|有什么课|有什么安排|有啥安排|风险)/u.test(text) &&
    !existingTaskRequest &&
    !activityTitle;
  if (analyzeRequest) {
    const scope = scopeResult.scope ?? defaultDayScope(now, timezone);
    return { intent: "analyze", scope };
  }

  const hasPlanCue =
    /(?:安排|规划|排一下|排个|留出|想(?:去|跑|做|开|参加)|计划|参加|约人|跑步|跑|游泳|开会|去图书馆|看电影|聚餐|吃饭|健身|锻炼|散步|出行|约会|购物|做饭|打球|羽毛球|篮球)/u.test(
      text,
    );

  if (existingTaskRequest) {
    if (!scopeResult.scope) {
      return {
        intent: "clarification",
        message: scopeResult.message ?? "希望安排在哪一天或哪个时段？",
      };
    }
    if (scopeResult.scope.precision === "day" && scopeResult.scope.windows.length === 1) {
      return { intent: "clarification", message: "希望安排在这一天的哪个时段？" };
    }
    if (!durationMinutes) return { intent: "clarification", message: "这项任务想安排多长时间？" };
    const taskQuery = cleanTitle(taskQueryCandidate || extractTaskQuery(text));
    if (!taskQuery) return { intent: "clarification", message: "请明确要安排的现有任务名称。" };
    return { intent: "planExistingTask", scope: scopeResult.scope, taskQuery, durationMinutes };
  }

  if (activityTitle || hasPlanCue) {
    if (!scopeResult.scope) {
      return { intent: "clarification", message: "希望安排在哪一天或哪个时段？" };
    }
    if (scopeResult.scope.precision === "day" && scopeResult.scope.windows.length === 1) {
      return { intent: "clarification", message: "希望安排在这一天的哪个时段？" };
    }
    if (!activityTitle)
      return { intent: "clarification", message: "想安排什么活动？请补充活动名称。" };
    if (!durationMinutes) {
      return {
        intent: "clarification",
        message: `想为“${activityTitle}”留多长时间？请重新发送包含日期、活动和时长的完整请求，例如“明天晚上跑步 30 分钟”。`,
      };
    }
    return { intent: "planEvent", scope: scopeResult.scope, title: activityTitle, durationMinutes };
  }

  if (/(?:帮我弄|安排一下|弄一下|处理一下)/u.test(text)) {
    return {
      intent: "clarification",
      message: "你希望我分析安排，还是创建活动、安排现有任务或记下新任务？",
    };
  }
  return { intent: "analyze", scope: scopeResult.scope ?? defaultDayScope(now, timezone) };
}

export function resolvePlannerTimeScope(
  expression: string,
  now: Date,
  timezone = "Asia/Shanghai",
): { readonly scope?: PlannerTimeScope; readonly message?: string } {
  const local = zonedParts(now, timezone);
  const today = `${pad(local.year, 4)}-${pad(local.month)}-${pad(local.day)}`;
  const dayPart = parseDayPart(expression);
  const exactStartMinute = parseExactStartMinute(expression, dayPart);
  let dates: readonly string[] | null = null;
  const explicit = parseExplicitDate(expression, local.year);

  if (explicit) dates = [explicit];
  else if (/(?:今天|今日日|今晚)/u.test(expression)) dates = [today];
  else if (/后天/u.test(expression)) dates = [addDays(today, 2)];
  else if (/明天/u.test(expression)) dates = [addDays(today, 1)];
  else if (/本周|这周/u.test(expression)) {
    const monday = addDays(today, 1 - isoWeekday(today));
    dates = Array.from({ length: 7 }, (_, index) => addDays(monday, index)).filter(
      (date) => date >= today,
    );
  } else if (/下周末/u.test(expression)) {
    const monday = addDays(today, 8 - isoWeekday(today));
    const saturday = addDays(monday, 5);
    dates = [saturday, addDays(saturday, 1)];
  } else if (/下周/u.test(expression)) {
    const monday = addDays(today, 8 - isoWeekday(today));
    const weekday = parseWeekday(expression);
    dates = weekday
      ? [addDays(monday, weekday - 1)]
      : Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  } else if (/周末|星期末/u.test(expression)) {
    const weekday = isoWeekday(today);
    const saturday = addDays(today, weekday <= 6 ? 6 - weekday : 0);
    dates = (weekday === 7 ? [today] : [saturday, addDays(saturday, 1)]).filter(
      (date) => date >= today,
    );
  } else {
    const weekday = parseWeekday(expression);
    if (weekday) {
      const delta = (weekday - isoWeekday(today) + 7) % 7;
      dates = [addDays(today, delta)];
    }
  }

  if (!dates?.length) return { message: "请明确具体日期或相对日期，例如明天、周六或 10 月 3 日。" };
  const startDate = dates[0]!;
  const endDate = dates.at(-1)!;
  const horizon = dateDistance(today, endDate);
  if (horizon < 0) return { message: "这个日期已经过去了，请换成未来日期。" };
  if (horizon > PLANNER_MAX_HORIZON_DAYS) {
    return { message: "单次规划最多查看未来 31 天，请缩小日期范围。" };
  }
  if (exactStartMinute !== null && dates.length !== 1) {
    return { message: "具体时间需要对应一个明确日期，请指定某一天。" };
  }

  const bounds = dayPart ? PLANNER_DAY_PARTS[dayPart] : { startMinute: 0, endMinute: 1440 };
  if (
    exactStartMinute !== null &&
    dayPart &&
    (exactStartMinute < bounds.startMinute || exactStartMinute >= bounds.endMinute)
  ) {
    return { message: "具体时间不在你指定的时段内，请调整时间或时段。" };
  }
  const windows = dates.map((date): PlannerTimeWindow => ({
    date,
    startMinute: exactStartMinute ?? bounds.startMinute,
    endMinute: bounds.endMinute,
  }));
  const first = windows[0]!;
  const last = windows.at(-1)!;
  const absoluteStart = zonedDateTimeToIso(first.date, first.startMinute, timezone);
  const absoluteEnd = zonedDateTimeToIso(
    last.date,
    exactStartMinute === null ? last.endMinute : exactStartMinute + 1,
    timezone,
  );
  return {
    scope: Object.freeze({
      startDate,
      endDate,
      absoluteStart,
      absoluteEnd,
      sourceExpression: expression.trim().slice(0, 120),
      precision: exactStartMinute !== null ? "exactTime" : dayPart ? "dayPart" : "day",
      dayPart,
      exactStartMinute,
      timezone,
      windows: Object.freeze(windows),
    }),
  };
}

/** Deterministic, bounded candidate search over already projected local context. */
export function findPlannerCandidateSlots(input: {
  readonly scope: PlannerTimeScope;
  readonly durationMinutes: number;
  readonly now: Date;
  readonly context: AiContextBundle;
}): readonly PlannerCandidateSlot[] {
  if (
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes < 5 ||
    input.durationMinutes > 1440 ||
    input.context.budget.truncatedModules?.some(
      (module) => module === "academic" || module === "planner",
    )
  ) {
    return Object.freeze([]);
  }
  const academic = asRecord(input.context.moduleContexts.academic);
  const planner = asRecord(input.context.moduleContexts.planner);
  if (
    !academic ||
    !planner ||
    academic.contextComplete === false ||
    planner.contextComplete === false
  ) {
    return Object.freeze([]);
  }
  const local = zonedParts(input.now, input.scope.timezone);
  const today = `${pad(local.year, 4)}-${pad(local.month)}-${pad(local.day)}`;
  const timelineItems = timelineItemsFromContext(academic, planner, input.scope.timezone);
  const candidates: PlannerCandidateSlot[] = [];

  for (const window of input.scope.windows) {
    if (window.date < today) continue;
    const dayItems = timelineItems.filter((item) => item.date === window.date);
    const earliestStart =
      window.date === today
        ? Math.max(window.startMinute, Math.ceil((local.hour * 60 + local.minute + 1) / 5) * 5)
        : window.startMinute;
    if (input.scope.exactStartMinute !== null) {
      const start = window.startMinute;
      const end = start + input.durationMinutes;
      if (start < earliestStart || end > window.endMinute || end >= 1440) continue;
      candidates.push(
        slot(
          window,
          start,
          end,
          input.durationMinutes,
          conflictWarnings(dayItems, start, end),
          input.scope.timezone,
        ),
      );
      return Object.freeze(candidates);
    }
    for (const interval of computeFreeTimeIntervals(dayItems)) {
      const start = Math.ceil(Math.max(earliestStart, interval.startMinute) / 5) * 5;
      const end = start + input.durationMinutes;
      if (end < 1440 && end <= Math.min(window.endMinute, interval.endMinute)) {
        candidates.push(slot(window, start, end, input.durationMinutes, [], input.scope.timezone));
        return Object.freeze(candidates);
      }
    }
  }
  if (input.scope.exactStartMinute !== null) return Object.freeze(candidates);

  // If the whole requested window is busy, preserve the existing warn-but-allow
  // contract by offering the earliest legal interval with its known conflicts.
  for (const window of input.scope.windows) {
    if (window.date < today) continue;
    const start =
      window.date === today
        ? Math.max(window.startMinute, Math.ceil((local.hour * 60 + local.minute + 1) / 5) * 5)
        : window.startMinute;
    const lastStart = Math.min(
      window.endMinute - input.durationMinutes - 1,
      1439 - input.durationMinutes,
    );
    if (start > lastStart) continue;
    const end = start + input.durationMinutes;
    return Object.freeze([
      slot(
        window,
        start,
        end,
        input.durationMinutes,
        conflictWarnings(
          timelineItems.filter((item) => item.date === window.date),
          start,
          end,
        ),
        input.scope.timezone,
      ),
    ]);
  }
  return Object.freeze([]);
}

export function exactOpenTaskMatch(
  query: string,
  plannerContext: AiJsonValue | undefined,
): { readonly task?: RecordValue; readonly ambiguous: boolean } {
  const planner = asRecord(plannerContext);
  const tasks = Array.isArray(planner?.tasks) ? planner.tasks.filter(isRecord) : [];
  const normalizedQuery = normalizeTitle(query);
  const matches = tasks.filter(
    (task) =>
      task.status !== "completed" && normalizeTitle(stringValue(task.title)) === normalizedQuery,
  );
  return matches.length === 1
    ? { task: matches[0], ambiguous: false }
    : { ambiguous: matches.length > 1 };
}

export function parseDurationMinutes(text: string): number | null {
  if (/一个半小时|一小时半/u.test(text)) return 90;
  if (/半小时|半个小时/u.test(text)) return 30;
  if (/一刻钟/u.test(text)) return 15;
  const decimalHours = /(?<!\d)(\d+(?:\.5)?)\s*小时/u.exec(text);
  if (decimalHours) return Math.round(Number(decimalHours[1]) * 60);
  const chineseHours = /(一|两|二|三|四|五|六|七|八|九|十)个?小时/u.exec(text);
  if (chineseHours) {
    const value: Readonly<Record<string, number>> = {
      一: 1,
      两: 2,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
      十: 10,
    };
    return value[chineseHours[1]!] * 60;
  }
  const minutes = /(?<!\d)(\d{1,3})\s*分钟/u.exec(text);
  return minutes ? Number(minutes[1]) : null;
}

export function normalizeTitle(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s，。！？、,.!?；;:：\-—_]/gu, "");
}

function isExplicitTaskCreation(text: string): boolean {
  return /(?:帮我|请|给我)?(?:记下|记|创建|添加|新建|新增)(?:一个|个|下)?[^。！？]{0,100}(?:任务|待办)/u.test(
    text,
  );
}

function extractTaskTitle(text: string): string {
  return cleanTitle(
    text
      .replace(/^(?:请)?(?:帮我|给我)?(?:记下|记|创建|添加|新建|新增)(?:一个|个|下)?/u, "")
      .replace(
        /(?:今天|明天|后天|本周|这周|下周|(?:周|星期|礼拜)[一二三四五六日天])(?:上午|下午|晚上|前|之前|前交)?/gu,
        "",
      )
      .replace(/\d{1,4}年?\s*\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/gu, "")
      .replace(
        /(?:\d{1,3}\s*分钟|一个半小时|一小时半|半小时|半个小时|(?:一|两|二|三|四|五|六|七|八|九|十)个?小时|\d+(?:\.5)?\s*小时)/gu,
        "",
      )
      .replace(/(?:的)?(?:个人)?(?:待办)?任务.*$/u, ""),
  );
}

function extractTaskQuery(text: string): string {
  const stripped = text
    .replace(
      /(?:今天|明天|后天|本周|这周|下周|周末|今晚|(?:周|星期|礼拜)[一二三四五六日天])(?:上午|下午|晚上|早上|前|之前)?/gu,
      " ",
    )
    .replace(/\d{4}[-年/]\d{1,2}[-月/]\d{1,2}日?/gu, " ")
    .replace(/(?:上午|下午|晚上|早上|傍晚|夜里|夜间)/gu, " ")
    .replace(
      /(?:\d{1,3}\s*分钟|一个半小时|一小时半|半小时|半个小时|(?:一|两|二|三|四|五|六|七|八|九|十)个?小时|\d+(?:\.5)?\s*小时)/gu,
      " ",
    )
    .replace(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/gu, " ")
    .replace(
      /(?:请|帮我|给我|给|为|安排|规划|排一下|排个|安排一段|安排一个|留出|时间块|时间段|时间|的)/gu,
      " ",
    );
  return cleanTitle(stripped);
}

function extractEventTitle(text: string): string | null {
  const patterns: readonly [RegExp, string][] = [
    [/跑步|跑一跑|跑/u, "跑步"],
    [/游泳/u, "游泳"],
    [/开会|会议/u, "开会"],
    [/去图书馆|图书馆/u, "去图书馆"],
    [/看电影|电影/u, "看电影"],
    [/聚餐/u, "聚餐"],
    [/吃饭/u, "吃饭"],
    [/健身/u, "健身"],
    [/锻炼/u, "锻炼"],
    [/散步/u, "散步"],
    [/出行|旅行/u, "出行"],
    [/约会/u, "约会"],
    [/参加[^，。！？\d]{1,12}/u, ""],
    [/约(?:人|朋友|同学|同事)[^，。！？\d]{0,8}/u, ""],
    [/购物|买东西/u, "购物"],
    [/做饭/u, "做饭"],
    [/羽毛球|篮球|打球/u, "运动"],
  ];
  const matched = patterns.find(([pattern]) => pattern.test(text));
  if (!matched) return null;
  if (matched[1]) return matched[1];
  return matched[0].exec(text)?.[0]?.trim() ?? null;
}

function cleanTitle(value: string): string {
  return value
    .replace(/[\s，。！？、,.!?；;:：\-—_“”"'（）()]/gu, " ")
    .replace(/\s{2,}/gu, " ")
    .trim()
    .slice(0, 120);
}

function parseDeadlineDate(text: string, now: Date, timezone: string): string | null {
  const before = /((?:周|星期|礼拜)[一二三四五六日天])(?:前|之前)/u.exec(text);
  if (before) {
    const weekday = parseWeekday(before[1]!);
    if (weekday) {
      const local = zonedParts(now, timezone);
      const today = `${pad(local.year, 4)}-${pad(local.month)}-${pad(local.day)}`;
      const delta = (weekday - isoWeekday(today) + 7) % 7 || 7;
      return addDays(today, delta);
    }
  }
  const scope = resolvePlannerTimeScope(text, now, timezone).scope;
  return scope?.startDate ?? null;
}

function parsePriority(text: string): "none" | "low" | "medium" | "high" {
  if (/高优先级|优先级高|紧急/u.test(text)) return "high";
  if (/中优先级|优先级中/u.test(text)) return "medium";
  if (/低优先级|优先级低/u.test(text)) return "low";
  return "none";
}

function defaultDayScope(now: Date, timezone: string): PlannerTimeScope {
  const local = zonedParts(now, timezone);
  const date = `${pad(local.year, 4)}-${pad(local.month)}-${pad(local.day)}`;
  return makeScope([date], null, null, date, timezone, "day");
}

function parseExplicitDate(text: string, year: number): string | null {
  const iso = /(?<!\d)(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/u.exec(text);
  const cn = /(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/u.exec(text);
  const match = iso ?? cn;
  if (!match) return null;
  const date = iso
    ? `${pad(Number(match[1]), 4)}-${pad(Number(match[2]))}-${pad(Number(match[3]))}`
    : `${pad(year, 4)}-${pad(Number(match[1]))}-${pad(Number(match[2]))}`;
  return isValidDate(date) ? date : null;
}

function parseDayPart(text: string): PlannerDayPart | null {
  if (/上午|早上|早晨/u.test(text)) return "morning";
  if (/下午/u.test(text)) return "afternoon";
  if (/晚上|今晚|傍晚/u.test(text)) return "evening";
  if (/深夜|夜里|夜间|凌晨/u.test(text)) return "late";
  return null;
}

function parseExactStartMinute(text: string, dayPart: PlannerDayPart | null): number | null {
  const twentyFourHour = /(?<!\d)([01]?\d|2[0-3]):([0-5]\d)(?!\d)/u.exec(text);
  if (twentyFourHour) return Number(twentyFourHour[1]) * 60 + Number(twentyFourHour[2]);
  const match = /(上午|下午|晚上|凌晨|早上)?\s*(\d{1,2})点(半|\d{1,2}分?)?/u.exec(text);
  if (!match) return null;
  let hour = Number(match[2]);
  const minute = match[3] === "半" ? 30 : Number(match[3]?.replace("分", "") ?? 0);
  const period =
    match[1] ?? (dayPart === "evening" ? "晚上" : dayPart === "afternoon" ? "下午" : null);
  if (hour > 23 || minute > 59) return null;
  if (hour <= 12 && !period) return null;
  if ((period === "下午" || period === "晚上") && hour < 12) hour += 12;
  if ((period === "上午" || period === "早上" || period === "凌晨") && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function parseWeekday(text: string): number | null {
  const entry = Object.entries(WEEKDAY_WORDS).find(([word]) => text.includes(word));
  return entry?.[1] ?? null;
}

function makeScope(
  dates: readonly string[],
  dayPart: PlannerDayPart | null,
  exactStartMinute: number | null,
  sourceExpression: string,
  timezone: string,
  precision: PlannerTimeScope["precision"],
): PlannerTimeScope {
  const bounds = dayPart ? PLANNER_DAY_PARTS[dayPart] : { startMinute: 0, endMinute: 1440 };
  const windows = dates.map((date): PlannerTimeWindow => ({
    date,
    startMinute: exactStartMinute ?? bounds.startMinute,
    endMinute: bounds.endMinute,
  }));
  const first = windows[0]!;
  const last = windows.at(-1)!;
  return Object.freeze({
    startDate: dates[0]!,
    endDate: dates.at(-1)!,
    absoluteStart: zonedDateTimeToIso(first.date, first.startMinute, timezone),
    absoluteEnd: zonedDateTimeToIso(
      last.date,
      exactStartMinute === null ? last.endMinute : exactStartMinute + 1,
      timezone,
    ),
    sourceExpression,
    precision,
    dayPart,
    exactStartMinute,
    timezone,
    windows: Object.freeze(windows),
  });
}

function timelineItemsFromContext(
  academic: RecordValue,
  planner: RecordValue,
  timezone: string,
): readonly TimelineItem[] {
  const result: TimelineItem[] = [];
  for (const course of asRecordArray(academic.courses)) {
    const date = stringValue(course.date);
    const cancelled = ["cancelled", "canceled", "suspended"].includes(
      stringValue(course.status).toLowerCase(),
    );
    result.push({
      id: `ai-course:${stringValue(course.courseId)}:${date}`,
      sourceType: "academicOccurrence",
      sourceRef: { type: "academicOccurrence", courseId: stringValue(course.courseId), date },
      date,
      startTime: stringValue(course.start),
      endTime: stringValue(course.end),
      title: stringValue(course.title) || "课程",
      location: null,
      status: cancelled ? "cancelled" : "normal",
      editable: false,
      draggable: false,
      resizable: false,
      occupiesTime: !cancelled,
      warnings: [],
    });
  }
  for (const exam of asRecordArray(academic.exams)) {
    const start = isoLocalMinute(stringValue(exam.startsAt), timezone);
    if (!start) continue;
    const end = exam.endsAt ? isoLocalMinute(stringValue(exam.endsAt), timezone) : null;
    result.push({
      id: `ai-exam:${stringValue(exam.id)}`,
      sourceType: "aiProposal",
      sourceRef: { type: "exam", id: stringValue(exam.id) },
      date: start.date,
      startTime: formatMinute(start.minute),
      endTime: formatMinute(end?.date === start.date ? end.minute : 1440),
      title: stringValue(exam.title) || "考试",
      location: null,
      status: "normal",
      editable: false,
      draggable: false,
      resizable: false,
      occupiesTime: true,
      warnings: [],
    });
  }
  for (const event of asRecordArray(planner.events)) {
    result.push({
      id: `ai-event:${stringValue(event.id)}`,
      sourceType: "plannerEvent",
      sourceRef: { type: "plannerEvent", id: stringValue(event.id) },
      date: stringValue(event.date),
      startTime: stringValue(event.occupiedStart) || stringValue(event.start),
      endTime: stringValue(event.occupiedEnd) || stringValue(event.end),
      title: stringValue(event.title) || "已有日程",
      location: null,
      status: "normal",
      editable: false,
      draggable: false,
      resizable: false,
      occupiesTime: true,
      bufferBeforeMinutes: numberValue(event.bufferBeforeMinutes),
      bufferAfterMinutes: numberValue(event.bufferAfterMinutes),
      warnings: [],
    });
  }
  for (const timeBlock of asRecordArray(planner.timeBlocks)) {
    result.push({
      id: `ai-time-block:${stringValue(timeBlock.id)}`,
      sourceType: "timeBlock",
      sourceRef: { type: "timeBlock", id: stringValue(timeBlock.id) },
      date: stringValue(timeBlock.date),
      startTime: stringValue(timeBlock.occupiedStart) || stringValue(timeBlock.start),
      endTime: stringValue(timeBlock.occupiedEnd) || stringValue(timeBlock.end),
      title: stringValue(timeBlock.title) || "任务时间块",
      location: null,
      status: "normal",
      editable: false,
      draggable: false,
      resizable: false,
      occupiesTime: true,
      bufferBeforeMinutes: numberValue(timeBlock.bufferBeforeMinutes),
      bufferAfterMinutes: numberValue(timeBlock.bufferAfterMinutes),
      warnings: [],
    });
  }
  return Object.freeze(result);
}

function conflictWarnings(
  items: readonly TimelineItem[],
  startMinute: number,
  endMinute: number,
): readonly string[] {
  return Object.freeze(
    items.flatMap((item) => {
      const occupancy = effectiveOccupancy(item);
      if (!occupancy || startMinute >= occupancy.endMinute || occupancy.startMinute >= endMinute) {
        return [];
      }
      const label =
        item.sourceRef.type === "exam"
          ? "考试"
          : item.sourceType === "academicOccurrence"
            ? "课程"
            : item.sourceType === "timeBlock"
              ? "任务时间块"
              : "日程";
      return [
        `与${label}“${item.title}”（${formatMinute(occupancy.startMinute)}–${formatMinute(occupancy.endMinute)}）冲突`,
      ];
    }),
  );
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function slot(
  window: PlannerTimeWindow,
  start: number,
  end: number,
  durationMinutes: number,
  warnings: readonly string[],
  timezone: string,
): PlannerCandidateSlot {
  const startTime = formatMinute(start);
  const endTime = formatMinute(end);
  const candidateId = `slot-${window.date.replaceAll("-", "")}-${startTime.replace(":", "")}-${endTime.replace(":", "")}`;
  return Object.freeze({
    candidateId,
    start: zonedDateTimeToIso(window.date, start, timezone),
    end: zonedDateTimeToIso(window.date, end, timezone),
    date: window.date,
    startTime,
    endTime,
    durationMinutes,
    warnings: Object.freeze([...warnings]),
    sourceWindow: `${window.date} ${formatMinute(window.startMinute)}–${formatMinute(window.endMinute)}`,
  });
}

function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

function zonedDateTimeToIso(date: string, minute: number, timezone: string): string {
  const normalizedDate = minute >= 1440 ? addDays(date, Math.floor(minute / 1440)) : date;
  const normalizedMinute = minute % 1440;
  const [localYear, localMonth, localDay] = normalizedDate.split("-").map(Number);
  const target = Date.UTC(
    localYear!,
    localMonth! - 1,
    localDay!,
    Math.floor(normalizedMinute / 60),
    normalizedMinute % 60,
  );
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedParts(new Date(guess), timezone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const delta = target - represented;
    if (delta === 0) break;
    guess += delta;
  }
  const result = new Date(guess);
  if (!Number.isFinite(result.getTime())) throw new Error("无效的规划日期范围。");
  return result.toISOString();
}

function isoLocalMinute(value: string, timezone: string): { date: string; minute: number } | null {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const parts = zonedParts(new Date(milliseconds), timezone);
  return {
    date: `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`,
    minute: parts.hour * 60 + parts.minute,
  };
}

function addDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function dateDistance(start: string, end: string): number {
  return Math.round(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}

function isoWeekday(date: string): number {
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function isValidDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}

function formatMinute(value: number): string {
  if (value >= 1440) return "24:00";
  return `${pad(Math.floor(value / 60))}:${pad(value % 60)}`;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function asRecord(value: AiJsonValue | undefined): RecordValue | null {
  return isRecord(value) ? value : null;
}

function asRecordArray(value: unknown): readonly RecordValue[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
