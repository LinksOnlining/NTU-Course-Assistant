import { invoke } from "@tauri-apps/api/core";
import type { Course } from "../types/course.ts";
import type { PeriodTime } from "../types/time.ts";
import type {
  ReminderConfiguration,
  ReminderPlan,
  ReminderSettings,
  TermConfig,
} from "../types/reminder.ts";
import type { WidgetSettings } from "../types/widget-settings.ts";

export interface LoadCoursesResult {
  readonly courses: readonly Course[];
  readonly warnings: readonly string[];
}

let developmentMemory: Course[] = [];
let developmentPeriodTimes: PeriodTime[] | null = null;
let developmentReminderConfiguration: ReminderConfiguration = {
  termConfig: null,
  reminderSettings: { enabled: false, advanceMinutes: 15 },
};
let developmentWidgetSettings: WidgetSettings = {
  enabled: false,
  displayMode: "today",
  locked: false,
  x: null,
  y: null,
  width: null,
  height: null,
};

function usesDevelopmentMemory(): boolean {
  return import.meta.env.DEV && !("__TAURI_INTERNALS__" in window);
}

function storageError(error: unknown, fallback: string): Error {
  return new Error(typeof error === "string" && error.trim() !== "" ? error : fallback);
}

export async function loadStoredCourses(): Promise<LoadCoursesResult> {
  if (usesDevelopmentMemory()) return { courses: [...developmentMemory], warnings: [] };
  try {
    return await invoke<LoadCoursesResult>("load_courses");
  } catch (error) {
    throw storageError(error, "无法读取已保存课程，请重新启动应用。");
  }
}

export async function insertStoredCourse(course: Course): Promise<void> {
  if (usesDevelopmentMemory()) {
    if (developmentMemory.some((item) => item.id === course.id)) {
      throw new Error("保存课程失败：课程 ID 已存在。");
    }
    developmentMemory = [...developmentMemory, course];
    return;
  }
  try {
    await invoke("insert_course", { course });
  } catch (error) {
    throw storageError(error, "保存课程失败，请稍后重试。");
  }
}

export async function importStoredCourses(courses: readonly Course[]): Promise<readonly Course[]> {
  if (usesDevelopmentMemory()) {
    if (courses.length === 0) throw new Error("导入课程不能为空。");
    const existingIds = new Set(developmentMemory.map((course) => course.id));
    const incomingIds = new Set<string>();
    for (const course of courses) {
      if (existingIds.has(course.id) || incomingIds.has(course.id)) {
        throw new Error("批量导入失败：课程 ID 已存在。");
      }
      incomingIds.add(course.id);
    }
    developmentMemory = [...developmentMemory, ...courses];
    return [...courses];
  }
  try {
    return await invoke<readonly Course[]>("import_courses", { courses });
  } catch (error) {
    throw storageError(error, "批量导入失败，未保存任何课程，请稍后重试。");
  }
}

export async function updateStoredCourse(course: Course): Promise<void> {
  if (usesDevelopmentMemory()) {
    if (!developmentMemory.some((item) => item.id === course.id)) {
      throw new Error("更新课程失败：没有找到原课程。");
    }
    developmentMemory = developmentMemory.map((item) => (item.id === course.id ? course : item));
    return;
  }
  try {
    await invoke("update_course", { course });
  } catch (error) {
    throw storageError(error, "更新课程失败，请稍后重试。");
  }
}

export async function deleteStoredCourse(id: string): Promise<void> {
  if (usesDevelopmentMemory()) {
    if (!developmentMemory.some((item) => item.id === id)) {
      throw new Error("删除课程失败：没有找到该课程。");
    }
    developmentMemory = developmentMemory.filter((course) => course.id !== id);
    return;
  }
  try {
    await invoke("delete_course", { id });
  } catch (error) {
    throw storageError(error, "删除课程失败，请稍后重试。");
  }
}

export async function loadStoredPeriodTimes(): Promise<readonly PeriodTime[] | null> {
  if (usesDevelopmentMemory()) {
    return developmentPeriodTimes ? [...developmentPeriodTimes] : null;
  }
  try {
    return await invoke<readonly PeriodTime[] | null>("load_period_times");
  } catch (error) {
    throw storageError(error, "无法读取作息设置，请重新启动应用。");
  }
}

