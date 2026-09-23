import type { AcademicTask } from "../../types/academic-task.ts";
import type { TimelineItem } from "../timeline/types.ts";

export type WorkspaceTaskDeadlineKind = "overdue" | "today" | "upcoming" | "none" | "invalid";

export interface WorkspaceTaskPreview {
  readonly id: string;
  readonly title: string;
  readonly dueAt: string | null;
  readonly deadlineKind: WorkspaceTaskDeadlineKind;
  readonly deadlineLabel: string;
  /** Existing AcademicTask priority is numeric; keep its value and ordering semantics. */
  readonly priority: number;
  readonly sourceLabel: "学业";
}

export interface WorkspaceTaskSummary {
  readonly source: "academic";
  readonly items: readonly WorkspaceTaskPreview[];
  readonly totalOpenCount: number;
  readonly hiddenCount: number;
}

export type WorkspaceModuleAvailability = "available" | "unavailable";

export interface WorkspaceDashboardViewModel {
  readonly date: string;
  readonly timelineItems: readonly TimelineItem[];
  readonly todayItemCount: number;
  readonly nextItem: TimelineItem | null;
  readonly taskSummary: WorkspaceTaskSummary;
  readonly moduleAvailability: {
    readonly diary: WorkspaceModuleAvailability;
    readonly inbox: WorkspaceModuleAvailability;
    readonly ai: WorkspaceModuleAvailability;
  };
  readonly warnings: readonly string[];
}

export interface WorkspaceDashboardSources {
  readonly date: string;
  readonly timelineItems: readonly TimelineItem[];
  readonly tasks: readonly AcademicTask[];
  readonly warnings: readonly string[];
}
