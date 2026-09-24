import { searchSnippet } from "../../modules/search-record.ts";
import { workspaceSearchProviders } from "./search-providers.ts";
import type { WorkspaceSearchItem, WorkspaceSearchRecord } from "../../modules/search-contract.ts";
import type { SearchProvider } from "../../modules/search-provider-registry.ts";

export type {
  WorkspaceSearchCategory,
  WorkspaceSearchItem,
  WorkspaceSearchRecord,
} from "../../modules/search-contract.ts";

export interface WorkspaceSearchIndexLoad {
  readonly records: readonly WorkspaceSearchRecord[];
  readonly unavailableProviderIds: readonly string[];
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN").replace(/\s+/gu, " ");
}

function matchRank(query: string, entry: WorkspaceSearchRecord): number | null {
  const title = normalize(entry.titleText);
  if (title === query) return 0;
  if (title.startsWith(query)) return 1;
  if (title.includes(query)) return 2;
  if (normalize(entry.metadataText).includes(query)) return 3;
  if (normalize(entry.bodyText).includes(query)) return 4;
  return null;
}

function limitResults(maximumResults: number): number {
  return Number.isFinite(maximumResults)
    ? Math.max(0, Math.min(50, Math.floor(maximumResults)))
    : 50;
}

export function searchWorkspaceIndex(
  query: string,
  index: readonly WorkspaceSearchRecord[],
  maximumResults = 50,
): readonly WorkspaceSearchItem[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  return index
    .map((entry) => ({ entry, rank: matchRank(normalizedQuery, entry) }))
    .filter((match): match is { entry: WorkspaceSearchRecord; rank: number } => match.rank !== null)
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.entry.activeRank - right.entry.activeRank ||
        right.entry.updatedAt.localeCompare(left.entry.updatedAt) ||
        left.entry.sourceRank - right.entry.sourceRank ||
        left.entry.id.localeCompare(right.entry.id),
    )
    .slice(0, limitResults(maximumResults))
    .map(({ entry, rank }) => ({
      id: entry.id,
      category: entry.category,
      categoryLabel: entry.categoryLabel,
      title: entry.title,
      summary:
        rank === 4 ? searchSnippet(entry.bodyText) : entry.summary || searchSnippet(entry.bodyText),
      target: entry.target,
    }));
}

/** 单个模块读取失败只使它自己的内容不可搜索。 */
export async function loadWorkspaceSearchIndex(
  providers: readonly SearchProvider[] = workspaceSearchProviders,
): Promise<WorkspaceSearchIndexLoad> {
  const outcomes = await Promise.all(
    providers.map(async (provider) => {
      try {
        return { provider, records: await provider.loadIndex(), failed: false };
      } catch {
        return { provider, records: [] as readonly WorkspaceSearchRecord[], failed: true };
      }
    }),
  );
  return {
    records: outcomes.flatMap(({ records }) => records),
    unavailableProviderIds: outcomes
      .filter(({ failed }) => failed)
      .map(({ provider }) => provider.id),
  };
}

/** 纯索引查询别名，供调用方和测试使用；不负责读取模块数据。 */
export function searchWorkspace(
  query: string,
  records: readonly WorkspaceSearchRecord[],
  maximumResults = 50,
): readonly WorkspaceSearchItem[] {
  return searchWorkspaceIndex(query, records, maximumResults);
}

export function workspaceSearchUnavailableMessage(ids: readonly string[]): string {
  if (ids.length === 0) return "";
  const providerLabels = new Map([
    ["academic.search", "课程与学业事项"],
    ["planner.search", "个人任务与日程"],
    ["diary.search", "日记"],
    ["inbox.search", "收件箱"],
  ]);
  const names = ids.map((id) => providerLabels.get(id)).filter(Boolean);
  return names.length
    ? `${names.join("、")}暂时无法搜索；其他模块仍可使用。`
    : "部分内容暂时无法搜索；其他模块仍可使用。";
}

export type { SearchProvider };
