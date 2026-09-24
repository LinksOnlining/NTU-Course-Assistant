import {
  loadAcademicHubData,
  loadAcademicScheduleData,
  resolveAcademicOccurrences,
  type AcademicHubLoadOptions,
  type AcademicHubData,
  type AcademicScheduleData,
} from "../academic/index.ts";
import { projectAcademicOccurrencesToTimelineItems } from "../timeline/index.ts";
import {
  projectPlannerEventsToTimelineItems,
  projectTimeBlocksToTimelineItems,
} from "../timeline/planner-timeline.ts";
import { computeFreeTimeIntervals, effectiveOccupancy } from "../timeline/planner-interactions.ts";
import { loadPersonalTasks } from "../planner/personal-tasks.ts";
import { loadPlannerEvents, loadTimeBlocks } from "../planner/planner-schedule.ts";
import { hasDiaryEntry } from "../../services/diary-storage.ts";
import { countPendingInboxItems } from "../../services/inbox-storage.ts";
import type { AcademicTask } from "../../types/academic-task.ts";
import type { Semester } from "../../types/semester.ts";
import type { PersonalTask } from "../../types/personal-task.ts";
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
  loadPlannerEvents?(startDate: string, endDate: string): ReturnType<typeof loadPlannerEvents>;
  loadTimeBlocks?(startDate: string, endDate: string): ReturnType<typeof loadTimeBlocks>;
  loadPersonalTasks?(): ReturnType<typeof loadPersonalTasks>;
  hasDiaryEntry?(date: string): Promise<boolean>;
  countPendingInboxItems?(): Promise<number>;
}

