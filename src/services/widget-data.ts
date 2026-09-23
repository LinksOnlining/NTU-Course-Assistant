import { TEST_COURSES } from "../fixtures/courses.ts";
import { invoke } from "@tauri-apps/api/core";
import {
  loadStoredCourses,
  loadStoredPeriodTimes,
  loadStoredReminderConfiguration,
  loadStoredWidgetSettings,
  patchStoredWidgetSettings,
} from "./course-storage.ts";
import type { Course } from "../types/course.ts";
import type { TermConfig } from "../types/reminder.ts";
import type { WidgetSettings } from "../types/widget-settings.ts";
import type { PeriodTime } from "../types/time.ts";

export const DEFAULT_WIDGET_SETTINGS: WidgetSettings = {
  enabled: false,
  displayMode: "today",
  locked: false,
  x: null,
  y: null,
  width: null,
  height: null,
};

export interface WidgetData {
  readonly courses: readonly Course[];
  readonly periods: readonly PeriodTime[] | null;
  readonly termConfig: TermConfig | null;
  readonly settings: WidgetSettings;
}

export async function loadWidgetData(): Promise<WidgetData> {
  if (!import.meta.env.DEV || "__TAURI_INTERNALS__" in window) {
    return invoke<WidgetData>("load_widget_data");
  }
  const [storedCourses, periods, configuration, settings] = await Promise.all([
    loadStoredCourses(),
    loadStoredPeriodTimes(),
    loadStoredReminderConfiguration(),
    loadStoredWidgetSettings(),
  ]);
  return {
    courses: import.meta.env.DEV
      ? [...TEST_COURSES, ...storedCourses.courses]
      : storedCourses.courses,
    periods,
    termConfig: configuration.termConfig,
    settings,
  };
}

export {
  loadStoredWidgetSettings as loadWidgetSettings,
  patchStoredWidgetSettings as patchWidgetSettings,
};
