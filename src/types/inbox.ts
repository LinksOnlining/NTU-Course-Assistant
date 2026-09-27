import type { PersonalTaskPriority } from "./personal-task.ts";

export type InboxStatus = "pending" | "needs_review" | "ready" | "confirmed" | "dismissed";
export type InboxParseKind = "task" | "event" | "unknown";
export type InboxTargetType = "personalTask" | "plannerEvent";

export interface InboxProposal {
  readonly kind: InboxParseKind;
  readonly title: string;
  readonly description?: string;
  readonly priority?: PersonalTaskPriority;
  readonly date: string | null;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly location?: string | null;
  readonly deadlineDate: string | null;
  readonly deadlineTime: string | null;
}

export interface InboxItem {
  readonly id: string;
  readonly rawText: string;
  readonly status: InboxStatus;
  readonly parseKind: InboxParseKind | null;
  readonly parsePayloadJson: string | null;
  readonly parserVersion: string | null;
  readonly confirmedTargetType: InboxTargetType | null;
  readonly confirmedTargetId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InboxConfirmation {
  readonly targetType: InboxTargetType;
  readonly targetId: string;
}
