import { createInboxItemTarget } from "../../navigation/navigation.ts";
import { createWorkspaceSearchRecord, searchSnippet } from "../../modules/search-record.ts";
import type { WorkspaceSearchRecord } from "../../modules/search-contract.ts";
import type { SearchProvider } from "../../modules/search-provider-registry.ts";
import type { InboxItem } from "../../types/inbox.ts";
import { loadInboxItems } from "./inbox.ts";

export function buildInboxSearchRecords(
  items: readonly InboxItem[],
): readonly WorkspaceSearchRecord[] {
  return items.map((entry, order) =>
    createWorkspaceSearchRecord({
      id: entry.id,
      category: "inboxItem",
      categoryLabel: "收件箱",
      title: searchSnippet(entry.rawText, 60) || "收件箱内容",
      summary: entry.status === "pending" ? "待整理" : "本地收集",
      target: createInboxItemTarget(entry.id),
      updatedAt: entry.updatedAt,
      activeRank: entry.status === "dismissed" || entry.status === "confirmed" ? 1 : 0,
      sourceRank: 70_000 + order,
      metadata: [entry.status, entry.createdAt].join(" "),
      body: entry.rawText,
    }),
  );
}

export const inboxSearchProvider: SearchProvider = Object.freeze({
  id: "inbox.search",
  moduleId: "inbox",
  order: 40,
  async loadIndex() {
    return buildInboxSearchRecords(await loadInboxItems());
  },
});
