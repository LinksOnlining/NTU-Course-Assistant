import type { AcademicCourseOccurrence } from "../types/academic-occurrence.ts";
import type { Course } from "../types/course.ts";
import type { CourseOverride } from "../types/course-override.ts";

export interface CourseMeetingSummary {
  readonly weekday: number;
  readonly startPeriod: number | null;
  readonly endPeriod: number | null;
  readonly startTime: string;
  readonly endTime: string;
  readonly room: string | null;
}

export interface CourseChangeSummary {
  readonly course: Course;
  readonly occurrences: readonly AcademicCourseOccurrence[];
  readonly meetings: readonly CourseMeetingSummary[];
  readonly changedCount: number;
}

/** Group canonical occurrences by Course so the change UI is course-first. */
export function summarizeCourseChanges(
  courses: readonly Course[],
  occurrences: readonly AcademicCourseOccurrence[],
  overrides: readonly CourseOverride[],
): readonly CourseChangeSummary[] {
  return courses
    .map((course) => {
      const courseOccurrences = occurrences
        .filter((item) => item.courseId === course.id)
        .sort(
          (left, right) =>
            left.date.localeCompare(right.date) ||
            left.startTime.localeCompare(right.startTime) ||
            left.occurrenceKey.localeCompare(right.occurrenceKey),
        );
      const meetings = new Map<string, CourseMeetingSummary>();
      for (const item of courseOccurrences) {
        const key = [
          item.weekday,
          item.startPeriod ?? "",
          item.endPeriod ?? "",
          item.startTime,
          item.endTime,
          item.room ?? "",
        ].join("|");
        if (!meetings.has(key)) {
          meetings.set(key, {
            weekday: item.weekday,
            startPeriod: item.startPeriod,
            endPeriod: item.endPeriod,
            startTime: item.startTime,
            endTime: item.endTime,
            room: item.room,
          });
        }
      }
      return {
        course,
        occurrences: courseOccurrences,
        meetings: [...meetings.values()],
        changedCount: overrides.filter((item) => item.active && item.courseId === course.id).length,
      };
    })
    .sort((left, right) => left.course.name.localeCompare(right.course.name, "zh-CN"));
}
