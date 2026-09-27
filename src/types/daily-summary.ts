export interface DailySummary {
  readonly id: string;
  readonly summaryDate: string;
  readonly overview: string;
  readonly highlights: readonly string[];
  readonly unfinished: readonly string[];
  readonly tomorrowNotes: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}

export type DailySummaryDraft = Pick<
  DailySummary,
  "summaryDate" | "overview" | "highlights" | "unfinished" | "tomorrowNotes"
>;
