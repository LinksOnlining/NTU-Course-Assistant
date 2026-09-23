export type PersonalTaskStatus = "open" | "completed";
export type PersonalTaskPriority = "none" | "low" | "medium" | "high";

export interface PersonalTask {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly status: PersonalTaskStatus;
  readonly priority: PersonalTaskPriority;
  readonly deadlineDate: string | null;
  readonly deadlineTime: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface PersonalTaskDraft {
  readonly title: string;
  readonly description: string;
  readonly priority: PersonalTaskPriority;
  readonly deadlineDate: string;
  readonly deadlineTime: string;
}
