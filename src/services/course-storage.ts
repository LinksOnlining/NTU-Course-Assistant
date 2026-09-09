import { invoke } from "@tauri-apps/api/core";
import type { Course } from "../types/course.ts";
import type { PeriodTime } from "../types/time.ts";

export interface LoadCoursesResult {
  readonly courses: readonly Course[];
  readonly warnings: readonly string[];
}

let developmentMemory: Course[] = [];
let developmentPeriodTimes: PeriodTime[] | null = null;

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

export async function saveStoredPeriodTimes(periods: readonly PeriodTime[]): Promise<void> {
  if (usesDevelopmentMemory()) {
    developmentPeriodTimes = [...periods];
    return;
  }
  try {
    await invoke("save_period_times", { periods });
  } catch (error) {
    throw storageError(error, "保存作息失败，请稍后重试。");
  }
}
