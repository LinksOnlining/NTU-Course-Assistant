import { getCourseDate, generateCourseOccurrences, getTeachingWeek } from "./reminder.ts";
import { timeToMinutes } from "./time.ts";
import type { Course } from "../types/course.ts";
import type { TermConfig } from "../types/reminder.ts";
import type { WidgetCourseItem, WidgetViewModel } from "../types/widget.ts";

const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function courseItem(
  course: Course,
  key: string,
  nowTime: string,
  firstFuture: boolean,
): WidgetCourseItem {
  const now = timeToMinutes(nowTime);
  const start = timeToMinutes(course.startTime);
  const end = timeToMinutes(course.endTime);
  return {
    key,
    name: course.name,
    startTime: course.startTime,
    endTime: course.endTime,
    classroom: course.classroom,
    state: end <= now ? "ended" : start <= now ? "current" : firstFuture ? "next" : "upcoming",
  };
}

export function buildWidgetViewModel(
  courses: readonly Course[],
  termConfig: TermConfig | null,
  now: { readonly date: string; readonly time: string },
): WidgetViewModel {
  if (termConfig === null) return { kind: "missing-term" };
  const teachingWeek = getTeachingWeek(now.date, termConfig);
  if (teachingWeek === null) return { kind: "outside-term" };

  const byId = new Map(courses.map((course) => [course.id, course]));
  const occurrences = generateCourseOccurrences(courses, termConfig).filter(
    (occurrence) => occurrence.week === teachingWeek,
  );
  const toItems = (date: string) => {
    const day = occurrences
      .filter((occurrence) => occurrence.date === date)
      .map((occurrence) => ({ occurrence, course: byId.get(occurrence.courseId)! }))
      .sort((left, right) => left.course.startTime.localeCompare(right.course.startTime));
    let hasFuture = false;
    return day.map(({ occurrence, course }) => {
      const item = courseItem(course, occurrence.key, now.time, !hasFuture);
      if (item.state === "next") hasFuture = true;
      return item;
    });
  };
  const week = WEEKDAY_LABELS.map((label, index) => {
    const date = getCourseDate(termConfig, teachingWeek, index + 1);
    return { weekday: index + 1, label, date, courses: toItems(date) };
  });
  const today = toItems(now.date);
  return {
    kind: "ready",
    date: now.date,
    weekdayLabel: week.find((day) => day.date === now.date)!.label,
    teachingWeek,
    today,
    week,
  };
}
