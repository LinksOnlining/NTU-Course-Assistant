import { invoke } from "@tauri-apps/api/core";
import type { DiaryEntry } from "../types/diary.ts";

const developmentEntries = new Map<string, DiaryEntry>();

function usesDevelopmentMemory(): boolean {
  return import.meta.env.DEV && !("__TAURI_INTERNALS__" in window);
}

export async function loadDiaryEntry(date: string): Promise<DiaryEntry | null> {
  if (usesDevelopmentMemory()) return developmentEntries.get(date) ?? null;
  try {
    return await invoke<DiaryEntry | null>("load_diary_entry", { date });
  } catch {
    throw new Error("无法读取这一天的日记，请稍后重试。");
  }
}

export async function saveDiaryEntry(entry: DiaryEntry): Promise<DiaryEntry> {
  if (usesDevelopmentMemory()) {
    const current = developmentEntries.get(entry.entryDate);
    const saved = current ? { ...entry, id: current.id, createdAt: current.createdAt } : entry;
    developmentEntries.set(entry.entryDate, saved);
    return saved;
  }
  try {
    return await invoke<DiaryEntry>("save_diary_entry", { entry });
  } catch {
    throw new Error("日记保存失败，请检查本地存储后重试。");
  }
}

export async function loadDiaryContentDates(): Promise<readonly string[]> {
  if (usesDevelopmentMemory()) {
    return [...developmentEntries.values()]
      .filter((entry) => entry.body.trim() !== "")
      .map((entry) => entry.entryDate)
      .sort((left, right) => right.localeCompare(left))
      .slice(0, 14);
  }
  try {
    return await invoke<readonly string[]>("load_diary_content_dates");
  } catch {
    throw new Error("无法读取近期日记日期。");
  }
}

export async function hasDiaryEntry(date: string): Promise<boolean> {
  if (usesDevelopmentMemory()) return (developmentEntries.get(date)?.body.trim().length ?? 0) > 0;
  try {
    return await invoke<boolean>("has_diary_entry", { date });
  } catch {
    throw new Error("无法读取今日日记状态。");
  }
}
