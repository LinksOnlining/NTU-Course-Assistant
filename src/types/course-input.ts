import type { Course } from "./course.ts";
import type { TimeRange } from "./time.ts";

/** Raw values accepted at the shared boundary used by forms and future importers. */
export interface CourseInput {
  readonly name: string;
  readonly teacher: string;
  readonly classroom: string;
  readonly weekday: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly weeks: string;
}

export type CourseInputField = keyof CourseInput | "form";
export type CourseInputErrors = Readonly<Partial<Record<CourseInputField, string>>>;

export interface CourseValidationOptions {
  readonly axis?: TimeRange;
}

export type CourseValidationResult =
  | { readonly ok: true; readonly course: Course }
  | { readonly ok: false; readonly errors: CourseInputErrors };
