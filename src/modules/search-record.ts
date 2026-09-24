import type { WorkspaceSearchRecord } from "./search-contract.ts";

export function createWorkspaceSearchRecord(
  value: Omit<WorkspaceSearchRecord, "titleText" | "metadataText" | "bodyText"> & {
    readonly metadata?: string;
    readonly body?: string;
  },
): WorkspaceSearchRecord {
  return {
    ...value,
    titleText: value.title,
    metadataText: value.metadata ?? "",
    bodyText: value.body ?? "",
  };
}

export function searchSnippet(value: string, maximum = 100): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  const characters = [...compact];
  return characters.length <= maximum ? compact : `${characters.slice(0, maximum).join("")}…`;
}

export function searchDatePart(value: string): string {
  return value.slice(0, 10);
}
