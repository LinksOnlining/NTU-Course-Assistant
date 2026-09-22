export interface TermConfig {
  readonly firstWeekMonday: string;
  readonly totalWeeks: number;
  readonly timezone: "Asia/Shanghai";
}

export interface ReminderSettings {
  readonly enabled: boolean;
  readonly advanceMinutes: number;
}

export interface ReminderConfiguration {
  readonly termConfig: TermConfig | null;
  readonly reminderSettings: ReminderSettings;
}

export interface CourseOccurrence {
  readonly courseId: string;
  readonly key: string;
  readonly week: number;
  readonly weekday: number;
  readonly date: string;
  readonly startDateTime: string;
  readonly endDateTime: string;
  /** v1.3 canonical occurrence fields; optional during the v1.2 compatibility migration. */
  readonly semesterId?: string;
  readonly teachingWeek?: number;
  readonly startPeriod?: number | null;
  readonly endPeriod?: number | null;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly room?: string | null;
  readonly teacher?: string | null;
  readonly status?: "NORMAL" | "RESCHEDULED" | "MAKEUP" | "CANCELLED";
  readonly source?: "BASE" | "OVERRIDE";
  readonly originalOccurrenceKey?: string | null;
}

export interface ReminderOccurrence {
  readonly courseId: string;
  readonly courseOccurrenceKey: string;
  readonly triggerAt: string;
  readonly courseStartAt: string;
}

export interface ReminderPlan {
  readonly occurrenceKey: string;
  readonly triggerAtMilliseconds: number;
  readonly courseStartMilliseconds: number;
  readonly notification: ReminderNotificationPayload;
}

export interface ReminderNotificationPayload {
  readonly courseName: string;
  readonly startTime: string;
  readonly classroom: string | null;
}

export type ReminderDecision =
  | { readonly kind: "future"; readonly reminder: ReminderOccurrence }
  | { readonly kind: "catch-up"; readonly reminder: ReminderOccurrence }
  | { readonly kind: "none" };
