import type { NavigationTarget } from "../navigation/types.ts";

/** Search modules can add stable category discriminants by declaration merging. */
export interface WorkspaceSearchCategoryMap {
  readonly course: "course";
  readonly academicTask: "academicTask";
  readonly personalTask: "personalTask";
  readonly plannerEvent: "plannerEvent";
  readonly exam: "exam";
  readonly diaryEntry: "diaryEntry";
  readonly inboxItem: "inboxItem";
}

export type WorkspaceSearchCategory = WorkspaceSearchCategoryMap[keyof WorkspaceSearchCategoryMap];

export interface WorkspaceSearchItem {
  readonly id: string;
  readonly category: WorkspaceSearchCategory;
  readonly categoryLabel: string;
  readonly title: string;
  readonly summary: string;
  readonly target: NavigationTarget;
}

/** 仅保留在本机搜索中的索引；私有正文不进入日志、数据库或网络请求。 */
export interface WorkspaceSearchRecord extends WorkspaceSearchItem {
  readonly updatedAt: string;
  readonly activeRank: number;
  readonly sourceRank: number;
  readonly titleText: string;
  readonly metadataText: string;
  readonly bodyText: string;
}
