import type { TimeRange } from "./time.ts";

/** One recurring teaching arrangement, not a course catalogue or UI card. */
export interface Course extends TimeRange {
  readonly id: string;
  readonly name: string;
  readonly teacher: string | null;
  readonly classroom: string | null;
  readonly weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly startPeriod: number;
  readonly endPeriod: number;
  readonly weeks: readonly number[];
}
