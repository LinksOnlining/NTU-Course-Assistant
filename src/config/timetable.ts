import type { PeriodTime, TimeRange } from "../types/time.ts";

/** TEST DATA ONLY. Phase 1 UI fixture settings, never an official NTU timetable. */
export const TEST_TIMETABLE: {
  readonly purpose: "test-only";
  readonly currentWeek: number;
  readonly pxPerMinute: number;
  readonly axis: TimeRange;
  readonly periods: readonly PeriodTime[];
} = {
  purpose: "test-only",
  currentWeek: 3,
  pxPerMinute: 1,
  axis: { startTime: "07:00", endTime: "22:00" },
  periods: [
    { period: 1, startTime: "08:00", endTime: "08:45" },
    { period: 2, startTime: "08:50", endTime: "09:35" },
  ],
};
