import { invoke } from "@tauri-apps/api/core";
import type { InboxConfirmation, InboxItem, InboxParseKind } from "../types/inbox.ts";
import type { PersonalTask } from "../types/personal-task.ts";
import type { PlannerEvent } from "../types/planner.ts";
import { createPersonalTask as createDevelopmentTask } from "./planner-storage.ts";
import { createPlannerEvent as createDevelopmentEvent } from "./planner-storage.ts";

let developmentItems: InboxItem[] = [];

function usesDevelopmentMemory(): boolean {
  return import.meta.env.DEV && !("__TAURI_INTERNALS__" in window);
}

function copyItem(item: InboxItem): InboxItem {
  return { ...item };
}

export async function createInboxItem(
  id: string,
  rawText: string,
  createdAt: string,
): Promise<InboxItem> {
  if (usesDevelopmentMemory()) {
    if (developmentItems.some((item) => item.id === id)) throw new Error("收件箱内容已存在。");
    const item: InboxItem = {
      id,
      rawText,
      status: "pending",
      parseKind: null,
      parsePayloadJson: null,
      parserVersion: null,
      confirmedTargetType: null,
      confirmedTargetId: null,
      createdAt,
      updatedAt: createdAt,
    };
    developmentItems = [item, ...developmentItems];
    return copyItem(item);
  }
  return invoke<InboxItem>("create_inbox_item", { id, rawText, createdAt });
}

export async function loadInboxItems(): Promise<readonly InboxItem[]> {
  if (usesDevelopmentMemory()) return developmentItems.map(copyItem);
  return invoke<readonly InboxItem[]>("load_inbox_items");
}

export async function countPendingInboxItems(): Promise<number> {
  if (usesDevelopmentMemory()) {
    return developmentItems.filter((item) =>
      ["pending", "needs_review", "ready"].includes(item.status),
    ).length;
  }
  return invoke<number>("count_pending_inbox_items");
}

export async function saveInboxParseResult(
  id: string,
  parseKind: InboxParseKind,
  parsePayloadJson: string,
  parserVersion: string,
  updatedAt: string,
): Promise<InboxItem> {
  if (usesDevelopmentMemory()) {
    const current = developmentItems.find((item) => item.id === id);
    if (!current || current.status === "confirmed" || current.status === "dismissed") {
      throw new Error("收件箱内容当前不可解析。");
    }
    const item: InboxItem = {
      ...current,
      status: parseKind === "unknown" ? "needs_review" : "ready",
      parseKind,
      parsePayloadJson,
      parserVersion,
      updatedAt,
    };
    developmentItems = developmentItems.map((candidate) =>
      candidate.id === id ? item : candidate,
    );
    return copyItem(item);
  }
  return invoke<InboxItem>("save_inbox_parse_result", {
    id,
    parseKind,
    parsePayloadJson,
    parserVersion,
    updatedAt,
  });
}

export async function dismissInboxItem(id: string, updatedAt: string): Promise<void> {
  if (usesDevelopmentMemory()) {
    const current = developmentItems.find((item) => item.id === id);
    if (!current || current.status === "confirmed") throw new Error("收件箱内容无法忽略。");
    developmentItems = developmentItems.map((item) =>
      item.id === id ? { ...item, status: "dismissed", updatedAt } : item,
    );
    return;
  }
  await invoke("dismiss_inbox_item", { id, updatedAt });
}

export async function deleteInboxItem(id: string): Promise<void> {
  if (usesDevelopmentMemory()) {
    if (!developmentItems.some((item) => item.id === id)) throw new Error("收件箱内容不存在。");
    developmentItems = developmentItems.filter((item) => item.id !== id);
    return;
  }
  await invoke("delete_inbox_item", { id });
}

export async function confirmInboxAsTask(
  id: string,
  task: PersonalTask,
): Promise<InboxConfirmation> {
  if (usesDevelopmentMemory()) {
    const current = developmentItems.find((item) => item.id === id);
    if (
      current?.status === "confirmed" &&
      current.confirmedTargetId &&
      current.confirmedTargetType
    ) {
      return { targetId: current.confirmedTargetId, targetType: current.confirmedTargetType };
    }
    await createDevelopmentTask(task);
    developmentItems = developmentItems.map((item) =>
      item.id === id
        ? {
            ...item,
            status: "confirmed",
            confirmedTargetType: "personalTask",
            confirmedTargetId: task.id,
            updatedAt: task.updatedAt,
          }
        : item,
    );
    return { targetType: "personalTask", targetId: task.id };
  }
  return invoke<InboxConfirmation>("confirm_inbox_as_task", { id, task });
}

export async function confirmInboxAsEvent(
  id: string,
  event: PlannerEvent,
): Promise<InboxConfirmation> {
  if (usesDevelopmentMemory()) {
    const current = developmentItems.find((item) => item.id === id);
    if (
      current?.status === "confirmed" &&
      current.confirmedTargetId &&
      current.confirmedTargetType
    ) {
      return { targetId: current.confirmedTargetId, targetType: current.confirmedTargetType };
    }
    await createDevelopmentEvent(event);
    developmentItems = developmentItems.map((item) =>
      item.id === id
        ? {
            ...item,
            status: "confirmed",
            confirmedTargetType: "plannerEvent",
            confirmedTargetId: event.id,
            updatedAt: event.updatedAt,
          }
        : item,
    );
    return { targetType: "plannerEvent", targetId: event.id };
  }
  return invoke<InboxConfirmation>("confirm_inbox_as_event", { id, event });
}
