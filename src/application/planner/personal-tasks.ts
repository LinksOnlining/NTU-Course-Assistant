import * as plannerStorage from "../../services/planner-storage.ts";
import type {
  PersonalTask,
  PersonalTaskDraft,
  PersonalTaskPriority,
} from "../../types/personal-task.ts";

export interface PersonalTaskRepository {
  loadPersonalTasks(): Promise<readonly PersonalTask[]>;
  createPersonalTask(task: PersonalTask): Promise<PersonalTask>;
  updatePersonalTask(task: PersonalTask): Promise<PersonalTask>;
  setPersonalTaskCompleted(
    id: string,
    completed: boolean,
    updatedAt: string,
  ): Promise<PersonalTask>;
  deletePersonalTask(id: string): Promise<void>;
}

const defaultRepository: PersonalTaskRepository = plannerStorage;
const priorities = new Set<PersonalTaskPriority>(["none", "low", "medium", "high"]);

export type PersonalTaskDraftErrors = Partial<Record<keyof PersonalTaskDraft, string>>;

function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!;
}

function isValidTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function validatePersonalTaskDraft(draft: PersonalTaskDraft): PersonalTaskDraftErrors {
  const errors: PersonalTaskDraftErrors = {};
  const title = draft.title.trim();
  if (!title) errors.title = "请输入任务标题。";
  else if ([...title].length > 200) errors.title = "标题最多 200 个字符。";
  if ([...draft.description].length > 5000) errors.description = "描述最多 5000 个字符。";
  if (!priorities.has(draft.priority)) errors.priority = "请选择有效的优先级。";
  if (draft.deadlineDate && !isValidDate(draft.deadlineDate)) {
    errors.deadlineDate = "请输入有效的日期。";
  }
  if (draft.deadlineTime && !isValidTime(draft.deadlineTime)) {
    errors.deadlineTime = "请输入有效的时间。";
  }
  if (draft.deadlineTime && !draft.deadlineDate) {
    errors.deadlineDate = "填写截止时间时也需要选择日期。";
  }
  return errors;
}

function taskFromDraft(
  id: string,
  draft: PersonalTaskDraft,
  now: Date,
  existing?: PersonalTask,
): PersonalTask {
  const timestamp = now.toISOString();
  return {
    id,
    title: draft.title.trim(),
    description: draft.description.trim() || null,
    status: existing?.status ?? "open",
    priority: draft.priority,
    deadlineDate: draft.deadlineDate || null,
    deadlineTime: draft.deadlineTime || null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    completedAt: existing?.completedAt ?? null,
  };
}

function assertValidDraft(draft: PersonalTaskDraft): void {
  const errors = validatePersonalTaskDraft(draft);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
}

export function loadPersonalTasks(
  repository: PersonalTaskRepository = defaultRepository,
): Promise<readonly PersonalTask[]> {
  return repository.loadPersonalTasks();
}

export function createPersonalTask(
  draft: PersonalTaskDraft,
  repository: PersonalTaskRepository = defaultRepository,
  now = new Date(),
  id = crypto.randomUUID(),
): Promise<PersonalTask> {
  assertValidDraft(draft);
  return repository.createPersonalTask(taskFromDraft(id, draft, now));
}

export function updatePersonalTask(
  existing: PersonalTask,
  draft: PersonalTaskDraft,
  repository: PersonalTaskRepository = defaultRepository,
  now = new Date(),
): Promise<PersonalTask> {
  assertValidDraft(draft);
  return repository.updatePersonalTask(taskFromDraft(existing.id, draft, now, existing));
}

export function setPersonalTaskCompleted(
  id: string,
  completed: boolean,
  repository: PersonalTaskRepository = defaultRepository,
  now = new Date(),
): Promise<PersonalTask> {
  return repository.setPersonalTaskCompleted(id, completed, now.toISOString());
}

export function deletePersonalTask(
  id: string,
  repository: PersonalTaskRepository = defaultRepository,
): Promise<void> {
  return repository.deletePersonalTask(id);
}

export type PersonalTaskDeadlineKind = "overdue" | "today" | "upcoming" | "none";

export function personalTaskDeadlineKind(
  task: PersonalTask,
  today: string,
  nowTime: string,
): PersonalTaskDeadlineKind {
  if (!task.deadlineDate) return "none";
  if (task.deadlineDate < today) return "overdue";
  if (task.deadlineDate > today) return "upcoming";
  return task.deadlineTime && task.deadlineTime < nowTime ? "overdue" : "today";
}

function naturalDateLabel(date: string, today: string): string {
  if (date === today) return "今天";
  const dateValue = new Date(`${date}T12:00:00`);
  const todayValue = new Date(`${today}T12:00:00`);
  const delta = Math.round((dateValue.getTime() - todayValue.getTime()) / 86_400_000);
  if (delta === 1) return "明天";
  if (delta > 1 && delta < 7) return `周${"日一二三四五六"[dateValue.getDay()]}`;
  return `${dateValue.getMonth() + 1}月${dateValue.getDate()}日`;
}

export function personalTaskDeadlineLabel(
  task: PersonalTask,
  today: string,
  nowTime: string,
): string {
  const kind = personalTaskDeadlineKind(task, today, nowTime);
  if (!task.deadlineDate) return "无截止日期";
  const date = naturalDateLabel(task.deadlineDate, today);
  const time = task.deadlineTime ? ` ${task.deadlineTime}` : "";
  return `${kind === "overdue" ? "已逾期 · " : ""}${date}${time}`;
}

export function sortPersonalTasks(
  tasks: readonly PersonalTask[],
  today: string,
  nowTime: string,
): readonly PersonalTask[] {
  return [...tasks].sort((left, right) => {
    const leftKind = personalTaskDeadlineKind(left, today, nowTime);
    const rightKind = personalTaskDeadlineKind(right, today, nowTime);
    const kindOrder = ["overdue", "today", "upcoming", "none"];
    const group = kindOrder.indexOf(leftKind) - kindOrder.indexOf(rightKind);
    if (group) return group;
    const date = (left.deadlineDate ?? "\uffff").localeCompare(right.deadlineDate ?? "\uffff");
    if (date) return date;
    const time = (left.deadlineTime ?? "\uffff").localeCompare(right.deadlineTime ?? "\uffff");
    if (time) return time;
    const priorityOrder: Record<PersonalTaskPriority, number> = {
      high: 0,
      medium: 1,
      low: 2,
      none: 3,
    };
    return (
      priorityOrder[left.priority] - priorityOrder[right.priority] ||
      left.id.localeCompare(right.id)
    );
  });
}
