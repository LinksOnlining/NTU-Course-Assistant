import type { AcademicTask } from "../../types/academic-task.ts";
import type { DailySummary, DailySummaryDraft } from "../../types/daily-summary.ts";
import type { PersonalTask } from "../../types/personal-task.ts";
import type { Routine } from "../../types/routine.ts";
import * as dailySummaryStorage from "../../services/daily-summary-storage.ts";
import type { TimelineItem } from "../timeline/types.ts";
import type { WorkspaceTodayArrangement } from "./types.ts";

export type DailySummaryHistoryItem = Pick<
  DailySummary,
  "summaryDate" | "overview" | "highlights" | "unfinished" | "tomorrowNotes"
>;

const MAX_RECENT_SUMMARY_CONTEXT_BYTES = 8_192;

export interface DailySummaryRepository {
  loadDailySummary(date: string): Promise<DailySummary | null>;
  loadDailySummariesInRange(startDate: string, endDate: string): Promise<readonly DailySummary[]>;
  saveDailySummary(summary: DailySummary): Promise<DailySummary>;
}

const defaultRepository: DailySummaryRepository = dailySummaryStorage;

export function getDailySummaryByDate(
  date: string,
  repository: DailySummaryRepository = defaultRepository,
): Promise<DailySummary | null> {
  if (!isDate(date)) return Promise.reject(new Error("每日总结日期无效。"));
  return repository.loadDailySummary(date);
}

export async function getRecentDailySummaries(
  today: string,
  repository: DailySummaryRepository = defaultRepository,
): Promise<readonly DailySummaryHistoryItem[]> {
  const { from, to } = recentDailySummaryRange(today);
  return projectRecentDailySummaries(today, await repository.loadDailySummariesInRange(from, to));
}

export function saveDailySummary(
  summary: DailySummary,
  repository: DailySummaryRepository = defaultRepository,
): Promise<DailySummary> {
  const validation = validateDailySummaryDraft(summary);
  if (validation) return Promise.reject(new Error(validation));
  if (
    typeof summary.id !== "string" ||
    !summary.id.trim() ||
    summary.id.trim() !== summary.id ||
    [...summary.id].length > 128 ||
    typeof summary.createdAt !== "string" ||
    !summary.createdAt.trim() ||
    [...summary.createdAt].length > 40 ||
    typeof summary.updatedAt !== "string" ||
    !summary.updatedAt.trim() ||
    [...summary.updatedAt].length > 40 ||
    !Number.isInteger(summary.revision) ||
    summary.revision < 1
  ) {
    return Promise.reject(new Error("每日总结信息无效。"));
  }
  return repository.saveDailySummary(summary);
}

export interface DailySummaryDraftInput {
  readonly date: string;
  readonly arrangements: readonly WorkspaceTodayArrangement[];
  readonly timelineItems: readonly TimelineItem[];
  readonly personalTasks: readonly PersonalTask[];
  readonly academicTasks: readonly AcademicTask[];
  readonly routines?: readonly Routine[];
  readonly now?: Date;
  readonly id?: string;
}

export function createDailySummaryDraft(input: DailySummaryDraftInput): DailySummary {
  const tomorrow = addDateDays(input.date, 1);
  const tomorrowWeekday = isoWeekday(tomorrow);
  const personal = input.personalTasks;
  const academic = input.academicTasks;
  const completedToday = [
    ...personal
      .filter(
        (task) =>
          task.status === "completed" && localTimestampDate(task.completedAt) === input.date,
      )
      .map((task) => task.title),
    ...academic
      .filter(
        (task) =>
          task.status === "COMPLETED" && localTimestampDate(task.completedAt) === input.date,
      )
      .map((task) => task.title),
  ];
  const unfinished = [
    ...personal.filter((task) => task.status === "open").map((task) => task.title),
    ...academic.filter((task) => task.status === "TODO").map((task) => task.title),
  ].slice(0, 8);
  const tomorrowNotes = [
    ...personal
      .filter((task) => task.status === "open" && task.deadlineDate === tomorrow)
      .map((task) => `待办：${task.title}`),
    ...academic
      .filter((task) => task.status === "TODO" && task.dueAt.slice(0, 10) === tomorrow)
      .map((task) => `学业事项：${task.title}`),
    ...input.timelineItems
      .filter((item) => item.date === tomorrow)
      .map((item) => `日程：${item.startTime} ${item.title}`),
    ...(tomorrowWeekday === null
      ? []
      : (input.routines ?? [])
          .filter(
            (routine) =>
              routine.enabled && (routine.weekdaysMask & (1 << (tomorrowWeekday - 1))) !== 0,
          )
          .map((routine) => `例行提醒（未排期）：${routine.title}`)),
  ].slice(0, 8);
  const activeArrangements = input.arrangements.filter((item) => !item.cancelled);
  const overview = `今天有 ${activeArrangements.length} 项课程或日程，完成 ${completedToday.length} 项任务，当前有 ${unfinished.length} 项待推进。`;
  const timestamp = (input.now ?? new Date()).toISOString();
  const draft: DailySummaryDraft = {
    summaryDate: input.date,
    overview,
    highlights: completedToday.slice(0, 8),
    unfinished,
    tomorrowNotes,
  };
  return Object.freeze({
    ...draft,
    id: input.id ?? crypto.randomUUID(),
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 1,
  });
}

