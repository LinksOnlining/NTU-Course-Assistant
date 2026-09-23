import * as plannerStorage from "../../services/planner-storage.ts";
import type {
  PlannerEvent,
  PlannerEventDraft,
  TimeBlock,
  TimeBlockDraft,
} from "../../types/planner.ts";
import {
  isValidPlannerDate,
  isValidPlannerEndTime,
  isValidPlannerTime,
  validatePlannerDateRange,
} from "./date-time.ts";

export interface PlannerScheduleRepository {
  loadPlannerEvents(startDate: string, endDate: string): Promise<readonly PlannerEvent[]>;
  createPlannerEvent(event: PlannerEvent): Promise<PlannerEvent>;
  updatePlannerEvent(event: PlannerEvent): Promise<PlannerEvent>;
  deletePlannerEvent(id: string): Promise<void>;
  loadTimeBlocks(startDate: string, endDate: string): Promise<readonly TimeBlock[]>;
  loadTimeBlocksForTask(personalTaskId: string): Promise<readonly TimeBlock[]>;
  createTimeBlock(block: TimeBlock): Promise<TimeBlock>;
  updateTimeBlock(block: TimeBlock): Promise<TimeBlock>;
  deleteTimeBlock(id: string): Promise<void>;
}

export type PlannerEventDraftErrors = Partial<Record<keyof PlannerEventDraft, string>>;
export type TimeBlockDraftErrors = Partial<Record<keyof TimeBlockDraft, string>>;

function validateInterval(
  date: string,
  startTime: string,
  endTime: string,
  errors: Partial<Record<"date" | "startTime" | "endTime", string>>,
): void {
  if (!isValidPlannerDate(date)) errors.date = "请输入有效的日期。";
  if (!isValidPlannerTime(startTime)) errors.startTime = "请输入有效的开始时间。";
  if (!isValidPlannerEndTime(endTime)) errors.endTime = "请输入有效的结束时间。";
  if (!errors.startTime && !errors.endTime) {
    if (startTime === endTime) errors.endTime = "结束时间必须晚于开始时间。";
    else if (startTime > endTime) errors.endTime = "当前版本暂不支持跨午夜日程。";
  }
}

function validateBuffers(
  before: number,
  after: number,
  errors: Partial<Record<"bufferBeforeMinutes" | "bufferAfterMinutes", string>>,
): void {
  if (!Number.isInteger(before) || before < 0 || before > 240) {
    errors.bufferBeforeMinutes = "提前缓冲必须在 0–240 分钟之间。";
  }
  if (!Number.isInteger(after) || after < 0 || after > 240) {
    errors.bufferAfterMinutes = "延后缓冲必须在 0–240 分钟之间。";
  }
}

export function validatePlannerEventDraft(draft: PlannerEventDraft): PlannerEventDraftErrors {
  const errors: PlannerEventDraftErrors = {};
  if (!draft.title.trim()) errors.title = "请输入日程标题。";
  else if ([...draft.title.trim()].length > 200) errors.title = "标题最多 200 个字符。";
  if ([...draft.description].length > 5000) errors.description = "描述最多 5000 个字符。";
  if ([...draft.location.trim()].length > 200) errors.location = "地点最多 200 个字符。";
  validateInterval(draft.date, draft.startTime, draft.endTime, errors);
  validateBuffers(draft.bufferBeforeMinutes, draft.bufferAfterMinutes, errors);
  return errors;
}

export function validateTimeBlockDraft(draft: TimeBlockDraft): TimeBlockDraftErrors {
  const errors: TimeBlockDraftErrors = {};
  if (!draft.personalTaskId.trim()) errors.personalTaskId = "请选择关联任务。";
  validateInterval(draft.date, draft.startTime, draft.endTime, errors);
  validateBuffers(draft.bufferBeforeMinutes, draft.bufferAfterMinutes, errors);
  return errors;
}

