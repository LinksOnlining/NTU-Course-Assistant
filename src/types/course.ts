import type { TimeRange } from "./time.ts";

/** One recurring teaching arrangement, not a course catalogue or UI card. */
export interface Course extends TimeRange {
  readonly id: string;
  readonly name: string;
  readonly teacher: string | null;
  readonly classroom: string | null;
  readonly weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Unknown until a confirmed school period mapping is available. */
  readonly startPeriod: number | null;
  readonly endPeriod: number | null;
  readonly weeks: readonly number[];
}

export type Weekday = Course["weekday"];
