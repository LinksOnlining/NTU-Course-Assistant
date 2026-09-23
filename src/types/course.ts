import type { TimeRange } from "./time.ts";

/** One recurring teaching arrangement; indexed rows treat inherited clock values as compatibility snapshots only. */
export interface Course extends TimeRange {
  readonly id: string;
  readonly name: string;
  readonly teacher: string | null;
  readonly classroom: string | null;
  readonly weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** The pair discriminates time mode: both indexes or neither; a partial pair is invalid. */
  readonly startPeriod: number | null;
  readonly endPeriod: number | null;
  readonly weeks: readonly number[];
}

export type Weekday = Course["weekday"];
