import type { AiJsonObject } from "./tool.ts";

export type AiProposalStatus =
  "draft" | "reviewRequired" | "approved" | "rejected" | "applied" | "failed" | "stale";

export type AiProposalType = "text" | "task" | "event" | "timeBlock" | "inbox" | "diarySuggestion";

export interface AiProposalBase<
  Type extends AiProposalType = AiProposalType,
  Payload extends AiJsonObject = AiJsonObject,
> {
  readonly id: string;
  readonly type: Type;
  readonly title: string;
  readonly description: string;
  readonly payload: Payload;
  readonly status: AiProposalStatus;
  readonly requiresConfirmation: true;
}

export type TextProposal = AiProposalBase<"text", { readonly text: string }>;
export type TaskProposal = AiProposalBase<"task">;
export type EventProposal = AiProposalBase<"event">;
export type TimeBlockProposal = AiProposalBase<"timeBlock">;
export type InboxProposal = AiProposalBase<"inbox">;
export type DiarySuggestion = AiProposalBase<"diarySuggestion", { readonly suggestion: string }>;

export type AiProposal =
  TextProposal | TaskProposal | EventProposal | TimeBlockProposal | InboxProposal | DiarySuggestion;

const ALLOWED_TRANSITIONS: Readonly<Record<AiProposalStatus, readonly AiProposalStatus[]>> = {
  draft: ["reviewRequired", "rejected", "failed"],
  reviewRequired: ["approved", "rejected", "failed", "stale"],
  approved: ["applied", "failed", "stale"],
  rejected: [],
  applied: [],
  failed: [],
  stale: [],
};

export function canTransitionAiProposal(from: AiProposalStatus, to: AiProposalStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
