import type { AcademicCourseOccurrence } from "../types/academic-occurrence.ts";
import type { AcademicTask } from "../types/academic-task.ts";
import type { Exam } from "../types/exam.ts";

export interface TodayDashboard {
  readonly date: string;
  readonly nextOccurrence: AcademicCourseOccurrence | null;
  readonly todayOccurrences: readonly AcademicCourseOccurrence[];
  readonly changes: readonly AcademicCourseOccurrence[];
  readonly dueToday: readonly AcademicTask[];
  readonly overdueTasks: readonly AcademicTask[];
  readonly upcomingTasks: readonly AcademicTask[];
  readonly upcomingExam: Exam | null;
}

export function getTodayDashboard(
  date: string,
  nowTime: string,
  occurrences: readonly AcademicCourseOccurrence[],
  tasks: readonly AcademicTask[],
  exams: readonly Exam[],
): TodayDashboard {
  const todayOccurrences = occurrences
    .filter((occurrence) => occurrence.date === date)
    .sort(
      (left, right) =>
        left.startTime.localeCompare(right.startTime) ||
        left.occurrenceKey.localeCompare(right.occurrenceKey),
    );
  const nextOccurrence =
    todayOccurrences.find(
      (occurrence) => occurrence.status !== "CANCELLED" && occurrence.endTime > nowTime,
    ) ?? null;
  const changes = todayOccurrences.filter((occurrence) => occurrence.status !== "NORMAL");
  const activeTasks = tasks.filter((task) => task.status !== "COMPLETED");
  const dueToday = activeTasks.filter((task) => task.dueAt.slice(0, 10) === date);
  const overdueTasks = activeTasks.filter(
    (task) => task.dueAt < `${date}T${nowTime}` && !dueToday.includes(task),
  );
  const upcomingTasks = activeTasks
    .filter((task) => task.dueAt >= `${date}T${nowTime}`)
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt) || right.priority - left.priority);
  const upcomingExam =
    exams
      .filter((exam) => exam.status === "SCHEDULED" && exam.startsAt >= `${date}T${nowTime}`)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt))[0] ?? null;
  return {
    date,
    nextOccurrence,
    todayOccurrences,
    changes,
    dueToday,
    overdueTasks,
    upcomingTasks,
    upcomingExam,
  };
}