function assertDraft<T>(errors: Partial<Record<keyof T, string>>): void {
  const first = Object.values(errors).find((value) => typeof value === "string");
  if (typeof first === "string") throw new Error(first);
}

function createEvent(
  id: string,
  draft: PlannerEventDraft,
  now: Date,
  existing?: PlannerEvent,
): PlannerEvent {
  const timestamp = now.toISOString();
  return {
    id,
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    date: draft.date,
    startTime: draft.startTime,
    endTime: draft.endTime,
    location: draft.location.trim() || null,
    bufferBeforeMinutes: draft.bufferBeforeMinutes,
    bufferAfterMinutes: draft.bufferAfterMinutes,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

function createBlock(
  id: string,
  draft: TimeBlockDraft,
  now: Date,
  existing?: TimeBlock,
): TimeBlock {
  const timestamp = now.toISOString();
  return {
    ...draft,
    id,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

export function loadPlannerEvents(
  startDate: string,
  endDate: string,
  repository: PlannerScheduleRepository = plannerStorage,
): Promise<readonly PlannerEvent[]> {
  const error = validatePlannerDateRange(startDate, endDate);
  if (error) return Promise.reject(new Error(error));
  return repository.loadPlannerEvents(startDate, endDate);
}

export function createPlannerEvent(
  draft: PlannerEventDraft,
  repository: PlannerScheduleRepository = plannerStorage,
  now = new Date(),
  id = crypto.randomUUID(),
): Promise<PlannerEvent> {
  assertDraft<PlannerEventDraft>(validatePlannerEventDraft(draft));
  return repository.createPlannerEvent(createEvent(id, draft, now));
}

export function updatePlannerEvent(
  existing: PlannerEvent,
  draft: PlannerEventDraft,
  repository: PlannerScheduleRepository = plannerStorage,
  now = new Date(),
): Promise<PlannerEvent> {
  assertDraft<PlannerEventDraft>(validatePlannerEventDraft(draft));
  return repository.updatePlannerEvent(createEvent(existing.id, draft, now, existing));
}

export function deletePlannerEvent(
  id: string,
  repository: PlannerScheduleRepository = plannerStorage,
): Promise<void> {
  return repository.deletePlannerEvent(id);
}

export function loadTimeBlocks(
  startDate: string,
  endDate: string,
  repository: PlannerScheduleRepository = plannerStorage,
): Promise<readonly TimeBlock[]> {
  const error = validatePlannerDateRange(startDate, endDate);
  if (error) return Promise.reject(new Error(error));
  return repository.loadTimeBlocks(startDate, endDate);
}

export function loadTimeBlocksForTask(
  personalTaskId: string,
  repository: PlannerScheduleRepository = plannerStorage,
): Promise<readonly TimeBlock[]> {
  if (!personalTaskId.trim()) return Promise.reject(new Error("请选择关联任务。"));
  return repository.loadTimeBlocksForTask(personalTaskId);
}

export function createTimeBlock(
  draft: TimeBlockDraft,
  repository: PlannerScheduleRepository = plannerStorage,
  now = new Date(),
  id = crypto.randomUUID(),
): Promise<TimeBlock> {
  assertDraft<TimeBlockDraft>(validateTimeBlockDraft(draft));
  return repository.createTimeBlock(createBlock(id, draft, now));
}

export function updateTimeBlock(
  existing: TimeBlock,
  draft: TimeBlockDraft,
  repository: PlannerScheduleRepository = plannerStorage,
  now = new Date(),
): Promise<TimeBlock> {
  assertDraft<TimeBlockDraft>(validateTimeBlockDraft(draft));
  return repository.updateTimeBlock(createBlock(existing.id, draft, now, existing));
}

export function deleteTimeBlock(
  id: string,
  repository: PlannerScheduleRepository = plannerStorage,
): Promise<void> {
  return repository.deleteTimeBlock(id);
}
