export type AcademicTaskType = "ASSIGNMENT" | "LAB_REPORT" | "PRESENTATION" | "PROJECT" | "CUSTOM";

export type AcademicTaskStatus = "TODO" | "COMPLETED";

export interface AcademicTask {
  readonly id: string;
  readonly semesterId: string;
  readonly courseId: string | null;
  readonly type: AcademicTaskType;
  readonly title: string;
  readonly note: string | null;
  readonly dueAt: string;
  readonly priority: number;
  readonly status: AcademicTaskStatus;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
