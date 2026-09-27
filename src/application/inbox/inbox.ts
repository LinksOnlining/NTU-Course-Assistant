import type { PersonalTask } from "../../types/personal-task.ts";
import type { PlannerEvent } from "../../types/planner.ts";
import type {
  InboxConfirmation,
  InboxItem,
  InboxParseKind,
  InboxProposal,
} from "../../types/inbox.ts";
import * as inboxStorage from "../../services/inbox-storage.ts";
import { validatePlannerEventDraft } from "../planner/planner-schedule.ts";
import { validatePersonalTaskDraft } from "../planner/personal-tasks.ts";
import { INBOX_PARSER_VERSION, parseInboxText } from "./inbox-parser.ts";

export interface InboxRepository {
  createInboxItem(id: string, rawText: string, createdAt: string): Promise<InboxItem>;
  loadInboxItems(): Promise<readonly InboxItem[]>;
  saveInboxParseResult(
    id: string,
    parseKind: InboxParseKind,
    parsePayloadJson: string,
    parserVersion: string,
    updatedAt: string,
  ): Promise<InboxItem>;
  dismissInboxItem(id: string, updatedAt: string): Promise<void>;
  deleteInboxItem(id: string): Promise<void>;
  confirmInboxAsTask(id: string, task: PersonalTask): Promise<InboxConfirmation>;
  confirmInboxAsEvent(id: string, event: PlannerEvent): Promise<InboxConfirmation>;
}

const defaultRepository: InboxRepository = inboxStorage;

export function saveInboxParseResult(
  id: string,
  proposal: InboxProposal,
  repository: InboxRepository = defaultRepository,
  now = new Date(),
): Promise<InboxItem> {
  return repository.saveInboxParseResult(
    id,
    proposal.kind,
    JSON.stringify(proposal),
    INBOX_PARSER_VERSION,
    now.toISOString(),
  );
}

export async function captureInboxText(
  rawText: string,
  repository: InboxRepository = defaultRepository,
  now = new Date(),
  id = crypto.randomUUID(),
): Promise<{
  readonly item: InboxItem;
  readonly proposal: InboxProposal;
  readonly parseError: string | null;
}> {
  const createdAt = now.toISOString();
  // Preserve the original before parsing; parse or persistence errors must never lose raw input.
  const rawItem = await repository.createInboxItem(id, rawText, createdAt);
  const capturedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const proposal = parseInboxText(rawItem.rawText, capturedDate);
  try {
    const item = await repository.saveInboxParseResult(
      rawItem.id,
      proposal.kind,
      JSON.stringify(proposal),
      INBOX_PARSER_VERSION,
      new Date().toISOString(),
    );
    return { item, proposal, parseError: null };
  } catch {
    return {
      item: rawItem,
      proposal,
      parseError: "原文已保存，但解析结果未能保存；可以稍后重新整理。",
    };
  }
}

export function proposalForInboxItem(item: InboxItem): InboxProposal {
  if (item.parsePayloadJson) {
    try {
      const value = JSON.parse(item.parsePayloadJson) as Partial<InboxProposal>;
      if (
        (value.kind === "task" || value.kind === "event" || value.kind === "unknown") &&
        typeof value.title === "string" &&
        (value.date === null || typeof value.date === "string") &&
        (value.startTime === null || typeof value.startTime === "string") &&
        (value.endTime === null || typeof value.endTime === "string") &&
        (value.deadlineDate === null || typeof value.deadlineDate === "string") &&
        (value.deadlineTime === null || typeof value.deadlineTime === "string")
      ) {
        return value as InboxProposal;
      }
    } catch {
      // Reparse below from the preserved local raw text.
    }
  }
  const capturedAt = new Date(item.createdAt);
  const capturedDate = `${capturedAt.getFullYear()}-${String(capturedAt.getMonth() + 1).padStart(2, "0")}-${String(capturedAt.getDate()).padStart(2, "0")}`;
  return parseInboxText(item.rawText, capturedDate);
}

export function validateInboxTaskProposal(proposal: InboxProposal): string | null {
  if (!proposal.title.trim()) return "请输入任务标题。";
  if (proposal.deadlineTime && !proposal.deadlineDate) return "填写截止时间时也需要选择截止日期。";
  return (
    Object.values(
      validatePersonalTaskDraft({
        title: proposal.title,
        description: proposal.description ?? "",
        priority: proposal.priority ?? "none",
        deadlineDate: proposal.deadlineDate ?? "",
        deadlineTime: proposal.deadlineTime ?? "",
      }),
    )[0] ?? null
  );
}

export function validateInboxEventProposal(proposal: InboxProposal): string | null {
  return (
    Object.values(
      validatePlannerEventDraft({
        title: proposal.title,
        description: proposal.description ?? "",
        date: proposal.date ?? "",
        startTime: proposal.startTime ?? "",
        endTime: proposal.endTime ?? "",
        location: proposal.location ?? "",
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
      }),
    )[0] ?? null
  );
}

export async function confirmInboxTask(
  item: InboxItem,
  proposal: InboxProposal,
  repository: InboxRepository = defaultRepository,
  now = new Date(),
  id = crypto.randomUUID(),
): Promise<InboxConfirmation> {
  return confirmInboxTaskById(item.id, proposal, repository, now, id);
}

/** AI-reviewed Inbox proposals reuse the same atomic, idempotent repository confirmation. */
export async function confirmInboxTaskById(
  inboxItemId: string,
  proposal: InboxProposal,
  repository: InboxRepository = defaultRepository,
  now = new Date(),
  id = crypto.randomUUID(),
): Promise<InboxConfirmation> {
  const error = validateInboxTaskProposal(proposal);
  if (error) throw new Error(error);
  const timestamp = now.toISOString();
  return repository.confirmInboxAsTask(inboxItemId, {
    id,
    title: proposal.title.trim(),
    description: proposal.description?.trim() || null,
    status: "open",
    priority: proposal.priority ?? "none",
    deadlineDate: proposal.deadlineDate,
    deadlineTime: proposal.deadlineTime,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
  });
}

export async function confirmInboxEvent(
  item: InboxItem,
  proposal: InboxProposal,
  repository: InboxRepository = defaultRepository,
  now = new Date(),
  id = crypto.randomUUID(),
): Promise<InboxConfirmation> {
  return confirmInboxEventById(item.id, proposal, repository, now, id);
}

/** AI-reviewed Inbox proposals reuse the same atomic, idempotent repository confirmation. */
export async function confirmInboxEventById(
  inboxItemId: string,
  proposal: InboxProposal,
  repository: InboxRepository = defaultRepository,
  now = new Date(),
  id = crypto.randomUUID(),
): Promise<InboxConfirmation> {
  const error = validateInboxEventProposal(proposal);
  if (error) throw new Error(error);
  const timestamp = now.toISOString();
  return repository.confirmInboxAsEvent(inboxItemId, {
    id,
    title: proposal.title.trim(),
    description: proposal.description?.trim() || null,
    date: proposal.date ?? "",
    startTime: proposal.startTime ?? "",
    endTime: proposal.endTime ?? "",
    location: proposal.location?.trim() || null,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function dismissInboxItem(
  id: string,
  repository: InboxRepository = defaultRepository,
  now = new Date(),
): Promise<void> {
  return repository.dismissInboxItem(id, now.toISOString());
}

export function deleteInboxItem(
  id: string,
  repository: InboxRepository = defaultRepository,
): Promise<void> {
  return repository.deleteInboxItem(id);
}

export function loadInboxItems(
  repository: InboxRepository = defaultRepository,
): Promise<readonly InboxItem[]> {
  return repository.loadInboxItems();
}
