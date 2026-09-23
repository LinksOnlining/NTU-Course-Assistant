import { invoke } from "@tauri-apps/api/core";
import type { PersonalTask } from "../types/personal-task.ts";
import type { PlannerEvent, TimeBlock } from "../types/planner.ts";

let developmentTasks: PersonalTask[] = [];
let developmentEvents: PlannerEvent[] = [];
let developmentTimeBlocks: TimeBlock[] = [];

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
    developmentTimeBlocks = developmentTimeBlocks.filter((item) => item.personalTaskId !== id);
    return;
  }
  try {
    await invoke("delete_personal_task", { id });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "删除个人任务失败，请稍后重试。");
  }
}

export async function loadPlannerEvents(
  startDate: string,
  endDate: string,
): Promise<readonly PlannerEvent[]> {
  if (usesDevelopmentMemory()) {
    return developmentEvents
      .filter((event) => event.date >= startDate && event.date <= endDate)
      .slice()
      .sort(
        (left, right) =>
          left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime),
      );
  }
  try {
    return await invoke<readonly PlannerEvent[]>("load_planner_events", { startDate, endDate });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "无法读取个人日程，请稍后重试。");
  }
}

export async function createPlannerEvent(event: PlannerEvent): Promise<PlannerEvent> {
  if (usesDevelopmentMemory()) {
    if (developmentEvents.some((item) => item.id === event.id)) throw new Error("个人日程已存在。");
    developmentEvents = [...developmentEvents, event];
    return event;
  }
  try {
    return await invoke<PlannerEvent>("create_planner_event", { event });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "创建个人日程失败，请稍后重试。");
  }
}

export async function updatePlannerEvent(event: PlannerEvent): Promise<PlannerEvent> {
  if (usesDevelopmentMemory()) {
    if (!developmentEvents.some((item) => item.id === event.id))
      throw new Error("个人日程不存在。");
    developmentEvents = developmentEvents.map((item) => (item.id === event.id ? event : item));
    return event;
  }
  try {
    return await invoke<PlannerEvent>("update_planner_event", { event });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "保存个人日程失败，请稍后重试。");
  }
}

export async function deletePlannerEvent(id: string): Promise<void> {
  if (usesDevelopmentMemory()) {
    if (!developmentEvents.some((item) => item.id === id)) throw new Error("个人日程不存在。");
    developmentEvents = developmentEvents.filter((item) => item.id !== id);
    return;
  }
  try {
    await invoke("delete_planner_event", { id });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "删除个人日程失败，请稍后重试。");
  }
}

export async function loadTimeBlocks(
  startDate: string,
  endDate: string,
): Promise<readonly TimeBlock[]> {
  if (usesDevelopmentMemory()) {
    return developmentTimeBlocks
      .filter((block) => block.date >= startDate && block.date <= endDate)
      .slice()
      .sort(
        (left, right) =>
          left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime),
      );
  }
  try {
    return await invoke<readonly TimeBlock[]>("load_time_blocks", { startDate, endDate });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "无法读取任务时间安排，请稍后重试。");
  }
}

export async function loadTimeBlocksForTask(personalTaskId: string): Promise<readonly TimeBlock[]> {
  if (usesDevelopmentMemory()) {
    return developmentTimeBlocks
      .filter((block) => block.personalTaskId === personalTaskId)
      .slice()
      .sort(
        (left, right) =>
          left.date.localeCompare(right.date) || left.startTime.localeCompare(right.startTime),
      );
  }
  try {
    return await invoke<readonly TimeBlock[]>("load_time_blocks_for_task", { personalTaskId });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "无法读取任务时间安排，请稍后重试。");
  }
}

export async function createTimeBlock(block: TimeBlock): Promise<TimeBlock> {
  if (usesDevelopmentMemory()) {
    if (!developmentTasks.some((task) => task.id === block.personalTaskId)) {
      throw new Error("关联的个人任务不存在。");
    }
    if (developmentTimeBlocks.some((item) => item.id === block.id))
      throw new Error("时间块已存在。");
    developmentTimeBlocks = [...developmentTimeBlocks, block];
    return block;
  }
  try {
    return await invoke<TimeBlock>("create_time_block", { block });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "安排任务时间失败，请稍后重试。");
  }
}

export async function updateTimeBlock(block: TimeBlock): Promise<TimeBlock> {
  if (usesDevelopmentMemory()) {
    if (!developmentTasks.some((task) => task.id === block.personalTaskId)) {
      throw new Error("关联的个人任务不存在。");
    }
    if (!developmentTimeBlocks.some((item) => item.id === block.id))
      throw new Error("时间块不存在。");
    developmentTimeBlocks = developmentTimeBlocks.map((item) =>
      item.id === block.id ? block : item,
    );
    return block;
  }
  try {
    return await invoke<TimeBlock>("update_time_block", { block });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "更新任务时间安排失败，请稍后重试。");
  }
}

export async function deleteTimeBlock(id: string): Promise<void> {
  if (usesDevelopmentMemory()) {
    if (!developmentTimeBlocks.some((item) => item.id === id)) throw new Error("时间块不存在。");
    developmentTimeBlocks = developmentTimeBlocks.filter((item) => item.id !== id);
    return;
  }
  try {
    await invoke("delete_time_block", { id });
  } catch (error) {
    throw new Error(typeof error === "string" ? error : "删除任务时间安排失败，请稍后重试。");
  }
}
