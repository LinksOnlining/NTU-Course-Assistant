import type { AcademicCourseOccurrence } from "../types/academic-occurrence.ts";
import type { AcademicTask } from "../types/academic-task.ts";
import type { Exam } from "../types/exam.ts";
import type { ReminderPlan, ReminderConfiguration } from "../types/reminder.ts";
import { parseShanghaiDateTime } from "./reminder.ts";

export type ReminderTargetType = "COURSE" | "TASK" | "EXAM";

export interface ReminderRule {
  readonly id: string;
  readonly targetType: ReminderTargetType;
  readonly targetId: string;
  readonly offsetsMinutes: readonly number[];
  readonly enabled: boolean;
}

export interface ReminderInstance {
  readonly id: string;
  readonly ruleId: string;
  readonly occurrenceKey: string;
  readonly triggerAtMilliseconds: number;
}

export interface ReminderTarget {
  readonly type: ReminderTargetType;
  readonly id: string;
  readonly at: string;
  readonly occurrenceKey: string;
  readonly title: string;
  readonly detail?: string;
}

function dateTimeMilliseconds(date: string, time: string): number {
  return parseShanghaiDateTime(`${date}T${time}:00+08:00`);
}

export function buildReminderTargets(
  occurrences: readonly AcademicCourseOccurrence[],
  tasks: readonly AcademicTask[],
  exams: readonly Exam[],
): readonly ReminderTarget[] {
  const courseTargets = occurrences
    .filter((item) => item.status !== "CANCELLED")
    .map((item) => ({
      type: "COURSE" as const,
      id: item.courseId,
      at: `${item.date}T${item.startTime}`,
      occurrenceKey: item.occurrenceKey,
      title: "课程",
      detail: item.room ?? undefined,
    }));
  const taskTargets = tasks
    .filter((item) => item.status !== "COMPLETED")
    .map((item) => ({
      type: "TASK" as const,
      id: item.id,
      at: item.dueAt,
      occurrenceKey: `task:${item.id}:${item.dueAt}`,
      title: item.title,
    }));
  const examTargets = exams
    .filter((item) => item.status === "SCHEDULED")
    .map((item) => ({
      type: "EXAM" as const,
      id: item.id,
      at: item.startsAt,
      occurrenceKey: `exam:${item.id}:${item.startsAt}`,
      title: item.title,
      detail: item.location ?? undefined,
    }));
  return [...courseTargets, ...taskTargets, ...examTargets].sort((left, right) =>
    left.at.localeCompare(right.at),
  );
}

export function buildReminderInstances(
  rules: readonly ReminderRule[],
  targets: readonly ReminderTarget[],
  nowMilliseconds: number,
): readonly ReminderInstance[] {
  const targetMap = new Map(targets.map((target) => [`${target.type}:${target.id}`, target]));
  return rules.flatMap((rule) => {
    if (!rule.enabled) return [];
    const target = targetMap.get(`${rule.targetType}:${rule.targetId}`);
    if (!target) return [];
    return rule.offsetsMinutes
      .filter((offset) => Number.isInteger(offset) && offset >= 0)
      .map((offset) => ({
        id: `${rule.id}:${target.occurrenceKey}:${offset}`,
        ruleId: rule.id,
        occurrenceKey: `${target.occurrenceKey}:${offset}`,
        triggerAtMilliseconds:
          dateTimeMilliseconds(target.at.slice(0, 10), target.at.slice(11, 16)) - offset * 60_000,
      }))
      .filter((instance) => instance.triggerAtMilliseconds >= nowMilliseconds - 60_000);
  });
}

/** Build the scheduler's existing plan contract from the canonical academic read models. */
export function buildUnifiedReminderPlans(
  occurrences: readonly AcademicCourseOccurrence[],
  tasks: readonly AcademicTask[],
  exams: readonly Exam[],
  configuration: ReminderConfiguration,
): readonly ReminderPlan[] {
  if (!configuration.reminderSettings.enabled) return [];
  const courseOffset = configuration.reminderSettings.advanceMinutes;
  const targetPlans: Array<{
    key: string;
    at: string;
    title: string;
    classroom: string | null;
    offsets: readonly number[];
  }> = [
    ...occurrences
      .filter((item) => item.status !== "CANCELLED")
      .map((item) => ({
        key: item.occurrenceKey,
        at: `${item.date}T${item.startTime}:00+08:00`,
        title: "课程",
        classroom: item.room,
        offsets: [courseOffset],
      })),
    ...tasks
      .filter((item) => item.status !== "COMPLETED")
      .map((item) => ({
        key: `task:${item.id}:${item.dueAt}`,
        at: item.dueAt,
        title: `截止：${item.title}`,
        classroom: null,
        offsets: [1_440, 120],
      })),
    ...exams
      .filter((item) => item.status === "SCHEDULED")
      .map((item) => ({
        key: `exam:${item.id}:${item.startsAt}`,
        at: item.startsAt,
        title: `考试：${item.title}`,
        classroom: item.location,
        offsets: [10_080, 1_440, 120],
      })),
  ];
  return targetPlans.flatMap((target) => {
    let start: number;
    try {
      start = parseShanghaiDateTime(target.at);
    } catch {
      return [];
    }
    return target.offsets.map((offset) => ({
      occurrenceKey: `${target.key}:${offset}`,
      triggerAtMilliseconds: start - offset * 60_000,
      courseStartMilliseconds: start,
      notification: {
        courseName: target.title,
        startTime: target.at.slice(0, 16).replace("T", " "),
        classroom: target.classroom,
      },
    }));
  });
}

export function reminderTimeLabel(offsetMinutes: number): string {
  if (offsetMinutes % (24 * 60) === 0) return `${offsetMinutes / (24 * 60)} 天前`;
  if (offsetMinutes % 60 === 0) return `${offsetMinutes / 60} 小时前`;
  return `${offsetMinutes} 分钟前`;
}
