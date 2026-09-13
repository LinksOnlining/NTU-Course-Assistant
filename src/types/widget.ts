export type WidgetCourseState = "ended" | "current" | "next" | "upcoming";

export interface WidgetCourseItem {
  readonly key: string;
  readonly name: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly classroom: string | null;
  readonly state: WidgetCourseState;
}

export interface WidgetWeekDay {
  readonly weekday: number;
  readonly label: string;
  readonly date: string;
  readonly courses: readonly WidgetCourseItem[];
}

export type WidgetViewModel =
  | { readonly kind: "missing-term" }
  | { readonly kind: "outside-term" }
  | {
      readonly kind: "ready";
      readonly date: string;
      readonly weekdayLabel: string;
      readonly teachingWeek: number;
      readonly today: readonly WidgetCourseItem[];
      readonly week: readonly WidgetWeekDay[];
    };
