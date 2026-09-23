import { invoke } from "@tauri-apps/api/core";
import type { PersonalTask } from "../types/personal-task.ts";

let developmentTasks: PersonalTask[] = [];

function usesDevelopmentMemory(): boolean {
  return import.meta.env.DEV && !("__TAURI_INTERNALS__" in window);
}

export async function loadPersonalTasks(): Promise<readonly PersonalTask[]> {
  if (usesDevelopmentMemory()) return [...developmentTasks];
  try {
    return await invoke<readonly PersonalTask[]>("load_personal_tasks");
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "无法读取个人任务，请稍后重试。");
  }
}

export async function createPersonalTask(task: PersonalTask): Promise<PersonalTask> {
  if (usesDevelopmentMemory()) {
    if (developmentTasks.some((item) => item.id === task.id)) throw new Error("个人任务已存在。");
    developmentTasks = [...developmentTasks, task];
    return task;
  }
  try {
    return await invoke<PersonalTask>("create_personal_task", { task });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "创建个人任务失败，请稍后重试。");
  }
}

export async function updatePersonalTask(task: PersonalTask): Promise<PersonalTask> {
  if (usesDevelopmentMemory()) {
    if (!developmentTasks.some((item) => item.id === task.id)) throw new Error("个人任务不存在。");
    developmentTasks = developmentTasks.map((item) => (item.id === task.id ? task : item));
    return task;
  }
  try {
    return await invoke<PersonalTask>("update_personal_task", { task });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "保存个人任务失败，请稍后重试。");
  }
}

export async function setPersonalTaskCompleted(
  id: string,
  completed: boolean,
  updatedAt: string,
): Promise<PersonalTask> {
  if (usesDevelopmentMemory()) {
    let saved: PersonalTask | undefined;
    developmentTasks = developmentTasks.map((item) => {
      if (item.id !== id) return item;
      saved = {
        ...item,
        status: completed ? "completed" : "open",
        completedAt: completed ? updatedAt : null,
        updatedAt,
      };
      return saved;
    });
    if (!saved) throw new Error("个人任务不存在。");
    return saved;
  }
  try {
    return await invoke<PersonalTask>("set_personal_task_completed", { id, completed, updatedAt });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "更新个人任务状态失败，请稍后重试。");
  }
}

export async function deletePersonalTask(id: string): Promise<void> {
  if (usesDevelopmentMemory()) {
    if (!developmentTasks.some((item) => item.id === id)) throw new Error("个人任务不存在。");
    developmentTasks = developmentTasks.filter((item) => item.id !== id);
    return;
  }
  try {
    await invoke("delete_personal_task", { id });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "删除个人任务失败，请稍后重试。");
  }
}