const defaultReader: WorkspaceDashboardReader = {
  loadScheduleData: loadAcademicScheduleData,
  loadHubData: loadAcademicHubData,
  loadPlannerEvents,
  loadTimeBlocks,
  loadPersonalTasks,
  hasDiaryEntry,
  countPendingInboxItems,
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

function dateAfter(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDateKey(value);
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
  const rangeEnd = dateAfter(date, 7);
  const [schedule, hub, events, blocks, personalTasks, hasDiaryToday, pendingInboxCount] =
    await Promise.all([
      reader.loadScheduleData(),
      reader.loadHubData(options),
      reader.loadPlannerEvents?.(date, rangeEnd) ?? Promise.resolve([]),
      reader.loadTimeBlocks?.(date, rangeEnd) ?? Promise.resolve([]),
      reader.loadPersonalTasks?.() ?? Promise.resolve([]),
      reader.hasDiaryEntry?.(date) ?? Promise.resolve(false),
      reader.countPendingInboxItems?.() ?? Promise.resolve(0),
    ]);
  const activeSemester =
    hub.semesters.find((semester) => semester.status === "ACTIVE") ??
    (hub.semesters.length === 0 ? legacySemester(termConfig) : null);
  const occurrences = activeSemester
    ? resolveAcademicOccurrences(
        schedule.courses,
        activeSemester,
        hub.overrides,
        { from: date, to: rangeEnd },
        schedule.periodTimes ?? [],
      )
    : [];

  const academicItems = activeSemester
    ? projectAcademicOccurrencesToTimelineItems(
        occurrences.filter((item) => item.date >= date && item.date <= rangeEnd),
        schedule.courses,
      )
    : [];
  const eventItems = projectPlannerEventsToTimelineItems(events);
  const timeBlockItems = projectTimeBlocksToTimelineItems(blocks, personalTasks);
  const futureItems = [...academicItems, ...eventItems, ...timeBlockItems].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.startTime.localeCompare(right.startTime) ||
      left.endTime.localeCompare(right.endTime) ||
      left.id.localeCompare(right.id),
  );

  return {
    date,
    timelineItems: futureItems.filter((item) => item.date === date),
    futureItems,
    tasks: hub.tasks,
    personalTasks,
    hasDiaryToday,
    pendingInboxCount,
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

interface TaskDeadline {
  readonly preview: WorkspaceTaskPreview;
  readonly sortDate: string | null;
  readonly sortTime: string | null;
}

function taskDeadline(
  id: string,
  title: string,
  dueAt: string | null,
  priority: number,
  sourceLabel: WorkspaceTaskPreview["sourceLabel"],
  today: string,
  nowTime: string,
): TaskDeadline {
  if (!dueAt) {
    return {
      preview: {
        id,
        title,
        dueAt: null,
        deadlineKind: "none",
        deadlineLabel: "无截止日期",
        priority,
        sourceLabel,
      },
      sortDate: null,
      sortTime: null,
    };
  }

  const parsed = new Date(dueAt);
  if (!Number.isFinite(parsed.getTime())) {
    return {
      preview: {
        id,
        title,
        dueAt,
        deadlineKind: "invalid",
        deadlineLabel: "截止日期待确认",
        priority,
        sourceLabel,
      },
      sortDate: null,
      sortTime: null,
    };
  }

  const taskDate = localDateKey(parsed);
  const taskTime = localTimeKey(parsed);
  const deadlineKind =
    taskDate < today || (taskDate === today && taskTime < nowTime)
      ? "overdue"
      : taskDate === today
        ? "today"
        : "upcoming";
  return {
    preview: {
      id,
      title,
      dueAt,
      deadlineKind,
      deadlineLabel: `${deadlineKind === "overdue" ? "已逾期 · " : ""}${naturalDueDate(taskDate, today)} ${taskTime}`,
      priority,
      sourceLabel,
    },
    sortDate: taskDate,
    sortTime: taskTime,
  };
}

function personalTaskDeadline(task: PersonalTask, today: string, nowTime: string): TaskDeadline {
  if (!task.deadlineDate) {
    return taskDeadline(
      task.id,
      task.title,
      null,
      personalPriority(task.priority),
      "个人",
      today,
      nowTime,
    );
  }
  const dueAt = task.deadlineTime
    ? `${task.deadlineDate}T${task.deadlineTime}:00`
    : `${task.deadlineDate}T23:59:00`;
  const result = taskDeadline(
    task.id,
    task.title,
    dueAt,
    personalPriority(task.priority),
    "个人",
    today,
    nowTime,
  );
  if (task.deadlineTime) return result;
  const dueLabel = naturalDueDate(task.deadlineDate, today);
  return {
    ...result,
    preview: {
      ...result.preview,
      dueAt: task.deadlineDate,
      deadlineLabel: `${result.preview.deadlineKind === "overdue" ? "已逾期 · " : ""}${dueLabel}`,
    },
    sortDate: task.deadlineDate,
    sortTime: null,
  };
}

function personalPriority(priority: PersonalTask["priority"]): number {
  return { high: 2, medium: 1, low: 0, none: -1 }[priority];
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
  personalTasks: readonly PersonalTask[],
  today: string,
  nowTime: string,
): WorkspaceDashboardViewModel["taskSummary"] {
  const items = tasks
    .filter((task) => task.status !== "COMPLETED")
    .map((task) =>
      taskDeadline(
        task.id,
        task.title,
        task.dueAt.trim() || null,
        task.priority,
        "学业",
        today,
        nowTime,
      ),
    )
    .concat(
      personalTasks
        .filter((task) => task.status !== "completed")
        .map((task) => personalTaskDeadline(task, today, nowTime)),
    )
    .sort((left, right) => {
      const leftTask = left.preview;
      const rightTask = right.preview;
      return (
        deadlineOrder(leftTask.deadlineKind) - deadlineOrder(rightTask.deadlineKind) ||
        (left.sortDate ?? "\uffff").localeCompare(right.sortDate ?? "\uffff") ||
        // Timed deadlines precede date-only deadlines on the same day.
        (left.sortTime === null ? 1 : 0) - (right.sortTime === null ? 1 : 0) ||
        (left.sortTime ?? "\uffff").localeCompare(right.sortTime ?? "\uffff") ||
        rightTask.priority - leftTask.priority ||
        leftTask.id.localeCompare(rightTask.id)
      );
    });
  const preview = items.slice(0, TASK_PREVIEW_LIMIT).map((item) => item.preview);
  return {
    source: "workspace",
    items: preview,
    totalOpenCount: items.length,
    hiddenCount: Math.max(0, items.length - preview.length),
  };
}

function findNextItem(
  items: WorkspaceDashboardSources["timelineItems"],
  today: string,
  nowTime: string,
): WorkspaceDashboardViewModel["nextItem"] {
  const occupied = items
    .filter((item) => effectiveOccupancy(item) !== null)
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime),
    );
  return (
    occupied.find((item) => {
      const interval = effectiveOccupancy(item);
      return (
        item.date === today &&
        interval !== null &&
        interval.startMinute <= minutes(nowTime) &&
        minutes(nowTime) < interval.endMinute
      );
    }) ??
    occupied.find((item) => {
      const interval = effectiveOccupancy(item);
      return item.date > today || (interval !== null && interval.startMinute > minutes(nowTime));
    }) ??
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

function timelineSourceLabel(item: WorkspaceDashboardSources["timelineItems"][number]) {
  switch (item.sourceType) {
    case "academicOccurrence":
      return "课程" as const;
    case "plannerEvent":
      return "日程" as const;
    case "timeBlock":
      return "任务" as const;
    case "aiProposal":
      return null;
  }
}

function dateContextLabel(date: string, today: string): string {
  if (date === today) return "今天";
  if (date === nextLocalDate(today)) return "明天";
  const parsed = new Date(`${date}T12:00:00`);
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日`;
}

function itemSection(
  item: WorkspaceDashboardSources["timelineItems"][number],
  today: string,
  label = "下一项安排",
): WorkspaceTimeSection {
  return {
    label,
    value: item.title,
    title: item.title,
    detail: `${dateContextLabel(item.date, today)} · ${timelineSourceLabel(item) ?? "安排"} · ${item.startTime}–${item.endTime}`,
    location: item.location,
    sourceLabel: timelineSourceLabel(item),
  };
}

function timeContext(sources: WorkspaceDashboardSources, nowTime: string) {
  const now = minutes(nowTime);
  const todayItems = sources.timelineItems.filter((item) => effectiveOccupancy(item) !== null);
  const futureItems = sources.futureItems ?? sources.timelineItems;
  const occupied = futureItems
    .filter((item) => effectiveOccupancy(item) !== null)
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        (effectiveOccupancy(left)?.startMinute ?? 0) -
          (effectiveOccupancy(right)?.startMinute ?? 0),
    );
  const active = todayItems.find((item) => {
    const interval = effectiveOccupancy(item);
    return interval !== null && interval.startMinute <= now && now < interval.endMinute;
  });
  const activeInterval = active ? effectiveOccupancy(active) : null;
  const activeStart = active ? minutes(active.startTime) : 0;
  const activeEnd = active ? minutes(active.endTime) : 0;
  const activeIsStarted = active !== undefined && activeStart <= now;
  const activeIsInActualInterval = active !== undefined && activeStart <= now && now < activeEnd;
  const next = occupied.find((item) => {
    if (item === active) return false;
    if (item.date > sources.date) return true;
    const interval = effectiveOccupancy(item);
    return interval !== null && interval.endMinute > now;
  });
  const freeIntervals = computeFreeTimeIntervals(todayItems);
  const nextFree = freeIntervals.find((interval) => interval.endMinute > now);
  const freeStart = Math.max(now, nextFree?.startMinute ?? now);
  const freeEnd = nextFree?.endMinute ?? now;
  const primary: WorkspaceTimeSection = active
    ? {
        label: activeIsInActualInterval
          ? timelineSourceLabel(active) === "课程"
            ? "正在上课"
            : "正在进行"
          : activeIsStarted
            ? "安排缓冲"
            : "即将开始",
        value: activeIsInActualInterval
          ? `还有 ${durationLabel(activeEnd - now)}`
          : activeIsStarted
            ? `剩余 ${durationLabel((activeInterval?.endMinute ?? now) - now)}`
            : `还有 ${durationLabel(activeStart - now)}`,
        title: active.title,
        detail: `${timelineSourceLabel(active) ?? "安排"} · ${active.startTime}–${active.endTime}`,
        location: active.location,
        sourceLabel: timelineSourceLabel(active),
      }
    : {
        label: todayItems.length ? "当前空闲" : "今天暂无安排",
        value: durationLabel(Math.max(0, freeEnd - now)),
        title: null,
        detail:
          next && next.date === sources.date
            ? `至 ${clockLabel(effectiveOccupancy(next)?.startMinute ?? minutes(next.startTime))}`
            : "至今天结束",
        location: null,
        sourceLabel: null,
      };
  let secondary: WorkspaceTimeSection | null = null;
  if (active) {
    if (next) {
      secondary = itemSection(next, sources.date);
    } else if (freeEnd > freeStart) {
      secondary = {
        label: "下一段空闲",
        value: durationLabel(freeEnd - freeStart),
        title: null,
        detail: `${clockLabel(freeStart)}–${clockLabel(freeEnd)}`,
        location: null,
        sourceLabel: null,
      };
    }
  } else if (next) {
    secondary = itemSection(next, sources.date);
  }

  const remaining = todayItems.filter((item) => minutes(item.endTime) > now).length;
  const openTaskCount =
    sources.tasks.filter((task) => task.status !== "COMPLETED").length +
    (sources.personalTasks ?? []).filter((task) => task.status !== "completed").length;
  return {
    timeContext: { primary, secondary },
    todayStatusText: activeIsInActualInterval
      ? timelineSourceLabel(active!) === "课程"
        ? "正在上课"
        : "正在进行"
      : remaining
        ? `今天还有 ${remaining} 项安排`
        : todayItems.length
          ? "今天的安排已结束"
          : "今天暂无安排",
    todaySummaryText:
      [
        todayItems.length ? `${todayItems.length} 项安排` : null,
        openTaskCount ? `${openTaskCount} 个待办` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(" · ") || "可自由安排今天的时间",
  };
}

export function buildWorkspaceDashboardViewModel(
  sources: WorkspaceDashboardSources,
  nowTime: string,
): WorkspaceDashboardViewModel {
  return {
    date: sources.date,
    timelineItems: sources.timelineItems,
    todayItemCount: sources.timelineItems.filter((item) => effectiveOccupancy(item) !== null)
      .length,
    nextItem: findNextItem(sources.futureItems ?? sources.timelineItems, sources.date, nowTime),
    ...timeContext(sources, nowTime),
    taskSummary: buildTaskSummary(
      sources.tasks,
      sources.personalTasks ?? [],
      sources.date,
      nowTime,
    ),
    moduleAvailability: {
      diary: "available",
      inbox: "unavailable",
      ai: "unavailable",
    },
    hasDiaryToday: sources.hasDiaryToday ?? false,
    pendingInboxCount: sources.pendingInboxCount ?? 0,
    warnings: sources.warnings,
  };
}
