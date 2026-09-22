import { invoke } from "@tauri-apps/api/core";
import type { AcademicTask } from "../types/academic-task.ts";
import type { CourseOverride } from "../types/course-override.ts";
import type { Exam } from "../types/exam.ts";
import type { Semester } from "../types/semester.ts";

let developmentSemesters: Semester[] = [];
let developmentOverrides: CourseOverride[] = [];
let developmentTasks: AcademicTask[] = [];
let developmentExams: Exam[] = [];

function usesDevelopmentMemory(): boolean {
  return import.meta.env.DEV && !("__TAURI_INTERNALS__" in window);
}

function errorMessage(error: unknown, fallback: string): Error {
  return new Error(typeof error === "string" && error.trim() ? error : fallback);
}

export async function loadSemesters(): Promise<readonly Semester[]> {
  if (usesDevelopmentMemory()) return [...developmentSemesters];
  try {
    return await invoke<readonly Semester[]>("load_semesters");
  } catch (error) {
    throw errorMessage(error, "无法读取学期，请稍后重试。");
  }
}

export async function saveSemester(semester: Semester): Promise<Semester> {
  if (usesDevelopmentMemory()) {
    developmentSemesters = [
      ...developmentSemesters.filter((item) => item.id !== semester.id && item.status !== "ACTIVE"),
      semester,
    ];
    if (semester.status === "ACTIVE") {
      developmentSemesters = developmentSemesters.map((item) =>
        item.id === semester.id ? item : { ...item, status: "ARCHIVED" },
      );
    }
    return semester;
  }
  try {
    return await invoke<Semester>("save_semester", { semester });
  } catch (error) {
    throw errorMessage(error, "保存学期失败，请稍后重试。");
  }
}

export async function archiveSemester(id: string, updatedAt: string): Promise<void> {
  if (usesDevelopmentMemory()) {
    developmentSemesters = developmentSemesters.map((item) =>
      item.id === id ? { ...item, status: "ARCHIVED", updatedAt } : item,
    );
    return;
  }
  try {
    await invoke("archive_semester", { id, updatedAt });
  } catch (error) {
    throw errorMessage(error, "归档学期失败，请稍后重试。");
  }
}

export async function loadCourseOverrides(semesterId: string): Promise<readonly CourseOverride[]> {
  if (usesDevelopmentMemory()) {
    return developmentOverrides.filter((item) => item.semesterId === semesterId);
  }
  try {
    return await invoke<readonly CourseOverride[]>("load_course_overrides", { semesterId });
  } catch (error) {
    throw errorMessage(error, "无法读取课表变化，请稍后重试。");
  }
}

export async function saveCourseOverride(value: CourseOverride): Promise<CourseOverride> {
  if (usesDevelopmentMemory()) {
    developmentOverrides = [...developmentOverrides.filter((item) => item.id !== value.id), value];
    return value;
  }
  try {
    return await invoke<CourseOverride>("save_course_override", { value });
  } catch (error) {
    throw errorMessage(error, "保存课表变化失败，请稍后重试。");
  }
}

export async function revokeCourseOverride(id: string, updatedAt: string): Promise<void> {
  if (usesDevelopmentMemory()) {
    developmentOverrides = developmentOverrides.map((item) =>
      item.id === id ? { ...item, active: false, updatedAt } : item,
    );
    return;
  }
  try {
    await invoke("revoke_course_override", { id, updatedAt });
  } catch (error) {
    throw errorMessage(error, "撤销课表变化失败，请稍后重试。");
  }
}

export async function loadAcademicTasks(semesterId: string): Promise<readonly AcademicTask[]> {
  if (usesDevelopmentMemory())
    return developmentTasks.filter((item) => item.semesterId === semesterId);
  try {
    return await invoke<readonly AcademicTask[]>("load_academic_tasks", { semesterId });
  } catch (error) {
    throw errorMessage(error, "无法读取学习事项，请稍后重试。");
  }
}

export async function saveAcademicTask(task: AcademicTask): Promise<AcademicTask> {
  if (usesDevelopmentMemory()) {
    developmentTasks = [...developmentTasks.filter((item) => item.id !== task.id), task];
    return task;
  }
  try {
    return await invoke<AcademicTask>("save_academic_task", { task });
  } catch (error) {
    throw errorMessage(error, "保存学习事项失败，请稍后重试。");
  }
}

export async function deleteAcademicTask(id: string): Promise<void> {
  if (usesDevelopmentMemory()) {
    developmentTasks = developmentTasks.filter((item) => item.id !== id);
    return;
  }
  try {
    await invoke("delete_academic_task", { id });
  } catch (error) {
    throw errorMessage(error, "删除学习事项失败，请稍后重试。");
  }
}

export async function loadExams(semesterId: string): Promise<readonly Exam[]> {
  if (usesDevelopmentMemory())
    return developmentExams.filter((item) => item.semesterId === semesterId);
  try {
    return await invoke<readonly Exam[]>("load_exams", { semesterId });
  } catch (error) {
    throw errorMessage(error, "无法读取考试，请稍后重试。");
  }
}

export async function saveExam(exam: Exam): Promise<Exam> {
  if (usesDevelopmentMemory()) {
    developmentExams = [...developmentExams.filter((item) => item.id !== exam.id), exam];
    return exam;
  }
  try {
    return await invoke<Exam>("save_exam", { exam });
  } catch (error) {
    throw errorMessage(error, "保存考试失败，请稍后重试。");
  }
}

export async function deleteExam(id: string): Promise<void> {
  if (usesDevelopmentMemory()) {
    developmentExams = developmentExams.filter((item) => item.id !== id);
    return;
  }
  try {
    await invoke("delete_exam", { id });
  } catch (error) {
    throw errorMessage(error, "删除考试失败，请稍后重试。");
  }
}
