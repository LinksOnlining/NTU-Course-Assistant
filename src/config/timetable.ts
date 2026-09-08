import type { PeriodTime, TimeRange } from "../types/time.ts";

/** TEST DATA ONLY. Not the official NTU timetable; not loaded into the desktop UI. */
export const TEST_TIMETABLE: {
  readonly purpose: "test-only";
  readonly axis: TimeRange;
  readonly periods: readonly PeriodTime[];
} = {
  purpose: "test-only",
  axis: { startTime: "07:00", endTime: "22:00" },
  periods: [
    { period: 1, startTime: "08:00", endTime: "08:45" },
    { period: 2, startTime: "08:50", endTime: "09:35" },
  ],
};
