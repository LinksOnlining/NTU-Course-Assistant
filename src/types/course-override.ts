export type CourseOverrideKind = "CANCEL" | "RESCHEDULE" | "MODIFY" | "MAKEUP";

/** One atomic change to one occurrence; the base Course is never mutated. */
export interface CourseOverride {
  readonly id: string;
  readonly courseId: string | null;
  readonly semesterId: string;
  readonly kind: CourseOverrideKind;
  readonly originalOccurrenceKey: string | null;
  readonly originalDate: string | null;
  readonly targetDate: string | null;
  readonly startPeriod: number | null;
  readonly endPeriod: number | null;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly classroom: string | null;
  readonly teacher: string | null;
  readonly note: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}
