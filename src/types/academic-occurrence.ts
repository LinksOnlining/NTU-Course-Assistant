import type { CourseOverrideKind } from "./course-override.ts";

export type CourseOccurrenceStatus = "NORMAL" | "RESCHEDULED" | "MAKEUP" | "CANCELLED";
export type CourseOccurrenceSource = "BASE" | "OVERRIDE";

/** Canonical read model consumed by schedule, Today, Widget and reminders. */
export interface AcademicCourseOccurrence {
  readonly courseId: string;
  readonly semesterId: string;
  readonly date: string;
  readonly teachingWeek: number;
  readonly weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly startPeriod: number | null;
  readonly endPeriod: number | null;
  readonly startTime: string;
  readonly endTime: string;
  readonly room: string | null;
  readonly teacher: string | null;
  readonly status: CourseOccurrenceStatus;
  readonly source: CourseOccurrenceSource;
  readonly originalOccurrenceKey: string | null;
  readonly occurrenceKey: string;
  readonly appliedOverrideId: string | null;
  readonly appliedOverrideKind: CourseOverrideKind | null;
}
