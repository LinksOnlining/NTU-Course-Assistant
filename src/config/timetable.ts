import type { PeriodTime, TimeRange } from "../types/time.ts";

/** TEST DATA ONLY. This is not an official NTU period schedule. */
export const TEST_PERIOD_TIMES: readonly PeriodTime[] = [
  { period: 1, startTime: "08:00", endTime: "08:45" },
  { period: 2, startTime: "08:50", endTime: "09:35" },
  { period: 3, startTime: "09:55", endTime: "10:40" },
  { period: 4, startTime: "10:45", endTime: "11:30" },
  { period: 5, startTime: "11:35", endTime: "12:20" },
  { period: 6, startTime: "14:00", endTime: "14:45" },
  { period: 7, startTime: "14:50", endTime: "15:35" },
  { period: 8, startTime: "16:00", endTime: "16:45" },
  { period: 9, startTime: "16:50", endTime: "17:35" },
  { period: 10, startTime: "19:00", endTime: "19:45" },
  { period: 11, startTime: "19:50", endTime: "20:35" },
];

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
  periods: TEST_PERIOD_TIMES,
};
