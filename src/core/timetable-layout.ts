import type { Course } from "../types/course.ts";
import type { TimeRange } from "../types/time.ts";
import { durationMinutes, offsetMinutes, timeRangesOverlap } from "./time.ts";

/** Geometry inputs in minutes only. Pixel scale and rendering belong to the future UI. */
export function courseTiming(
  course: TimeRange,
  axis: TimeRange,
): {
  readonly offsetMinutes: number;
  readonly durationMinutes: number;
} {
  const axisDuration = durationMinutes(axis);
  const duration = durationMinutes(course);
  const offset = offsetMinutes(course.startTime, axis.startTime);
  if (offset < 0 || offset + duration > axisDuration) {
    throw new RangeError("课程超出时间轴范围，请扩展时间轴，不能静默裁剪");
  }
  return { offsetMinutes: offset, durationMinutes: duration };
}

export function coursesOverlap(first: Course, second: Course): boolean {
  const overlapsInTime = timeRangesOverlap(first, second);
  return (
    overlapsInTime &&
    first.weekday === second.weekday &&
    first.weeks.some((week) => second.weeks.includes(week))
  );
}
