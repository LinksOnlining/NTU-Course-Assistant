import type { PdfTextItem } from "./pdf.ts";
import type { TimeRange } from "./time.ts";

export type ImportIssueSeverity = "warning" | "blocking";

export type ImportIssueField =
  "name" | "teacher" | "classroom" | "weekday" | "periods" | "weeks" | "time" | "source" | "course";

export type ImportIssueCode =
  | "missing-name"
  | "missing-weekday"
  | "missing-period"
  | "invalid-weeks"
  | "missing-classroom"
  | "unassigned-classroom"
  | "missing-teacher"
  | "test-schedule"
  | "period-not-mapped"
  | "ambiguous-source"
  | "invalid-candidate"
  | "duplicate-course"
  | "schedule-conflict";

export interface ImportIssue {
  readonly code: ImportIssueCode;
  readonly field: ImportIssueField;
  readonly severity: ImportIssueSeverity;
  readonly message: string;
}

export interface ImportSource {
  readonly page: number;
  readonly text: string;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly items: readonly PdfTextItem[];
}

/** A reviewable PDF result. It is not a Course and is never persisted directly. */
export interface ImportCandidate {
  readonly id: string;
  readonly kind: "fixed" | "practice";
  readonly name: string | null;
  readonly teacher: string | null;
  readonly classroom: string | null;
  readonly weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7 | null;
  readonly startPeriod: number | null;
  readonly endPeriod: number | null;
  readonly weeks: readonly number[] | null;
  readonly resolvedTime: TimeRange | null;
  readonly source: ImportSource;
  readonly issues: readonly ImportIssue[];
}

/** User-reviewed fields layered over the immutable parser result. */
export interface ImportCandidateEdit {
  readonly name: string | null;
  readonly teacher: string | null;
  readonly classroom: string | null;
  readonly weekday: ImportCandidate["weekday"];
  readonly startPeriod: number | null;
  readonly endPeriod: number | null;
  readonly weeks: readonly number[] | null;
}
