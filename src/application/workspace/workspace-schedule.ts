import {
  loadAcademicHubData,
  loadAcademicScheduleData,
  resolveAcademicOccurrences,
  type AcademicHubData,
  type AcademicHubLoadOptions,
  type AcademicScheduleData,
} from "../academic/index.ts";
import { loadPersonalTasks } from "../planner/personal-tasks.ts";
import { loadPlannerEvents, loadTimeBlocks } from "../planner/planner-schedule.ts";
import {
  projectAcademicOccurrencesToTimelineItems,
  projectPlannerEventsToTimelineItems,
  projectTimeBlocksToTimelineItems,
} from "../timeline/index.ts";
import { isValidPlannerDate } from "../planner/date-time.ts";
import type { PlannerEvent, TimeBlock } from "../../types/planner.ts";
import type { PersonalTask } from "../../types/personal-task.ts";
import type { Semester } from "../../types/semester.ts";
import type { TermConfig } from "../../types/reminder.ts";
import type { WorkspaceScheduleDay } from "./types.ts";

const LEGACY_SEMESTER_ID = "legacy-active-semester";

export interface WorkspaceScheduleReader {
  loadScheduleData(): Promise<AcademicScheduleData>;
  loadHubData(options: AcademicHubLoadOptions): Promise<AcademicHubData>;
  loadEvents(date: string): Promise<readonly PlannerEvent[]>;
  loadTimeBlocks(date: string): Promise<readonly TimeBlock[]>;
  loadTasks(): Promise<readonly PersonalTask[]>;
}

const defaultReader: WorkspaceScheduleReader = {
  loadScheduleData: loadAcademicScheduleData,
  loadHubData: loadAcademicHubData,
  loadEvents: (date) => loadPlannerEvents(date, date),
  loadTimeBlocks: (date) => loadTimeBlocks(date, date),
  loadTasks: loadPersonalTasks,
};

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

export function shiftWorkspaceScheduleDate(date: string, days: number): string {
  if (!isValidPlannerDate(date) || !Number.isInteger(days)) throw new Error("日程日期无效。");
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export async function loadWorkspaceScheduleDay(
  date: string,
  termConfig: TermConfig | null,
  reader: WorkspaceScheduleReader = defaultReader,
): Promise<WorkspaceScheduleDay> {
  if (!isValidPlannerDate(date)) throw new Error("请输入有效的日程日期。");
  const options: AcademicHubLoadOptions = {
    fallbackSemesterId: termConfig ? LEGACY_SEMESTER_ID : undefined,
  };
  const [schedule, hub, events, blocks, tasks] = await Promise.all([
    reader.loadScheduleData(),
    reader.loadHubData(options),
    reader.loadEvents(date),
    reader.loadTimeBlocks(date),
    reader.loadTasks(),
  ]);
  const semester =
    hub.semesters.find((item) => item.status === "ACTIVE") ??
    (hub.semesters.length === 0 ? legacySemester(termConfig) : null);
  const occurrences = semester
    ? resolveAcademicOccurrences(
        schedule.courses,
        semester,
        hub.overrides,
        { from: date, to: date },
        schedule.periodTimes ?? [],
      )
    : [];

  return {
    date,
    events,
    timeBlocks: blocks,
    timelineItems: [
      ...projectAcademicOccurrencesToTimelineItems(
        occurrences.filter((item) => item.date === date),
        schedule.courses,
      ),
      ...projectPlannerEventsToTimelineItems(events),
      ...projectTimeBlocksToTimelineItems(blocks, tasks),
    ],
    tasks,
    warnings: schedule.warnings,
  };
}
