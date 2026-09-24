export interface Routine {
  readonly id: string;
  readonly title: string;
  readonly targetDurationMinutes: number;
  /** ISO weekdays Monday=1 through Sunday=7, stored as a bit mask. */
  readonly weekdaysMask: number;
  readonly preferredStartTime: string | null;
  readonly preferredEndTime: string | null;
  readonly enabled: boolean;
  readonly lastScheduledDate: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RoutineDraft {
  readonly title: string;
  readonly targetDurationMinutes: number;
  readonly weekdaysMask: number;
  readonly preferredStartTime: string | null;
  readonly preferredEndTime: string | null;
  readonly enabled: boolean;
}

export interface RoutineSuggestion {
  readonly routineId: string;
  readonly title: string;
  readonly targetDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly targetDurationMinutes: number;
}
