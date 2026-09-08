import type { TimeRange } from "../types/time.ts";

/** Strict 00:00–23:59; no trimming, normalization or rollover to another day. */
export function timeToMinutes(time: string): number {
  if (typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new RangeError("时间必须为 00:00–23:59 范围内的 HH:mm");
  }
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function minutesToTime(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) {
    throw new RangeError("分钟数必须是 0–1439 范围内的整数");
  }
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** A signed offset: a time before the origin stays negative instead of being clipped. */
export function offsetMinutes(time: string, origin: string): number {
  return timeToMinutes(time) - timeToMinutes(origin);
}

export function durationMinutes(range: TimeRange): number {
  const duration = timeToMinutes(range.endTime) - timeToMinutes(range.startTime);
  if (duration <= 0) throw new RangeError("结束时间必须晚于开始时间，不支持跨午夜区间");
  return duration;
}

/** Directed gap between two valid intervals. Overlaps/reversed order have no free gap. */
export function idleMinutes(previous: TimeRange, next: TimeRange): number {
  durationMinutes(previous);
  durationMinutes(next);
  return Math.max(0, timeToMinutes(next.startTime) - timeToMinutes(previous.endTime));
}

/** Half-open intervals [start, end): touching endpoints are not an overlap. */
export function timeRangesOverlap(first: TimeRange, second: TimeRange): boolean {
  durationMinutes(first);
  durationMinutes(second);
  return (
    timeToMinutes(first.startTime) < timeToMinutes(second.endTime) &&
    timeToMinutes(second.startTime) < timeToMinutes(first.endTime)
  );
}
