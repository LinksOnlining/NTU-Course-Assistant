import { createDiaryEntryTarget } from "../../navigation/navigation.ts";
import { createWorkspaceSearchRecord, searchSnippet } from "../../modules/search-record.ts";
import type { WorkspaceSearchRecord } from "../../modules/search-contract.ts";
import type { SearchProvider } from "../../modules/search-provider-registry.ts";
import type { DiaryEntry } from "../../types/diary.ts";
import { loadDiarySearchEntries } from "./diary.ts";

export function buildDiarySearchRecords(
  entries: readonly DiaryEntry[],
): readonly WorkspaceSearchRecord[] {
  return entries.map((entry, order) =>
    createWorkspaceSearchRecord({
      id: entry.id,
      category: "diaryEntry",
      categoryLabel: "日记",
      title: `日记 · ${entry.entryDate}`,
      summary: searchSnippet(entry.body),
      target: createDiaryEntryTarget(entry.id, entry.entryDate),
      updatedAt: entry.updatedAt,
      activeRank: 0,
      sourceRank: 60_000 + order,
      metadata: entry.entryDate,
      body: entry.body,
    }),
  );
}

export const diarySearchProvider: SearchProvider = Object.freeze({
  id: "diary.search",
  moduleId: "diary",
  order: 30,
  async loadIndex() {
    return buildDiarySearchRecords(await loadDiarySearchEntries());
  },
});
