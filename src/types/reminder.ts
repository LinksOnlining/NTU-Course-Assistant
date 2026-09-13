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
