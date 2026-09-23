import type { AcademicTask } from "../../types/academic-task.ts";
import type { AcademicCourseOccurrence } from "../../types/academic-occurrence.ts";
import type { Course } from "../../types/course.ts";
import type { CourseOverride } from "../../types/course-override.ts";
import type { Exam } from "../../types/exam.ts";
import type { Semester } from "../../types/semester.ts";
import type { PeriodTime } from "../../types/time.ts";

export interface AcademicScheduleData {
  readonly courses: readonly Course[];
  /** `null` means the user has not saved a real schedule yet. */
  readonly periodTimes: readonly PeriodTime[] | null;
  readonly warnings: readonly string[];
}

export interface AcademicHubData {
  readonly semesters: readonly Semester[];
  readonly overrides: readonly CourseOverride[];
  readonly tasks: readonly AcademicTask[];
  readonly exams: readonly Exam[];
}

export type { AcademicCourseOccurrence };
