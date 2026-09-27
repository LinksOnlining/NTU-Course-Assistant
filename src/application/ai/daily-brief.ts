import type { AiJsonObject } from "./tool.ts";
import { sanitizeAiText } from "./context-projector.ts";

export type DailyBriefSource = "academic" | "planner" | "routine" | "weather" | "dailySummary";

export interface DailyBriefSuggestion {
  readonly title: string;
  readonly reason: string;
  readonly taskId?: string;
  readonly candidateId?: string;
}

export interface DailyBriefCandidate {
  readonly candidateId?: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
}

export interface DailyBriefResult {
  readonly mode: "ai" | "local";
  readonly overview: string;
  readonly routineNote?: string;
  readonly scheduleHighlights: readonly string[];
  readonly topPriorities: readonly DailyBriefSuggestion[];
  readonly risks: readonly string[];
  readonly carryOvers: readonly string[];
  readonly freeWindows: readonly DailyBriefCandidate[];
  readonly suggestions: readonly DailyBriefSuggestion[];
  readonly canWait: readonly string[];
  readonly weatherNote?: string;
  readonly limitations: readonly string[];
  readonly sources: readonly DailyBriefSource[];
}

export function dailyBriefLocalDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function dailyBriefLocalTime(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("hour")}:${part("minute")}`;
}

export function dailyBriefGreeting(localTime: string): string {
  const hour = Number(/^([01]\d|2[0-3]):[0-5]\d$/u.exec(localTime)?.[1]);
  if (!Number.isFinite(hour)) return "今天值得留意";
  if (hour >= 6 && hour < 11) return "早上好，今日晨报";
  if (hour >= 11 && hour < 18) return "今天还有这些事";
  return "今晚值得注意";
}

export function isDailyBriefSignificant(input: {
  readonly arrangementCount: number;
  readonly deadlineCount: number;
  readonly overdueCount: number;
  readonly warningCount: number;
  readonly importantTaskCount: number;
  readonly routineCount: number;
}): boolean {
  return (
    input.arrangementCount > 0 ||
    input.deadlineCount > 0 ||
    input.overdueCount > 0 ||
    input.warningCount > 0 ||
    input.importantTaskCount > 0 ||
    input.routineCount > 1
  );
}

export function createDailyBriefSchema(input: {
  readonly taskIds: readonly string[];
  readonly candidateIds: readonly string[];
}) {
  const taskIds = new Set(input.taskIds);
  const candidateIds = new Set(input.candidateIds);
  return Object.freeze({
    name: "daily_brief_v1",
    jsonSchema: Object.freeze({
      type: "object",
      additionalProperties: false,
      required: [
        "overview",
        "scheduleHighlights",
        "topPriorities",
        "risks",
        "carryOvers",
        "suggestions",
        "canWait",
        "limitations",
      ],
      properties: {
        overview: { type: "string", minLength: 1, maxLength: 320 },
        scheduleHighlights: stringListSchema(6, 180),
        topPriorities: suggestionListSchema(4, taskIds, candidateIds),
        risks: stringListSchema(4, 180),
        carryOvers: { type: "array", maxItems: 0, items: { type: "string" } },
        suggestions: suggestionListSchema(4, taskIds, candidateIds),
        canWait: stringListSchema(4, 180),
        weatherNote: { type: "string", maxLength: 160 },
        limitations: stringListSchema(4, 180),
      },
    }) as AiJsonObject,
    parse(value: unknown): Omit<DailyBriefResult, "mode" | "freeWindows" | "sources"> {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Daily Brief result is invalid");
      }
      const candidate = value as Record<string, unknown>;
      const keys = [
        "overview",
        "scheduleHighlights",
        "topPriorities",
        "risks",
        "carryOvers",
        "suggestions",
        "canWait",
        "weatherNote",
        "limitations",
      ];
      if (Object.keys(candidate).some((key) => !keys.includes(key))) {
        throw new Error("Daily Brief result has unexpected fields");
      }
      const carryOvers = parseTextList(candidate.carryOvers, 0);
      return Object.freeze({
        overview: parseText(candidate.overview, 320),
        scheduleHighlights: parseTextList(candidate.scheduleHighlights, 6),
        topPriorities: parseSuggestions(candidate.topPriorities, 4, taskIds, candidateIds),
        risks: parseTextList(candidate.risks, 4),
        carryOvers,
        suggestions: parseSuggestions(candidate.suggestions, 4, taskIds, candidateIds),
        canWait: parseTextList(candidate.canWait, 4),
        ...(candidate.weatherNote === undefined
          ? {}
          : { weatherNote: parseText(candidate.weatherNote, 160) }),
        limitations: parseTextList(candidate.limitations, 4),
      });
    },
  });
}

export function createLocalDailyBrief(input: {
  readonly date: string;
  readonly arrangementCount: number;
  readonly scheduleHighlights: readonly string[];
  readonly taskTitles: readonly string[];
  readonly overdueCount: number;
  readonly deadlineCount: number;
  readonly freeWindow?: DailyBriefCandidate;
  readonly routineTitles: readonly string[];
  readonly warnings: readonly string[];
  readonly routineNote?: string;
  readonly weatherNote?: string;
}): DailyBriefResult {
  const parts = [
    input.arrangementCount
      ? `今天有 ${input.arrangementCount} 项课程或日程`
      : "今天没有已安排的课程或日程",
    input.deadlineCount ? `${input.deadlineCount} 项今天截止的待办` : "没有今天截止的待办",
    input.overdueCount ? `${input.overdueCount} 项逾期待办` : "没有逾期待办",
  ];
  const freeWindow = input.freeWindow;
  const freeWindows = freeWindow ? [Object.freeze(freeWindow)] : [];
  const suggestions = input.taskTitles.slice(0, 2).map((title) =>
    Object.freeze({
      title: `处理「${title}」`,
      reason: "这是当前列出的今天或近期未完成事项；请按实际精力安排。",
    }),
  );
  return Object.freeze({
    mode: "local",
    overview: `${parts.join("；")}。`,
    ...(input.routineNote ? { routineNote: input.routineNote } : {}),
    scheduleHighlights: Object.freeze(input.scheduleHighlights.slice(0, 6)),
    topPriorities: Object.freeze(
      input.taskTitles
        .slice(0, 3)
        .map((title) => Object.freeze({ title, reason: "来自当前未完成的今天或近期截止事项。" })),
    ),
    risks: Object.freeze(input.warnings.slice(0, 4)),
    carryOvers: Object.freeze([]),
    freeWindows: Object.freeze(freeWindows),
    suggestions: Object.freeze(suggestions),
    canWait: Object.freeze([]),
    ...(input.weatherNote ? { weatherNote: input.weatherNote } : {}),
    limitations: Object.freeze([
      "以上内容由本机已加载的课程、日程和待办整理；AI 分析尚未完成或当前不可用。",
      "目前没有正式的每日总结数据源，因此不会推断连续未推进事项。",
    ]),
    sources: Object.freeze(
      [
        ...(input.arrangementCount ? (["academic", "planner"] as const) : []),
        ...(input.taskTitles.length ? (["planner"] as const) : []),
        ...(input.routineTitles.length ? (["routine"] as const) : []),
      ].filter((source, index, values) => values.indexOf(source) === index),
    ),
  });
}

function stringListSchema(maxItems: number, maxLength: number) {
  return {
    type: "array",
    maxItems,
    items: { type: "string", minLength: 1, maxLength },
  };
}

function suggestionListSchema(
  maxItems: number,
  taskIds: ReadonlySet<string>,
  candidateIds: ReadonlySet<string>,
) {
  return {
    type: "array",
    maxItems,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["title", "reason"],
      properties: {
        title: { type: "string", minLength: 1, maxLength: 120 },
        reason: { type: "string", minLength: 1, maxLength: 220 },
        ...(taskIds.size ? { taskId: { type: "string", enum: [...taskIds] } } : {}),
        ...(candidateIds.size ? { candidateId: { type: "string", enum: [...candidateIds] } } : {}),
      },
    },
  };
}

function parseSuggestions(
  value: unknown,
  maxItems: number,
  taskIds: ReadonlySet<string>,
  candidateIds: ReadonlySet<string>,
): readonly DailyBriefSuggestion[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error("Daily Brief suggestions are invalid");
  }
  return Object.freeze(
    value.map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new Error("Daily Brief suggestion is invalid");
      }
      const candidate = item as Record<string, unknown>;
      if (
        Object.keys(candidate).some(
          (key) => !["title", "reason", "taskId", "candidateId"].includes(key),
        )
      ) {
        throw new Error("Daily Brief suggestion has unexpected fields");
      }
      const taskId = optionalKnownId(candidate.taskId, taskIds);
      const candidateId = optionalKnownId(candidate.candidateId, candidateIds);
      return Object.freeze({
        title: parseText(candidate.title, 120),
        reason: parseText(candidate.reason, 220),
        ...(taskId ? { taskId } : {}),
        ...(candidateId ? { candidateId } : {}),
      });
    }),
  );
}

function optionalKnownId(value: unknown, allowed: ReadonlySet<string>): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error("Daily Brief references an unknown local object");
  }
  return value;
}

function parseTextList(value: unknown, maxItems: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error("Daily Brief text list is invalid");
  }
  return Object.freeze(value.map((item) => parseText(item, 180)));
}

function parseText(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Daily Brief text is invalid");
  }
  const text = sanitizeAiText(value)
    .replace(/\p{Cc}/gu, " ")
    .trim();
  if (!text || [...text].length > maxLength) throw new Error("Daily Brief text length is invalid");
  return text;
}