export function validateDailySummaryDraft(value: DailySummaryDraft): string | null {
  if (typeof value.summaryDate !== "string" || !isDate(value.summaryDate)) {
    return "每日总结日期无效。";
  }
  if (
    typeof value.overview !== "string" ||
    !value.overview.trim() ||
    [...value.overview].length > 2_000
  ) {
    return "总结概览不能为空且不得超过 2000 个字符。";
  }
  for (const list of [value.highlights, value.unfinished, value.tomorrowNotes]) {
    if (
      !Array.isArray(list) ||
      list.length > 8 ||
      list.some((item) => typeof item !== "string" || !item.trim() || [...item].length > 180)
    ) {
      return "每组总结事项最多 8 条，每条不得超过 180 个字符。";
    }
  }
  return null;
}

export function recentDailySummaryRange(today: string): { from: string; to: string } {
  if (!isDate(today)) throw new Error("每日总结日期无效。");
  return { from: addDateDays(today, -3), to: addDateDays(today, -1) };
}

export function projectRecentDailySummaries(
  today: string,
  summaries: readonly DailySummaryHistoryItem[],
): readonly DailySummaryHistoryItem[] {
  const { from, to } = recentDailySummaryRange(today);
  const encoder = new TextEncoder();
  const projected: DailySummaryHistoryItem[] = [];
  for (const item of summaries
    .filter((entry) => entry.summaryDate >= from && entry.summaryDate <= to)
    .sort((left, right) => right.summaryDate.localeCompare(left.summaryDate))
    .slice(0, 3)) {
    const candidate = Object.freeze({
      summaryDate: item.summaryDate,
      overview: truncateUtf8(item.overview, 1_000),
      highlights: Object.freeze(
        item.highlights.slice(0, 4).map((value) => truncateUtf8(value, 100)),
      ),
      unfinished: Object.freeze(
        item.unfinished.slice(0, 4).map((value) => truncateUtf8(value, 100)),
      ),
      tomorrowNotes: Object.freeze(
        item.tomorrowNotes.slice(0, 4).map((value) => truncateUtf8(value, 100)),
      ),
    });
    projected.push(candidate);
    if (encoder.encode(JSON.stringify(projected)).byteLength > MAX_RECENT_SUMMARY_CONTEXT_BYTES) {
      projected.pop();
      break;
    }
  }
  return Object.freeze(projected);
}

/** Carry-over claims require an adjacent-day summary and an exact current open-task match. */
export function deriveDailySummaryCarryOvers(
  today: string,
  summaries: readonly DailySummaryHistoryItem[],
  currentOpenTaskTitles: readonly string[],
): readonly string[] {
  const previousDate = addDateDays(today, -1);
  const previous = summaries.find((item) => item.summaryDate === previousDate);
  if (!previous) return Object.freeze([]);
  const current = new Map<string, string>();
  for (const title of currentOpenTaskTitles) {
    const key = normalizeTitle(title);
    if (key) current.set(key, title.trim());
  }
  const historicalItems = [...previous.unfinished, ...previous.tomorrowNotes].map(
    normalizeCarryOverTitle,
  );
  const matched = historicalItems.flatMap((value) => {
    const title = current.get(normalizeTitle(value));
    return title ? [`继续推进：${title}`] : [];
  });
  return Object.freeze([...new Set(matched)].slice(0, 4));
}

function normalizeTitle(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN");
}

function normalizeCarryOverTitle(value: string): string {
  return value.trim().replace(/^(?:待办|学业事项|任务)：\s*/u, "");
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const size = encoder.encode(character).byteLength;
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isoWeekday(date: string): number | null {
  if (!isDate(date)) return null;
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function localTimestampDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDateDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
