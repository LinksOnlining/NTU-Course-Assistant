import type { AcademicTask } from "../../types/academic-task.ts";
import type { TimelineItem } from "../timeline/types.ts";
import type { PersonalTask } from "../../types/personal-task.ts";
import type { PlannerEvent, TimeBlock } from "../../types/planner.ts";
import type { WorkspaceContext } from "./workspace-context.ts";

export type WorkspaceTaskDeadlineKind = "overdue" | "today" | "upcoming" | "none" | "invalid";

export interface WorkspaceTaskPreview {
  readonly id: string;
  readonly title: string;
  readonly dueAt: string | null;
  readonly deadlineKind: WorkspaceTaskDeadlineKind;
  readonly deadlineLabel: string;
  /** Existing AcademicTask priority is numeric; keep its value and ordering semantics. */
  readonly priority: number;
  readonly sourceLabel: "个人" | "学业";
}

export interface WorkspaceTaskSummary {
  readonly source: "workspace";
  readonly items: readonly WorkspaceTaskPreview[];
  readonly totalOpenCount: number;
  readonly hiddenCount: number;
}

export interface WorkspaceTimeSection {
  readonly label: string;
  readonly value: string;
  readonly title: string | null;
  readonly detail: string;
  readonly location: string | null;
  readonly sourceLabel: "课程" | "日程" | "任务" | null;
}

export type WorkspaceModuleAvailability = "available" | "unavailable";

export interface WorkspaceDashboardViewModel {
  readonly context: WorkspaceContext;
  readonly date: string;
  readonly timelineItems: readonly TimelineItem[];
  readonly todayItemCount: number;
  readonly nextItem: TimelineItem | null;
  readonly todayStatusText: string;
  readonly todaySummaryText: string;
  readonly timeContext: {
    readonly primary: WorkspaceTimeSection;
    readonly secondary: WorkspaceTimeSection | null;
  };
  readonly taskSummary: WorkspaceTaskSummary;
  readonly moduleAvailability: {
    readonly diary: WorkspaceModuleAvailability;
    readonly inbox: WorkspaceModuleAvailability;
    readonly ai: WorkspaceModuleAvailability;
  };
  readonly hasDiaryToday: boolean;
  readonly pendingInboxCount: number;
  readonly warnings: readonly string[];
}

export interface WorkspaceDashboardSources {
  readonly date: string;
  readonly timelineItems: readonly TimelineItem[];
  readonly futureItems?: readonly TimelineItem[];
  readonly tasks: readonly AcademicTask[];
  readonly personalTasks?: readonly PersonalTask[];
  readonly hasDiaryToday?: boolean;
  readonly pendingInboxCount?: number;
  readonly warnings: readonly string[];
}

export interface WorkspaceScheduleDay {
  readonly date: string;
  readonly timelineItems: readonly TimelineItem[];
  readonly events: readonly PlannerEvent[];
  readonly timeBlocks: readonly TimeBlock[];
  readonly tasks: readonly PersonalTask[];
  readonly warnings: readonly string[];
}
