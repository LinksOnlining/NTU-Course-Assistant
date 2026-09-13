import { TEST_COURSES } from "../fixtures/courses.ts";
import { loadStoredCourses, loadStoredReminderConfiguration } from "./course-storage.ts";
import type { Course } from "../types/course.ts";
import type { TermConfig } from "../types/reminder.ts";

export interface WidgetData {
  readonly courses: readonly Course[];
  readonly termConfig: TermConfig | null;
}

export async function loadWidgetData(): Promise<WidgetData> {
  const [storedCourses, configuration] = await Promise.all([
    loadStoredCourses(),
    loadStoredReminderConfiguration(),
  ]);
  return {
    courses: import.meta.env.DEV
      ? [...TEST_COURSES, ...storedCourses.courses]
      : storedCourses.courses,
    termConfig: configuration.termConfig,
  };
}
