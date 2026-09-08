import type { Course } from "../types/course.ts";
import type { TimeRange } from "../types/time.ts";
import { durationMinutes, offsetMinutes, timeRangesOverlap } from "./time.ts";

export interface PositionedCourse {
  readonly course: Course;
  readonly offsetMinutes: number;
  readonly durationMinutes: number;
  readonly lane: number;
  readonly laneCount: number;
}

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

function positionDay(courses: readonly Course[], axis: TimeRange): PositionedCourse[] {
  const sorted = [...courses].sort(
    (first, second) =>
      offsetMinutes(first.startTime, second.startTime) ||
      offsetMinutes(first.endTime, second.endTime) ||
      first.id.localeCompare(second.id),
  );
  const positioned: PositionedCourse[] = [];

  for (let groupStart = 0; groupStart < sorted.length;) {
    let groupEnd = groupStart + 1;
    let latestEnd = sorted[groupStart].endTime;
    while (groupEnd < sorted.length && offsetMinutes(sorted[groupEnd].startTime, latestEnd) < 0) {
      if (offsetMinutes(sorted[groupEnd].endTime, latestEnd) > 0) {
        latestEnd = sorted[groupEnd].endTime;
      }
      groupEnd += 1;
    }

    const group = sorted.slice(groupStart, groupEnd);
    const laneEndTimes: string[] = [];
    const withLanes = group.map((course) => {
      const reusableLane = laneEndTimes.findIndex(
        (endTime) => offsetMinutes(course.startTime, endTime) >= 0,
      );
      const lane = reusableLane === -1 ? laneEndTimes.length : reusableLane;
      laneEndTimes[lane] = course.endTime;
      return { course, lane };
    });

    for (const { course, lane } of withLanes) {
      positioned.push({
        course,
        ...courseTiming(course, axis),
        lane,
        laneCount: laneEndTimes.length,
      });
    }
    groupStart = groupEnd;
  }
  return positioned;
}

/** Select one teaching week and return stable seven-day, minute-based layout data. */
export function layoutCourses(
  courses: readonly Course[],
  currentWeek: number,
  axis: TimeRange,
): readonly (readonly PositionedCourse[])[] {
  if (!Number.isInteger(currentWeek) || currentWeek < 1) {
    throw new RangeError("当前教学周必须是正整数");
  }
  durationMinutes(axis);
  return ([1, 2, 3, 4, 5, 6, 7] as const).map((weekday) =>
    positionDay(
      courses.filter((course) => course.weekday === weekday && course.weeks.includes(currentWeek)),
      axis,
    ),
  );
}
