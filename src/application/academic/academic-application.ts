import {
  resolveCourseOccurrences,
  type OccurrenceDateRange,
} from "../../core/course-occurrence.ts";
import {
  loadStoredCourses,
  loadStoredPeriodTimes,
  type LoadCoursesResult,
} from "../../services/course-storage.ts";
import {
  loadAcademicTasks,
  loadCourseOverrides,
  loadExams,
  loadSemesters,
} from "../../services/academic-storage.ts";
import type { AcademicTask } from "../../types/academic-task.ts";
import type { AcademicCourseOccurrence } from "../../types/academic-occurrence.ts";
import type { Course } from "../../types/course.ts";
import type { CourseOverride } from "../../types/course-override.ts";
import type { Exam } from "../../types/exam.ts";
import type { Semester } from "../../types/semester.ts";
import type { PeriodTime } from "../../types/time.ts";
import type { AcademicHubData, AcademicScheduleData } from "./types.ts";

interface AcademicScheduleReader {
  loadCourses(): Promise<LoadCoursesResult>;
  loadPeriodTimes(): Promise<readonly PeriodTime[] | null>;
}

interface AcademicHubReader {
  loadSemesters(): Promise<readonly Semester[]>;
  loadCourseOverrides(semesterId: string): Promise<readonly CourseOverride[]>;
  loadAcademicTasks(semesterId: string): Promise<readonly AcademicTask[]>;
  loadExams(semesterId: string): Promise<readonly Exam[]>;
}

export interface AcademicHubLoadOptions {
  /** Load this semester, including archived semesters selected in Academic Hub. */
  readonly semesterId?: string;
  /** Used only when the database has no semesters, for the existing legacy-term path. */
  readonly fallbackSemesterId?: string;
}

const scheduleReader: AcademicScheduleReader = {
  loadCourses: loadStoredCourses,
  loadPeriodTimes: loadStoredPeriodTimes,
};

const hubReader: AcademicHubReader = {
  loadSemesters,
  loadCourseOverrides,
  loadAcademicTasks,
  loadExams,
};

export function loadAcademicScheduleData(
  reader: AcademicScheduleReader = scheduleReader,
): Promise<AcademicScheduleData> {
  return Promise.all([reader.loadCourses(), reader.loadPeriodTimes()]).then(
    ([courseResult, periodTimes]) => ({
      courses: courseResult.courses,
      periodTimes,
      warnings: courseResult.warnings,
    }),
  );
}

export async function loadAcademicHubData(
  options: AcademicHubLoadOptions = {},
  reader: AcademicHubReader = hubReader,
): Promise<AcademicHubData> {
  const semesters = await reader.loadSemesters();
  const semesterId =
    options.semesterId ??
    semesters.find((semester) => semester.status === "ACTIVE")?.id ??
    (semesters.length === 0 ? options.fallbackSemesterId : undefined);

  if (!semesterId) return { semesters, overrides: [], tasks: [], exams: [] };

  const [overrides, tasks, exams] = await Promise.all([
    reader.loadCourseOverrides(semesterId),
    reader.loadAcademicTasks(semesterId),
    reader.loadExams(semesterId),
  ]);
  return { semesters, overrides, tasks, exams };
}

export function resolveAcademicOccurrences(
  courses: readonly Course[],
  semester: Semester,
  overrides: readonly CourseOverride[] = [],
  range?: OccurrenceDateRange,
  periods: readonly PeriodTime[] = [],
): readonly AcademicCourseOccurrence[] {
  return resolveCourseOccurrences(courses, semester, overrides, range, periods);
}
