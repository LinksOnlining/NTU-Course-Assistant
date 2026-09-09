import type { PeriodRange, PeriodTime, TimeRange } from "../types/time.ts";
import { durationMinutes, minutesToTime, timeToMinutes } from "./time.ts";

export function validatePeriodTimes(periods: readonly PeriodTime[]): void {
  let previous: PeriodTime | undefined;
  for (const current of periods) {
    const expectedPeriod = previous ? previous.period + 1 : 1;
    if (
      !Number.isInteger(current.period) ||
      current.period !== expectedPeriod ||
      current.period <= 0 ||
      current.period > 30
    ) {
      throw new RangeError("节次必须从第 1 节连续编号且不超过 30 节");
    }
    durationMinutes(current);
    if (previous) {
      if (current.period <= previous.period) {
        throw new RangeError("节次配置必须按 period 严格递增且不能重复");
      }
      if (timeToMinutes(current.startTime) < timeToMinutes(previous.endTime)) {
        throw new RangeError(`第 ${previous.period}、${current.period} 节时间重叠`);
      }
    }
    previous = current;
  }
}

export function periodToTime(period: number, periods: readonly PeriodTime[]): PeriodTime | null {
  if (!Number.isInteger(period) || period <= 0) {
    throw new RangeError("节次必须是正整数");
  }
  validatePeriodTimes(periods);
  return periods.find((item) => item.period === period) ?? null;
}

export function periodRangeToTimeRange(
  range: PeriodRange,
  periods: readonly PeriodTime[],
): TimeRange | null {
  if (
    !Number.isInteger(range.startPeriod) ||
    !Number.isInteger(range.endPeriod) ||
    range.startPeriod <= 0 ||
    range.endPeriod < range.startPeriod
  ) {
    throw new RangeError("节次范围必须是递增的正整数");
  }
  validatePeriodTimes(periods);
  const selected = periods.filter(
    ({ period }) => period >= range.startPeriod && period <= range.endPeriod,
  );
  const expectedLength = range.endPeriod - range.startPeriod + 1;
  if (
    selected.length !== expectedLength ||
    selected.some(({ period }, index) => period !== range.startPeriod + index)
  ) {
    return null;
  }
  return {
    startTime: selected[0].startTime,
    endTime: selected[selected.length - 1].endTime,
  };
}

export function timeRangeToPeriods(
  range: TimeRange,
  periods: readonly PeriodTime[],
): PeriodRange | null {
  durationMinutes(range);
  validatePeriodTimes(periods);
  const startIndex = periods.findIndex((period) => period.startTime === range.startTime);
  const endIndex = periods.findIndex((period) => period.endTime === range.endTime);
  if (startIndex < 0 || endIndex < startIndex) return null;
  const selected = periods.slice(startIndex, endIndex + 1);
  if (selected.some(({ period }, index) => period !== selected[0].period + index)) return null;
  return {
    startPeriod: selected[0].period,
    endPeriod: selected[selected.length - 1].period,
  };
}

export function getTimelineBounds(axis: TimeRange, periods: readonly PeriodTime[]): TimeRange {
  durationMinutes(axis);
  validatePeriodTimes(periods);
  const earliest = Math.min(
    timeToMinutes(axis.startTime),
    ...periods.map((period) => timeToMinutes(period.startTime)),
  );
  const latest = Math.max(
    timeToMinutes(axis.endTime),
    ...periods.map((period) => timeToMinutes(period.endTime)),
  );
  const startMinutes = Math.floor(earliest / 60) * 60;
  const endMinutes = Math.ceil(latest / 60) * 60;
  return {
    startTime: minutesToTime(startMinutes),
    endTime: endMinutes >= 1440 ? "23:59" : minutesToTime(endMinutes),
  };
}