export async function loadStoredDayCount(): Promise<5 | 7> {
  if (usesDevelopmentMemory()) return 7;
  const value = await invoke<number>("load_day_count");
  return value === 5 ? 5 : 7;
}

export async function saveStoredDayCount(dayCount: 5 | 7): Promise<void> {
  if (usesDevelopmentMemory()) return;
  await invoke("save_day_count", { dayCount });
}

export async function saveStoredPeriodTimes(periods: readonly PeriodTime[]): Promise<void> {
  if (usesDevelopmentMemory()) {
    developmentPeriodTimes = [...periods];
    return;
  }
  try {
    await invokeWithTimeout("save_period_times", { periods });
  } catch (error) {
    throw storageError(error, "保存作息失败，请稍后重试。");
  }
}

export interface SavedAppSettings {
  readonly periods: readonly PeriodTime[];
  readonly configuration: ReminderConfiguration;
}

export async function loadStoredReminderConfiguration(): Promise<
  ReminderConfiguration & { warnings: readonly string[] }
> {
  if (usesDevelopmentMemory()) return { ...developmentReminderConfiguration, warnings: [] };
  try {
    return await invoke<ReminderConfiguration & { warnings: readonly string[] }>(
      "load_reminder_configuration",
    );
  } catch (error) {
    throw storageError(error, "无法读取提醒设置，请重新启动应用。");
  }
}

export async function loadStoredWidgetSettings(): Promise<WidgetSettings> {
  if (usesDevelopmentMemory()) return { ...developmentWidgetSettings };
  try {
    return await invoke<WidgetSettings>("load_widget_settings");
  } catch (error) {
    throw storageError(error, "无法读取小组件设置，请重新启动应用。");
  }
}

export async function patchStoredWidgetSettings(
  patch: Partial<WidgetSettings>,
): Promise<WidgetSettings> {
  if (usesDevelopmentMemory()) {
    developmentWidgetSettings = { ...developmentWidgetSettings, ...patch };
    return { ...developmentWidgetSettings };
  }
  try {
    return await invokeWithTimeout<WidgetSettings>("patch_widget_settings", { patch });
  } catch (error) {
    throw storageError(error, "保存小组件设置失败，请稍后重试。");
  }
}

export async function loadHandledReminderKeys(): Promise<readonly string[]> {
  if (usesDevelopmentMemory()) return [];
  try {
    return await invoke<readonly string[]>("load_handled_reminder_keys");
  } catch (error) {
    throw storageError(error, "无法读取提醒状态，请重新启动应用。");
  }
}

export async function saveStoredAppSettings(
  periods: readonly PeriodTime[],
  termConfig: TermConfig | null,
  reminderSettings: ReminderSettings,
): Promise<SavedAppSettings> {
  if (usesDevelopmentMemory()) {
    developmentPeriodTimes = [...periods];
    developmentReminderConfiguration = { termConfig, reminderSettings };
    return {
      periods: [...developmentPeriodTimes],
      configuration: { ...developmentReminderConfiguration },
    };
  }
  try {
    return await invokeWithTimeout<SavedAppSettings>("save_app_settings", {
      periods,
      termConfig,
      reminderSettings,
    });
  } catch (error) {
    throw storageError(error, "保存设置失败，请稍后重试。");
  }
}

export async function refreshStoredReminderSchedule(
  configuration: ReminderConfiguration,
  plans: readonly ReminderPlan[],
): Promise<void> {
  if (usesDevelopmentMemory()) return;
  try {
    await invoke("refresh_reminder_schedule", {
      enabled: configuration.reminderSettings.enabled && configuration.termConfig !== null,
      plans,
    });
  } catch (error) {
    throw storageError(error, "无法更新提醒计划，请重新启动应用。");
  }
}
const SETTINGS_TIMEOUT_MS = 10_000;

async function invokeWithTimeout<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      invoke<T>(command, args),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("保存操作超时，请重试。")), SETTINGS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
