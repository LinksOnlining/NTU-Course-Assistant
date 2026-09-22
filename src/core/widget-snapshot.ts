import type { AcademicCourseOccurrence } from "../types/academic-occurrence.ts";
import type { AcademicTask } from "../types/academic-task.ts";
import type { Exam } from "../types/exam.ts";
import type { TodayDashboard } from "./today-dashboard.ts";

export type WidgetSnapshotMode = "NEXT" | "TODAY" | "DEADLINES";

export interface WidgetSnapshot {
  readonly mode: WidgetSnapshotMode;
  readonly next: AcademicCourseOccurrence | null;
  readonly today: readonly AcademicCourseOccurrence[];
  readonly tasks: readonly AcademicTask[];
  readonly exams: readonly Exam[];
}

export function getWidgetSnapshot(
  mode: WidgetSnapshotMode,
  dashboard: TodayDashboard,
): WidgetSnapshot {
  return {
    mode,
    next: dashboard.nextOccurrence,
    today: dashboard.todayOccurrences.filter((item) => item.status !== "CANCELLED"),
    tasks:
      dashboard.overdueTasks.length > 0
        ? [...dashboard.overdueTasks, ...dashboard.upcomingTasks].slice(0, 5)
        : dashboard.upcomingTasks.slice(0, 5),
    exams: dashboard.upcomingExam ? [dashboard.upcomingExam] : [],
  };
}
