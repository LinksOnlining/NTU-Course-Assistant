import {
  getCourseDate,
  getShanghaiWeekday,
  getTeachingWeek,
  validateTermConfig,
} from "./reminder.ts";
import type { Course } from "../types/course.ts";
import type { CourseOverride } from "../types/course-override.ts";
import type { AcademicCourseOccurrence } from "../types/academic-occurrence.ts";
import type { Semester } from "../types/semester.ts";
import type { TermConfig } from "../types/reminder.ts";
import type { PeriodTime } from "../types/time.ts";
import { resolveCourseTime } from "./period-time.ts";

export interface OccurrenceDateRange {
  readonly from: string;
  readonly to: string;
}

function termConfig(semester: Semester): TermConfig {
  return {
    firstWeekMonday: semester.firstWeekMonday,
    totalWeeks: semester.totalWeeks,
    timezone: semester.timezone,
  };
}

function isWeekday(value: number): value is 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  return Number.isInteger(value) && value >= 1 && value <= 7;
}

function inRange(date: string, range: OccurrenceDateRange | undefined): boolean {
  return range === undefined || (date >= range.from && date <= range.to);
}

function baseOccurrence(
  course: Course,
  semester: Semester,
  week: number,
  periods: readonly PeriodTime[],
): AcademicCourseOccurrence | null {
  const config = termConfig(semester);
  const date = getCourseDate(config, week, course.weekday);
  const time = resolveCourseTime(course, periods);
  if (time === null) return null;
  return {
    courseId: course.id,
    semesterId: semester.id,
    date,
    teachingWeek: week,
    weekday: course.weekday,
    startPeriod: course.startPeriod,
    endPeriod: course.endPeriod,
    startTime: time.startTime,
    endTime: time.endTime,
    room: course.classroom,
    teacher: course.teacher,
    status: "NORMAL",
    source: "BASE",
    originalOccurrenceKey: null,
    occurrenceKey: `${course.id}:${semester.id}:${date}:${time.startTime}`,
    appliedOverrideId: null,
    appliedOverrideKind: null,
  };
}

function applyOverride(
  occurrence: AcademicCourseOccurrence,
  semester: Semester,
  override: CourseOverride,
): AcademicCourseOccurrence {
  const date = override.targetDate ?? occurrence.date;
  const weekdayValue = getShanghaiWeekday(date);
  if (!isWeekday(weekdayValue)) throw new RangeError("覆盖日期星期无效");
  const startTime = override.startTime ?? occurrence.startTime;
  const endTime = override.endTime ?? occurrence.endTime;
  const status = override.kind === "RESCHEDULE" ? "RESCHEDULED" : "NORMAL";
  return {
    ...occurrence,
    date,
    teachingWeek: getTeachingWeek(date, termConfig(semester)) ?? occurrence.teachingWeek,
    weekday: weekdayValue,
    startPeriod:
      override.startTime !== null || override.endTime !== null
        ? null
        : (override.startPeriod ?? occurrence.startPeriod),
    endPeriod:
      override.startTime !== null || override.endTime !== null
        ? null
        : (override.endPeriod ?? occurrence.endPeriod),
    startTime,
    endTime,
    room: override.classroom ?? occurrence.room,
    teacher: override.teacher ?? occurrence.teacher,
    status,
    source: "OVERRIDE",
    originalOccurrenceKey: occurrence.occurrenceKey,
    occurrenceKey: `${occurrence.courseId}:${occurrence.semesterId}:${date}:${startTime}:${override.id}`,
    appliedOverrideId: override.id,
    appliedOverrideKind: override.kind,
  };
}

function matchesBase(occurrence: AcademicCourseOccurrence, override: CourseOverride): boolean {
  return (
    override.active &&
    override.courseId === occurrence.courseId &&
    override.semesterId === occurrence.semesterId &&
    ((override.originalOccurrenceKey !== null &&
      override.originalOccurrenceKey === occurrence.occurrenceKey) ||
      (override.originalDate !== null && override.originalDate === occurrence.date))
  );
}

function resolveBase(
  course: Course,
  semester: Semester,
  overrides: readonly CourseOverride[],
  week: number,
  periods: readonly PeriodTime[],
): AcademicCourseOccurrence | null {
  const base = baseOccurrence(course, semester, week, periods);
  if (base === null) return null;
  const override = overrides
    .filter((item) => item.kind !== "MAKEUP" && matchesBase(base, item))
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
    )[0];
  if (override === undefined) return base;
  if (override.kind === "CANCEL") {
    return {
      ...base,
      status: "CANCELLED",
      source: "OVERRIDE",
      appliedOverrideId: override.id,
      appliedOverrideKind: override.kind,
    };
  }
  return applyOverride(base, semester, override);
}

function resolveMakeup(
  course: Course,
  semester: Semester,
  override: CourseOverride,
  periods: readonly PeriodTime[],
): AcademicCourseOccurrence | null {
  if (!override.active || override.kind !== "MAKEUP" || override.courseId !== course.id)
    return null;
  if (override.targetDate === null) return null;
  const weekdayValue = getShanghaiWeekday(override.targetDate);
  if (!isWeekday(weekdayValue)) return null;
  const week = getTeachingWeek(override.targetDate, termConfig(semester));
  if (week === null) return null;
  const hasExplicitTime = override.startTime !== null || override.endTime !== null;
  const baseTime = hasExplicitTime ? null : resolveCourseTime(course, periods);
  const startTime = override.startTime ?? baseTime?.startTime;
  const endTime = override.endTime ?? baseTime?.endTime;
  if (startTime === undefined || endTime === undefined) return null;
  return {
    courseId: course.id,
    semesterId: semester.id,
    date: override.targetDate,
    teachingWeek: week,
    weekday: weekdayValue,
    startPeriod: hasExplicitTime ? null : (override.startPeriod ?? course.startPeriod),
    endPeriod: hasExplicitTime ? null : (override.endPeriod ?? course.endPeriod),
    startTime,
    endTime,
    room: override.classroom ?? course.classroom,
    teacher: override.teacher ?? course.teacher,
    status: "MAKEUP",
    source: "OVERRIDE",
    originalOccurrenceKey: override.originalOccurrenceKey,
    occurrenceKey: `${course.id}:${semester.id}:${override.targetDate}:${startTime}:${override.id}`,
    appliedOverrideId: override.id,
    appliedOverrideKind: override.kind,
  };
}

/** Resolve the effective schedule once for every consumer of academic data. */
export function resolveCourseOccurrences(
  courses: readonly Course[],
  semester: Semester,
  overrides: readonly CourseOverride[] = [],
  range?: OccurrenceDateRange,
  periods: readonly PeriodTime[] = [],
): readonly AcademicCourseOccurrence[] {
  const config = termConfig(semester);
  validateTermConfig(config);
  const resolved = courses.flatMap((course) => {
    const base = course.weeks
      .filter((week) => week <= semester.totalWeeks)
      .flatMap((week) => {
        const occurrence = resolveBase(course, semester, overrides, week, periods);
        return occurrence === null ? [] : [occurrence];
      });
    const makeup = overrides.flatMap((override) => {
      const item = resolveMakeup(course, semester, override, periods);
      return item === null ? [] : [item];
    });
    return [...base, ...makeup];
  });
  return resolved
    .filter((occurrence) => inRange(occurrence.date, range))
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.startTime.localeCompare(right.startTime) ||
        left.occurrenceKey.localeCompare(right.occurrenceKey),
    );
}
