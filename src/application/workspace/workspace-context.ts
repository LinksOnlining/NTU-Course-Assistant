import { computeFreeTimeIntervals, effectiveOccupancy } from "../timeline/planner-interactions.ts";
import type { TimelineItem } from "../timeline/types.ts";
import type { AcademicTask } from "../../types/academic-task.ts";
import type { PersonalTask } from "../../types/personal-task.ts";
import type { WeatherSnapshot } from "../../types/weather.ts";
import type { Routine, RoutineSuggestion } from "../../types/routine.ts";
import { collectWorkspaceContextFragments } from "./context-provider-registry.ts";
import type { WorkspaceContextWeatherSummary } from "./context-provider-registry.ts";

export interface WorkspaceContextTimeSlot {
  readonly date: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly durationMinutes: number;
}

export type WorkspaceWeatherSummary = WorkspaceContextWeatherSummary;

export interface WorkspaceContext {
  readonly date: string;
  readonly localTime: string;
  readonly currentItem: TimelineItem | null;
  readonly nextItem: TimelineItem | null;
  readonly nextFreeSlot: WorkspaceContextTimeSlot | null;
  readonly todayItemCount: number;
  readonly remainingItemCount: number;
  readonly openTaskCount: number;
  readonly overdueTaskCount: number;
  readonly todayTaskCount: number;
  readonly weatherSummary: WorkspaceWeatherSummary | null;
  readonly hasDiaryToday: boolean;
  readonly pendingInboxCount: number;
  readonly routineSuggestion: RoutineSuggestion | null;
}

export interface WorkspaceContextInput {
  readonly date: string;
  readonly localTime: string;
  readonly timelineItems: readonly TimelineItem[];
  readonly futureItems?: readonly TimelineItem[];
  readonly academicTasks: readonly AcademicTask[];
  readonly personalTasks: readonly PersonalTask[];
  readonly weatherSnapshot: WeatherSnapshot | null;
  readonly hasDiaryToday: boolean;
  readonly pendingInboxCount: number;
  readonly routines?: readonly Routine[];
}

function minuteOfDay(value: string): number {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return 0;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : 0;
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function deadlineParts(value: string): { date: string; time: string } | null {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return { date: localDate(parsed), time: localTime(parsed) };
}

function taskDeadlineCounts(input: WorkspaceContextInput): {
  openTaskCount: number;
  overdueTaskCount: number;
  todayTaskCount: number;
} {
  let openTaskCount = 0;
  let overdueTaskCount = 0;
  let todayTaskCount = 0;
  const now = minuteOfDay(input.localTime);

  for (const task of input.academicTasks) {
    if (task.status === "COMPLETED") continue;
    openTaskCount += 1;
    const deadline = deadlineParts(task.dueAt);
    if (!deadline) continue;
    if (
      deadline.date < input.date ||
      (deadline.date === input.date && minuteOfDay(deadline.time) < now)
    ) {
      overdueTaskCount += 1;
    }
    if (deadline.date === input.date) todayTaskCount += 1;
  }

  for (const task of input.personalTasks) {
    if (task.status === "completed") continue;
    openTaskCount += 1;
    if (!task.deadlineDate) continue;
    const deadlineTime = task.deadlineTime ?? "23:59";
    if (
      task.deadlineDate < input.date ||
      (task.deadlineDate === input.date && minuteOfDay(deadlineTime) < now)
    ) {
      overdueTaskCount += 1;
    }
    if (task.deadlineDate === input.date) todayTaskCount += 1;
  }

  return { openTaskCount, overdueTaskCount, todayTaskCount };
}

function nextFreeSlot(input: WorkspaceContextInput, now: number): WorkspaceContextTimeSlot | null {
  const timeline = input.futureItems ?? input.timelineItems;
  const dates = [
    input.date,
    ...[...new Set(timeline.map((item) => item.date).filter((date) => date > input.date))].sort(),
  ];
  for (const date of dates) {
    const items = timeline.filter((item) => item.date === date);
    const earliest = date === input.date ? now : 0;
    const interval = computeFreeTimeIntervals(items).find((slot) => slot.endMinute > earliest);
    if (!interval) continue;
    const startMinute = Math.max(earliest, interval.startMinute);
    if (interval.endMinute <= startMinute) continue;
    return {
      date,
      startMinute,
      endMinute: interval.endMinute,
      durationMinutes: interval.endMinute - startMinute,
    };
  }
  return null;
}

export function buildWorkspaceContext(input: WorkspaceContextInput): WorkspaceContext {
  const now = minuteOfDay(input.localTime);
  const todayItems = input.timelineItems.filter((item) => effectiveOccupancy(item) !== null);
  const ordered = [...(input.futureItems ?? input.timelineItems)]
    .filter((item) => effectiveOccupancy(item) !== null)
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        (effectiveOccupancy(left)?.startMinute ?? 0) -
          (effectiveOccupancy(right)?.startMinute ?? 0) ||
        left.id.localeCompare(right.id),
    );
  const currentItem =
    todayItems.find((item) => {
      const occupancy = effectiveOccupancy(item);
      return occupancy !== null && occupancy.startMinute <= now && now < occupancy.endMinute;
    }) ?? null;
  const nextItem =
    ordered.find((item) => {
      if (currentItem && item.id === currentItem.id && item.date === currentItem.date) return false;
      if (item.date > input.date) return true;
      const occupancy = effectiveOccupancy(item);
      return occupancy !== null && occupancy.endMinute > now;
    }) ?? null;
  const freeSlot = nextFreeSlot(input, now);
  const taskCounts = taskDeadlineCounts(input);
  const moduleContext = collectWorkspaceContextFragments({
    "diary.context": { hasDiaryToday: input.hasDiaryToday },
    "inbox.context": { pendingInboxCount: input.pendingInboxCount },
    "weather.context": { weatherSnapshot: input.weatherSnapshot },
    "routine.context": {
      today: input.date,
      now: input.localTime,
      routines: input.routines ?? [],
      timelineItems: input.futureItems ?? input.timelineItems,
    },
  });

  return {
    date: input.date,
    localTime: input.localTime,
    currentItem,
    nextItem,
    nextFreeSlot: freeSlot,
    todayItemCount: todayItems.length,
    remainingItemCount: todayItems.filter((item) => minuteOfDay(item.endTime) > now).length,
    ...taskCounts,
    weatherSummary: moduleContext.weatherSummary ?? null,
    hasDiaryToday: moduleContext.hasDiaryToday ?? false,
    pendingInboxCount: moduleContext.pendingInboxCount ?? 0,
    routineSuggestion: moduleContext.routineSuggestion ?? null,
  };
}
