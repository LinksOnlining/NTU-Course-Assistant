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

/** Applies one period edit and preserves every later period's duration and break. */
export function adjustPeriodSchedule(
  periods: readonly PeriodTime[],
  index: number,
  change: Readonly<Partial<Pick<PeriodTime, "startTime" | "endTime">>>,
): readonly PeriodTime[] {
  validatePeriodTimes(periods);
  const original = periods[index];
  if (!original) throw new RangeError("找不到需要调整的节次");
  const originalDuration = durationMinutes(original);
  try {
    const startTime = change.startTime ?? original.startTime;
    const endTime =
      change.endTime ??
      (change.startTime === undefined
        ? original.endTime
        : minutesToTime(timeToMinutes(startTime) + originalDuration));
    const updated = { ...original, startTime, endTime };
    durationMinutes(updated);
    const delta = timeToMinutes(updated.endTime) - timeToMinutes(original.endTime);
    const next = periods.map((period, periodIndex) => {
      if (periodIndex < index) return { ...period };
      if (periodIndex === index) return updated;
      return {
        ...period,
        startTime: minutesToTime(timeToMinutes(period.startTime) + delta),
        endTime: minutesToTime(timeToMinutes(period.endTime) + delta),
      };
    });
    validatePeriodTimes(next);
    return next;
  } catch (error) {
    if (error instanceof RangeError && /分钟数必须/u.test(error.message)) {
      throw new RangeError("调整后部分节次超出当天时间范围，请缩短或提前作息时间。");
    }
    throw error;
  }
}

/** Rebuilds all periods with one duration while retaining the first start and each original break. */
export function applyUniformPeriodDuration(
  periods: readonly PeriodTime[],
  duration: number,
): readonly PeriodTime[] {
  validatePeriodTimes(periods);
  if (!Number.isInteger(duration) || duration < 20 || duration > 120) {
    throw new RangeError("单节课时长必须是 20–120 分钟的整数");
  }
  try {
    const next = periods.reduce<PeriodTime[]>((result, period, index) => {
      const startMinutes =
        index === 0
          ? timeToMinutes(period.startTime)
          : timeToMinutes(result[index - 1].endTime) +
            timeToMinutes(period.startTime) -
            timeToMinutes(periods[index - 1].endTime);
      result.push({
        period: period.period,
        startTime: minutesToTime(startMinutes),
        endTime: minutesToTime(startMinutes + duration),
      });
      return result;
    }, []);
    validatePeriodTimes(next);
    return next;
  } catch (error) {
    if (error instanceof RangeError) {
      throw new RangeError("调整后部分节次超出当天时间范围，请缩短单节课时长。");
    }
    throw error;
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

/** Period indexes are the source of truth when present; saved clock times remain a fallback for missing mappings. */
export function resolveCourseTime(
  course: TimeRange & {
    readonly startPeriod: number | null;
    readonly endPeriod: number | null;
  },
  periods: readonly PeriodTime[],
): TimeRange {
  if (course.startPeriod === null || course.endPeriod === null) return course;
  if (periods.length === 0) return course;
  return (
    periodRangeToTimeRange(
      { startPeriod: course.startPeriod, endPeriod: course.endPeriod },
      periods,
    ) ?? course
  );
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
