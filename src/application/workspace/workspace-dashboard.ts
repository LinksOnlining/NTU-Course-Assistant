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
  WorkspaceTimeSection,
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

function nextLocalDate(date: string): string {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + 1);
  return localDateKey(next);
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
  const tomorrow = nextLocalDate(date);
  const occurrences = activeSemester
    ? resolveAcademicOccurrences(
        schedule.courses,
        activeSemester,
        hub.overrides,
        { from: date, to: tomorrow },
        schedule.periodTimes ?? [],
      )
    : [];

  return {
    date,
    timelineItems: projectAcademicOccurrencesToTimelineItems(
      occurrences.filter((item) => item.date === date),
      schedule.courses,
    ),
    tomorrowItems: projectAcademicOccurrencesToTimelineItems(
      occurrences.filter((item) => item.date === tomorrow),
      schedule.courses,
    ),
    tasks: hub.tasks,
    warnings: schedule.warnings,
  };
}

function naturalDueDate(taskDate: string, today: string): string {
  if (taskDate === today) return "今天";
  if (taskDate === nextLocalDate(today)) return "明天";
  const date = new Date(`${taskDate}T12:00:00`);
  const delta = (date.getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000;
  if (delta > 1 && delta < 7) return `周${"日一二三四五六"[date.getDay()]}`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
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
  const deadlineLabel = `${deadlineKind === "overdue" ? "已逾期 · " : ""}${naturalDueDate(taskDate, today)} ${taskTime}`;
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

function minutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function durationLabel(value: number): string {
  if (value < 60) return `${value} 分钟`;
  const hours = Math.floor(value / 60);
  return `${hours} 小时${value % 60 ? ` ${value % 60} 分钟` : ""}`;
}

function clockLabel(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function timeContext(sources: WorkspaceDashboardSources, nowTime: string) {
  const occupied = sources.timelineItems
    .filter((item) => item.occupiesTime)
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime));
  const now = minutes(nowTime);
  const active = occupied.find(
    (item) => minutes(item.startTime) <= now && now < minutes(item.endTime),
  );
  const next = occupied.find((item) => minutes(item.startTime) > now);
  const tomorrow = sources.tomorrowItems
    ?.filter((item) => item.occupiesTime)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
  const courseSection = (
    item: WorkspaceDashboardSources["timelineItems"][number],
    day: "今天" | "明天",
  ): WorkspaceTimeSection => ({
    label: "下一节课",
    value: item.title,
    title: item.title,
    detail: `${day} ${item.startTime}–${item.endTime}`,
    location: item.location,
  });
  let freeStart = now;
  if (active) {
    for (const entry of occupied) {
      if (minutes(entry.startTime) > freeStart) break;
      freeStart = Math.max(freeStart, minutes(entry.endTime));
    }
  }
  const nextAfterFree = occupied.find((entry) => minutes(entry.startTime) > freeStart);
  const freeEnd = nextAfterFree ? minutes(nextAfterFree.startTime) : 1440;
  const primary: WorkspaceTimeSection = active
    ? {
        label: "正在上课",
        value: `还有 ${durationLabel(minutes(active.endTime) - now)}`,
        title: active.title,
        detail: `${active.startTime}–${active.endTime}`,
        location: active.location,
      }
    : {
        label: occupied.length ? "当前空闲" : "今天无课程",
        value: durationLabel(freeEnd - now),
        title: null,
        detail: nextAfterFree ? `至 ${nextAfterFree.startTime}` : "至今天结束",
        location: null,
      };
  const secondary: WorkspaceTimeSection | null = active
    ? next && minutes(next.startTime) <= minutes(active.endTime)
      ? courseSection(next, "今天")
      : freeEnd > freeStart
        ? {
            label: "下一段空闲",
            value: durationLabel(freeEnd - freeStart),
            title: null,
            detail: nextAfterFree
              ? `${clockLabel(freeStart)}–${nextAfterFree.startTime}`
              : `${clockLabel(freeStart)}–24:00`,
            location: null,
          }
        : nextAfterFree
          ? courseSection(nextAfterFree, "今天")
          : tomorrow
            ? courseSection(tomorrow, "明天")
            : null
    : nextAfterFree
      ? courseSection(nextAfterFree, "今天")
      : tomorrow
        ? courseSection(tomorrow, "明天")
        : null;
  const remaining = occupied.filter((entry) => minutes(entry.endTime) > now).length;
  const openTaskCount = sources.tasks.filter((task) => task.status !== "COMPLETED").length;
  return {
    timeContext: { primary, secondary },
    todayStatusText: active
      ? "正在上课"
      : remaining
        ? `今天还有 ${remaining} 节课`
        : occupied.length
          ? "今天的课程已结束"
          : "今天暂无课程",
    todaySummaryText: occupied.length
      ? `${occupied.length} 节课程 · ${openTaskCount} 项待办`
      : openTaskCount
        ? `${openTaskCount} 项待办`
        : "可自由安排今天的时间",
  };
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
    ...timeContext(sources, nowTime),
    taskSummary: buildTaskSummary(sources.tasks, sources.date, nowTime),
    moduleAvailability: {
      diary: "unavailable",
      inbox: "unavailable",
      ai: "unavailable",
    },
    warnings: sources.warnings,
  };
}
