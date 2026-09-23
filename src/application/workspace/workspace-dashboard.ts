import {
  loadAcademicHubData,
  loadAcademicScheduleData,
  resolveAcademicOccurrences,
  type AcademicHubLoadOptions,
  type AcademicHubData,
  type AcademicScheduleData,
} from "../academic/index.ts";
import { projectAcademicOccurrencesToTimelineItems } from "../timeline/index.ts";
import type { AcademicTask } from "../../types/academic-task.ts";
import type { Semester } from "../../types/semester.ts";
import type { TermConfig } from "../../types/reminder.ts";
import type {
  WorkspaceDashboardSources,
  WorkspaceDashboardViewModel,
  WorkspaceTaskPreview,
} from "./types.ts";

const LEGACY_SEMESTER_ID = "legacy-active-semester";
const TASK_PREVIEW_LIMIT = 4;

export interface WorkspaceDashboardReader {
  loadScheduleData(): Promise<AcademicScheduleData>;
  loadHubData(options: AcademicHubLoadOptions): Promise<AcademicHubData>;
}

const defaultReader: WorkspaceDashboardReader = {
  loadScheduleData: loadAcademicScheduleData,
  loadHubData: loadAcademicHubData,
};

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function localTimeKey(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function legacySemester(termConfig: TermConfig | null): Semester | null {
  if (!termConfig) return null;
  return {
    id: LEGACY_SEMESTER_ID,
    name: "当前学期",
    firstWeekMonday: termConfig.firstWeekMonday,
    totalWeeks: termConfig.totalWeeks,
    timezone: termConfig.timezone,
    status: "ACTIVE",
    createdAt: "",
    updatedAt: "",
  };
}

export async function loadWorkspaceDashboardSources(
  date: string,
  termConfig: TermConfig | null,
  reader: WorkspaceDashboardReader = defaultReader,
): Promise<WorkspaceDashboardSources> {
  const options: AcademicHubLoadOptions = {
    fallbackSemesterId: termConfig ? LEGACY_SEMESTER_ID : undefined,
  };
  const [schedule, hub] = await Promise.all([
    reader.loadScheduleData(),
    reader.loadHubData(options),
  ]);
  const activeSemester =
    hub.semesters.find((semester) => semester.status === "ACTIVE") ??
    (hub.semesters.length === 0 ? legacySemester(termConfig) : null);
  const occurrences = activeSemester
    ? resolveAcademicOccurrences(
        schedule.courses,
        activeSemester,
        hub.overrides,
        { from: date, to: date },
        schedule.periodTimes ?? [],
      )
    : [];

  return {
    date,
    timelineItems: projectAcademicOccurrencesToTimelineItems(occurrences, schedule.courses),
    tasks: hub.tasks,
    warnings: schedule.warnings,
  };
}

function taskDeadline(task: AcademicTask, today: string, nowTime: string): WorkspaceTaskPreview {
  if (task.dueAt.trim() === "") {
    return {
      id: task.id,
      title: task.title,
      dueAt: null,
      deadlineKind: "none",
      deadlineLabel: "无截止日期",
      priority: task.priority,
      sourceLabel: "学业",
    };
  }

  const date = new Date(task.dueAt);
  if (!Number.isFinite(date.getTime())) {
    return {
      id: task.id,
      title: task.title,
      dueAt: task.dueAt,
      deadlineKind: "invalid",
      deadlineLabel: "截止日期待确认",
      priority: task.priority,
      sourceLabel: "学业",
    };
  }

  const taskDate = localDateKey(date);
  const taskTime = localTimeKey(date);
  const deadlineKind =
    taskDate < today || (taskDate === today && taskTime < nowTime)
      ? "overdue"
      : taskDate === today
        ? "today"
        : "upcoming";
  const deadlineLabel =
    deadlineKind === "overdue"
      ? `已逾期 · ${taskDate} ${taskTime}`
      : deadlineKind === "today"
        ? `今天 ${taskTime} 到期`
        : `${taskDate} ${taskTime}`;
  return {
    id: task.id,
    title: task.title,
    dueAt: task.dueAt,
    deadlineKind,
    deadlineLabel,
    priority: task.priority,
    sourceLabel: "学业",
  };
}

function deadlineOrder(kind: WorkspaceTaskPreview["deadlineKind"]): number {
  switch (kind) {
    case "overdue":
      return 0;
    case "today":
      return 1;
    case "upcoming":
      return 2;
    case "none":
      return 3;
    case "invalid":
      return 4;
  }
}

function buildTaskSummary(
  tasks: readonly AcademicTask[],
  today: string,
  nowTime: string,
): WorkspaceDashboardViewModel["taskSummary"] {
  const items = tasks
    .filter((task) => task.status !== "COMPLETED")
    .map((task) => taskDeadline(task, today, nowTime))
    .sort(
      (left, right) =>
        deadlineOrder(left.deadlineKind) - deadlineOrder(right.deadlineKind) ||
        (left.dueAt ?? "\uffff").localeCompare(right.dueAt ?? "\uffff") ||
        right.priority - left.priority ||
        left.id.localeCompare(right.id),
    );
  const preview = items.slice(0, TASK_PREVIEW_LIMIT);
  return {
    source: "academic",
    items: preview,
    totalOpenCount: items.length,
    hiddenCount: Math.max(0, items.length - preview.length),
  };
}

function findNextItem(
  items: readonly WorkspaceDashboardSources["timelineItems"][number][],
  nowTime: string,
): WorkspaceDashboardViewModel["nextItem"] {
  const occupied = items
    .filter((item) => item.occupiesTime)
    .sort(
      (left, right) =>
        left.startTime.localeCompare(right.startTime) || left.endTime.localeCompare(right.endTime),
    );
  return (
    occupied.find((item) => item.startTime <= nowTime && nowTime < item.endTime) ??
    occupied.find((item) => item.endTime > nowTime) ??
    null
  );
}

export function buildWorkspaceDashboardViewModel(
  sources: WorkspaceDashboardSources,
  nowTime: string,
): WorkspaceDashboardViewModel {
  return {
    date: sources.date,
    timelineItems: sources.timelineItems,
    todayItemCount: sources.timelineItems.length,
    nextItem: findNextItem(sources.timelineItems, nowTime),
    taskSummary: buildTaskSummary(sources.tasks, sources.date, nowTime),
    moduleAvailability: {
      diary: "unavailable",
      inbox: "unavailable",
      ai: "unavailable",
    },
    warnings: sources.warnings,
  };
}
