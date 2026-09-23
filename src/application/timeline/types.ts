import type { ObjectRef } from "../../navigation/types.ts";

export type TimelineSourceType = "academicOccurrence" | "plannerEvent" | "timeBlock" | "aiProposal";

export type TimelineItemStatus = "normal" | "rescheduled" | "makeup" | "cancelled";

/** A display projection, not a persisted domain entity. */
export interface TimelineItem {
  readonly id: string;
  readonly sourceType: TimelineSourceType;
  readonly sourceRef: ObjectRef;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly title: string;
  readonly location: string | null;
  readonly status: TimelineItemStatus;
  readonly editable: boolean;
  readonly draggable: boolean;
  readonly resizable: boolean;
  readonly occupiesTime: boolean;
  readonly warnings: readonly string[];
}
