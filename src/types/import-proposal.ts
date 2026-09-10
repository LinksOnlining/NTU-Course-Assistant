import type { Course } from "./course.ts";
import type { ImportCandidate, ImportIssue, ImportIssueSeverity } from "./import-candidate.ts";
import type { TimeRange } from "./time.ts";

export type ProposedCourse = Omit<Course, "id">;

/** A validated course-shaped proposal. A final Course ID is deliberately absent. */
export interface CourseProposal {
  readonly candidateId: string;
  readonly course: ProposedCourse;
}

export interface CandidateEvaluation {
  readonly candidate: ImportCandidate;
  readonly resolvedTime: TimeRange | null;
  readonly proposal: CourseProposal | null;
  readonly issues: readonly ImportIssue[];
  readonly status: "ready" | "warning" | "blocking";
}

export interface ImportEvaluationSummary {
  readonly total: number;
  readonly fixed: number;
  readonly practice: number;
  readonly ready: number;
  readonly warning: number;
  readonly blocking: number;
  readonly proposalCount: number;
}

export interface ImportEvaluation {
  readonly candidates: readonly CandidateEvaluation[];
  readonly summary: ImportEvaluationSummary;
  readonly canContinue: boolean;
}

export type ImportPlanAction = "insert" | "skip-duplicate";
export type DuplicateSource = "existing" | "proposal";

export interface ImportPlanEntry {
  readonly proposal: CourseProposal;
  readonly action: ImportPlanAction;
  readonly duplicateSource: DuplicateSource | null;
  readonly hasConflict: boolean;
}

export interface ImportPlanSummary {
  readonly total: number;
  readonly toInsert: number;
  readonly skippedDuplicates: number;
  readonly conflicts: number;
}

/** Deterministic write plan. IDs are intentionally allocated after this plan exists. */
export interface ImportPlan {
  readonly entries: readonly ImportPlanEntry[];
  readonly toInsert: readonly CourseProposal[];
  readonly summary: ImportPlanSummary;
}

export type IssueStatus = ImportIssueSeverity | "ready";
