export type AiProposalStatus =
  "draft" | "reviewRequired" | "approved" | "rejected" | "applied" | "failed" | "stale";

export type AiProposalType = "text" | "task" | "event" | "timeBlock" | "inbox" | "diarySuggestion";
export type AiProposalSource = "mock" | "deepseek" | "local/system";

export interface AiProposalPreviewField {
  readonly label: string;
  readonly value: string;
  readonly previousValue?: string;
}

export interface AiProposalWarning {
  readonly code: "timeConflict";
  readonly message: string;
  readonly details: readonly string[];
}

export interface AiProposalPreview {
  /** 完全由本地代码生成；不能复制 Provider 的解释文字。 */
  readonly title: string;
  readonly fields: readonly AiProposalPreviewField[];
  readonly warnings: readonly AiProposalWarning[];
  readonly revision: number;
}

export interface AiProposalPreconditions {
  readonly warningFingerprint: string;
  readonly linkedTask?: {
    readonly id: string;
    readonly updatedAt: string;
    readonly status: "open" | "completed";
  };
}

export interface AiProposalBase<
  Type extends AiProposalType = AiProposalType,
  Payload extends object = Readonly<Record<string, unknown>>,
> {
  readonly id: string;
  readonly type: Type;
  readonly source: AiProposalSource;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly status: AiProposalStatus;
  readonly requiredPermission: "planner.propose";
  readonly requiresConfirmation: true;
  /** Deterministic local label; it is never copied from model prose. */
  readonly title: string;
  readonly description: string;
  readonly payload: Payload;
  readonly preview: AiProposalPreview;
  readonly preconditions: AiProposalPreconditions;
}

export interface TaskProposalPayload {
  readonly title: string;
  readonly description?: string;
  readonly deadlineDate: string | null;
  readonly deadlineTime: string | null;
  readonly priority: "none" | "low" | "medium" | "high";
}

export interface EventProposalPayload {
  readonly title: string;
  readonly description?: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly location: string | null;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
}

export interface TimeBlockProposalPayload {
  readonly personalTaskId: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
}

export type TaskProposal = AiProposalBase<"task", TaskProposalPayload>;
export type EventProposal = AiProposalBase<"event", EventProposalPayload>;
export type TimeBlockProposal = AiProposalBase<"timeBlock", TimeBlockProposalPayload>;
export type TextProposal = AiProposalBase<"text", { readonly text: string }>;
export type InboxProposal = AiProposalBase<"inbox">;
export type DiarySuggestion = AiProposalBase<"diarySuggestion", { readonly suggestion: string }>;

export type AiPlannerProposal = TaskProposal | EventProposal | TimeBlockProposal;
export type AiProposal =
  TextProposal | TaskProposal | EventProposal | TimeBlockProposal | InboxProposal | DiarySuggestion;

const ALLOWED_TRANSITIONS: Readonly<Record<AiProposalStatus, readonly AiProposalStatus[]>> = {
  draft: ["reviewRequired", "rejected", "failed", "stale"],
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

export function transitionAiProposal<Value extends AiProposal>(
  proposal: Value,
  status: AiProposalStatus,
): Value {
  if (!canTransitionAiProposal(proposal.status, status)) {
    throw new Error("AI Proposal 状态转换无效。");
  }
  return Object.freeze({ ...proposal, status }) as unknown as Value;
}
