import * as plannerStorage from "../../services/planner-storage.ts";
import type { PlannerEvent, PlannerEventDraft } from "../../types/planner.ts";
import type { Routine, RoutineDraft, RoutineSuggestion } from "../../types/routine.ts";
import type { TimelineItem } from "../timeline/types.ts";
import {
  computeFreeTimeIntervals,
  formatTimelineMinute,
  timeToDayMinute,
} from "../timeline/index.ts";
import { plannerEventFromDraft, validatePlannerEventDraft } from "./planner-schedule.ts";

export interface RoutineRepository {
  loadRoutines(): Promise<readonly Routine[]>;
  createRoutine(routine: Routine): Promise<Routine>;
  updateRoutine(routine: Routine): Promise<Routine>;
  deleteRoutine(id: string): Promise<void>;
  confirmRoutineSuggestion(
    routineId: string,
    targetDate: string,
    event: PlannerEvent,
  ): Promise<PlannerEvent>;
}

export interface RoutineSuggestionInput {
  readonly today: string;
  readonly now: string;
  readonly routines: readonly Routine[];
  readonly timelineItems: readonly TimelineItem[];
}

export function validateRoutineDraft(draft: RoutineDraft): string | null {
  if (!draft.title.trim()) return "请输入日常习惯名称。";
  if ([...draft.title.trim()].length > 200) return "名称最多 200 个字符。";
  if (
    !Number.isInteger(draft.targetDurationMinutes) ||
    draft.targetDurationMinutes < 5 ||
    draft.targetDurationMinutes > 720
  ) {
    return "目标时长必须在 5–720 分钟之间。";
  }
  if (!Number.isInteger(draft.weekdaysMask) || draft.weekdaysMask < 1 || draft.weekdaysMask > 127) {
    return "至少选择一个适用星期。";
  }
  const { preferredStartTime: start, preferredEndTime: end } = draft;
  if ((start === null) !== (end === null)) return "偏好时间窗口需要同时填写开始和结束时间。";
  if (start !== null && end !== null) {
    const startMinute = timeToDayMinute(start);
    const endMinute = timeToDayMinute(end);
    if (startMinute === null || endMinute === null || startMinute >= endMinute) {
      return "请输入有效的偏好时间窗口。";
    }
  }
  return null;
}

export function loadRoutines(
  repository: RoutineRepository = plannerStorage,
): Promise<readonly Routine[]> {
  return repository.loadRoutines();
}

export function createRoutine(
  draft: RoutineDraft,
  repository: RoutineRepository = plannerStorage,
  now = new Date(),
  id = crypto.randomUUID(),
): Promise<Routine> {
  const error = validateRoutineDraft(draft);
  if (error) return Promise.reject(new Error(error));
  const timestamp = now.toISOString();
  return repository.createRoutine({
    ...draft,
    title: draft.title.trim(),
    id,
    lastScheduledDate: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function updateRoutine(
  existing: Routine,
  draft: RoutineDraft,
  repository: RoutineRepository = plannerStorage,
  now = new Date(),
): Promise<Routine> {
  const error = validateRoutineDraft(draft);
  if (error) return Promise.reject(new Error(error));
  return repository.updateRoutine({
    ...existing,
    ...draft,
    title: draft.title.trim(),
    updatedAt: now.toISOString(),
  });
}

export function deleteRoutine(
  id: string,
  repository: RoutineRepository = plannerStorage,
): Promise<void> {
  return repository.deleteRoutine(id);
}

function isoWeekday(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return null;
  const day = parsed.getUTCDay();
  return day === 0 ? 7 : day;
}

function stableRoutineOrder(left: Routine, right: Routine): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function suggestRoutine(input: RoutineSuggestionInput): RoutineSuggestion | null {
  const weekday = isoWeekday(input.today);
  const nowMinute = timeToDayMinute(input.now);
  if (weekday === null || nowMinute === null) return null;

  const todayItems = input.timelineItems.filter((item) => item.date === input.today);
  const freeIntervals = computeFreeTimeIntervals(todayItems);
  for (const routine of [...input.routines].sort(stableRoutineOrder)) {
    if (!routine.enabled || routine.lastScheduledDate === input.today) continue;
    if ((routine.weekdaysMask & (1 << (weekday - 1))) === 0) continue;
    const preferredStart =
      routine.preferredStartTime === null ? 0 : timeToDayMinute(routine.preferredStartTime);
    const preferredEnd =
      routine.preferredEndTime === null ? 1440 : timeToDayMinute(routine.preferredEndTime);
    if (preferredStart === null || preferredEnd === null) continue;

    for (const interval of freeIntervals) {
      const start = Math.max(interval.startMinute, nowMinute, preferredStart);
      const end = Math.min(interval.endMinute, preferredEnd === 0 ? 1440 : preferredEnd);
      if (end - start < routine.targetDurationMinutes) continue;
      return {
        routineId: routine.id,
        title: routine.title,
        targetDate: input.today,
        startTime: formatTimelineMinute(start),
        endTime: formatTimelineMinute(start + routine.targetDurationMinutes),
        targetDurationMinutes: routine.targetDurationMinutes,
      };
    }
  }
  return null;
}

export function confirmRoutineSuggestion(
  routineId: string,
  targetDate: string,
  draft: PlannerEventDraft,
  repository: RoutineRepository = plannerStorage,
  now = new Date(),
  id = crypto.randomUUID(),
): Promise<PlannerEvent> {
  const errors = validatePlannerEventDraft(draft);
  const firstError = Object.values(errors).find((message) => typeof message === "string");
  if (firstError) return Promise.reject(new Error(firstError));
  const event = plannerEventFromDraft(id, draft, now);
  return repository.confirmRoutineSuggestion(routineId, targetDate, event);
}
