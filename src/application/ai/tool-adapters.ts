import { readAcademicAiUpcoming } from "../academic/ai-read-query.ts";
import {
  readPlannerAiOpenItems,
  readPlannerAiSchedule,
  readRoutineAiToday,
} from "../planner/ai-read-query.ts";
import { readWeatherAiSummary } from "../weather/ai-read-query.ts";
import { readWorkspaceAiOverview } from "../workspace/ai-read-query.ts";
import type { AiToolAdapter } from "./tool-registry.ts";
import { AI_PROPOSAL_TOOL_ADAPTERS } from "./proposal-tool-adapters.ts";

interface DateRangeLimit {
  readonly from: string;
  readonly to: string;
  readonly limit: number;
}

function parseEmptyObject(value: unknown): Record<string, never> {
  if (!isRecord(value) || Object.keys(value).length > 0) throw new Error("invalid input");
  return {};
}

function parseLimitInput(value: unknown): number {
  if (!isRecord(value)) throw new Error("invalid input");
  const limit = value.limit ?? 20;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("invalid limit");
  }
  return limit;
}

function parseDateRangeInput(value: unknown): DateRangeLimit {
  if (!isRecord(value)) throw new Error("invalid input");
  const fromValue = value.from;
  const toValue = value.to;
  if ((fromValue === undefined) !== (toValue === undefined)) throw new Error("partial date range");
  const from = fromValue === undefined ? localDateKey(new Date()) : parseDate(fromValue);
  const to = toValue === undefined ? addDays(from, 7) : parseDate(toValue);
  const limit = value.limit ?? 20;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("invalid limit");
  }
  const durationDays =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (from > to || !Number.isInteger(durationDays) || durationDays > 31) {
    throw new Error("date range outside permitted horizon");
  }
  return Object.freeze({ from, to, limit });
}

function parseDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error("invalid date");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("invalid date");
  }
  return value;
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const adapters: AiToolAdapter[] = [
  {
    id: "workspace.overview",
    parseInput: parseEmptyObject,
    execute: () => readWorkspaceAiOverview(),
  },
  {
    id: "academic.upcoming",
    parseInput: parseDateRangeInput,
    execute: (input) => readAcademicAiUpcoming(input as DateRangeLimit),
  },
  {
    id: "planner.open-items",
    parseInput: parseLimitInput,
    execute: (limit) => readPlannerAiOpenItems(limit as number),
  },
  {
    id: "planner.schedule",
    parseInput: parseDateRangeInput,
    execute: (input) => readPlannerAiSchedule(input as DateRangeLimit),
  },
  {
    id: "routine.today",
    parseInput: parseEmptyObject,
    execute: () => readRoutineAiToday(),
  },
  {
    id: "weather.summary",
    parseInput: parseEmptyObject,
    execute: () => readWeatherAiSummary(),
  },
];

export const AI_TOOL_ADAPTERS: readonly AiToolAdapter[] = Object.freeze([
  ...adapters,
  ...AI_PROPOSAL_TOOL_ADAPTERS,
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
