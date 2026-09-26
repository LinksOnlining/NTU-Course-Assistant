import {
  loadAcademicHubData,
  loadAcademicScheduleData,
  loadAcademicTermConfig,
  resolveAcademicOccurrences,
} from "./academic-application.ts";
import type { Semester } from "../../types/semester.ts";

const LEGACY_SEMESTER_ID = "legacy-active-semester";

export async function readAcademicAiUpcoming(input: {
  readonly from: string;
  readonly to: string;
  readonly limit: number;
}) {
  const termConfig = await loadAcademicTermConfig();
  const [schedule, hub] = await Promise.all([
    loadAcademicScheduleData(),
    loadAcademicHubData({ fallbackSemesterId: termConfig ? LEGACY_SEMESTER_ID : undefined }),
  ]);
  const semester =
    hub.semesters.find((item) => item.status === "ACTIVE") ??
    (hub.semesters.length === 0 && termConfig ? legacySemester(termConfig) : null);
  const courseNames = new Map(schedule.courses.map((course) => [course.id, course.name]));
  const courses = semester
    ? [
        ...resolveAcademicOccurrences(
          schedule.courses,
          semester,
          hub.overrides,
          { from: input.from, to: input.to },
          schedule.periodTimes ?? [],
        ),
      ]
        .sort(
          (left, right) =>
            left.date.localeCompare(right.date) ||
            left.startTime.localeCompare(right.startTime) ||
            left.courseId.localeCompare(right.courseId),
        )
        .slice(0, input.limit)
        .map((item) => ({
          title: safeText(courseNames.get(item.courseId) ?? "课程"),
          date: item.date,
          teachingWeek: item.teachingWeek,
          start: item.startTime,
          end: item.endTime,
          room: item.room === null ? null : safeText(item.room),
          teacher: item.teacher === null ? null : safeText(item.teacher),
          status: item.status,
        }))
    : [];
  const exams = hub.exams
    .filter((item) => item.status === "SCHEDULED" && inDateRange(item.startsAt.slice(0, 10), input))
    .sort(
      (left, right) =>
        left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id),
    )
    .slice(0, input.limit)
    .map((item) => ({
      title: safeText(item.title),
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      location: item.location === null ? null : safeText(item.location),
      status: item.status,
    }));
  const deadlines = hub.tasks
    .filter((item) => item.status !== "COMPLETED" && inDateRange(item.dueAt.slice(0, 10), input))
    .sort((left, right) => left.dueAt.localeCompare(right.dueAt) || left.id.localeCompare(right.id))
    .slice(0, input.limit)
    .map((item) => ({
      title: safeText(item.title),
      dueAt: item.dueAt,
      priority: item.priority,
      status: item.status,
      type: item.type,
    }));
  return Object.freeze({
    courses: Object.freeze(courses),
    exams: Object.freeze(exams),
    deadlines: Object.freeze(deadlines),
  });
}

function legacySemester(
  config: NonNullable<Awaited<ReturnType<typeof loadAcademicTermConfig>>>,
): Semester {
  return {
    id: LEGACY_SEMESTER_ID,
    name: "当前学期",
    firstWeekMonday: config.firstWeekMonday,
    totalWeeks: config.totalWeeks,
    timezone: config.timezone,
    status: "ACTIVE",
    createdAt: "",
    updatedAt: "",
  };
}

function inDateRange(date: string, input: { readonly from: string; readonly to: string }): boolean {
  return date >= input.from && date <= input.to;
}

function safeText(value: string): string {
  return Array.from(value).slice(0, 180).join("");
}
