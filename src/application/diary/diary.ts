import * as diaryStorage from "../../services/diary-storage.ts";
import type { DiaryEntry } from "../../types/diary.ts";

/** 本机 Search Application API；正文仅供本机匹配，不产生网络或日志副作用。 */
export function loadDiarySearchEntries(): Promise<readonly DiaryEntry[]> {
  return diaryStorage.loadDiaryEntriesForSearch();
}

export const loadDiaryEntry = diaryStorage.loadDiaryEntry;
export const loadDiaryContentDates = diaryStorage.loadDiaryContentDates;
export const saveDiaryEntry = diaryStorage.saveDiaryEntry;
