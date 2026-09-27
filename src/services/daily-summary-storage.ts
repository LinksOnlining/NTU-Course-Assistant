import { invoke } from "@tauri-apps/api/core";
import type { DailySummary } from "../types/daily-summary.ts";

const developmentSummaries = new Map<string, DailySummary>();

function usesDevelopmentMemory(): boolean {
  return import.meta.env.DEV && !("__TAURI_INTERNALS__" in window);
}

export async function loadDailySummary(date: string): Promise<DailySummary | null> {
  if (usesDevelopmentMemory()) return developmentSummaries.get(date) ?? null;
  try {
    return await invoke<DailySummary | null>("load_daily_summary", { date });
  } catch {
    throw new Error("无法读取这一天的每日总结，请稍后重试。");
  }
}

export async function loadDailySummariesInRange(
  startDate: string,
  endDate: string,
): Promise<readonly DailySummary[]> {
  if (usesDevelopmentMemory()) {
    return [...developmentSummaries.values()]
      .filter((item) => item.summaryDate >= startDate && item.summaryDate <= endDate)
      .sort((left, right) => right.summaryDate.localeCompare(left.summaryDate))
      .slice(0, 3);
  }
  try {
    return await invoke<readonly DailySummary[]>("load_daily_summaries_in_range", {
      startDate,
      endDate,
    });
  } catch {
    throw new Error("无法读取最近的每日总结。");
  }
}

export async function saveDailySummary(summary: DailySummary): Promise<DailySummary> {
  if (usesDevelopmentMemory()) {
    const current = developmentSummaries.get(summary.summaryDate);
    const saved = current
      ? {
          ...summary,
          id: current.id,
          createdAt: current.createdAt,
          revision: current.revision + 1,
        }
      : summary;
    developmentSummaries.set(summary.summaryDate, saved);
    return saved;
  }
  try {
    return await invoke<DailySummary>("save_daily_summary", { summary });
  } catch {
    throw new Error("每日总结保存失败，请稍后重试。");
  }
}
