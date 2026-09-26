import { loadAcademicTermConfig } from "../academic/academic-application.ts";
import { formatTimelineMinute } from "../timeline/planner-interactions.ts";
import {
  buildWorkspaceDashboardViewModel,
  loadWorkspaceDashboardSources,
} from "./workspace-dashboard.ts";

export async function readWorkspaceAiOverview(): Promise<{
  readonly date: string;
  readonly localTime: string;
  readonly todayScheduleCount: number;
  readonly remainingScheduleCount: number;
  readonly openTaskCount: number;
  readonly overdueTaskCount: number;
  readonly nextFreeTime: {
    readonly date: string;
    readonly start: string;
    readonly end: string;
    readonly durationMinutes: number;
  } | null;
}> {
  const now = new Date();
  const date = localDateKey(now);
  const localTime = localTimeKey(now);
  const termConfig = await loadAcademicTermConfig();
  const sources = await loadWorkspaceDashboardSources(date, termConfig);
  const context = buildWorkspaceDashboardViewModel(sources, localTime).context;
  return Object.freeze({
    date: context.date,
    localTime: context.localTime,
    todayScheduleCount: context.todayItemCount,
    remainingScheduleCount: context.remainingItemCount,
    openTaskCount: context.openTaskCount,
    overdueTaskCount: context.overdueTaskCount,
    nextFreeTime: context.nextFreeSlot
      ? Object.freeze({
          date: context.nextFreeSlot.date,
          start: formatTimelineMinute(context.nextFreeSlot.startMinute),
          end: formatTimelineMinute(context.nextFreeSlot.endMinute),
          durationMinutes: context.nextFreeSlot.durationMinutes,
        })
      : null,
  });
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localTimeKey(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
