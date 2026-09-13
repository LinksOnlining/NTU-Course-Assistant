import { timeToMinutes } from "./time.ts";
import type { Course } from "../types/course.ts";
import type {
  CourseOccurrence,
  ReminderConfiguration,
  ReminderDecision,
  ReminderOccurrence,
  ReminderPlan,
  ReminderSettings,
  TermConfig,
} from "../types/reminder.ts";

const DAY_MS = 86_400_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
export const SHANGHAI_TIMEZONE = "Asia/Shanghai" as const;
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { enabled: false, advanceMinutes: 15 };

export function getShanghaiDate(nowMilliseconds: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(nowMilliseconds);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function getShanghaiWeekday(date: string): number {
  return ((dayNumber(date) + 3) % 7) + 1;
}

export function getShanghaiTime(nowMilliseconds: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SHANGHAI_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(nowMilliseconds);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("hour")}:${value("minute")}`;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

function daysFromCivil(year: number, month: number, day: number): number {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  return (
    era * 146_097 +
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear -
    719_468
  );
}

function civilFromDays(value: number): readonly [number, number, number] {
  const shifted = value + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  return [
    era * 400 + yearOfEra + (monthPrime >= 10 ? 1 : 0),
    monthPrime + (monthPrime < 10 ? 3 : -9),
    dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1,
  ];
}

function dayNumber(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError("日期必须为 YYYY-MM-DD");
  const [year, month, day] = date.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month))
    throw new RangeError("日期不存在");
  return daysFromCivil(year, month, day);
}

function formatDate(day: number): string {
  const [year, month, date] = civilFromDays(day);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

function formatShanghaiInstant(milliseconds: number): string {
  const local = milliseconds + SHANGHAI_OFFSET_MS;
  const day = Math.floor(local / DAY_MS);
  const minutes = Math.floor((local - day * DAY_MS) / 60_000);
  return `${formatDate(day)}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00+08:00`;
}

function instant(date: string, time: string): number {
  return dayNumber(date) * DAY_MS + timeToMinutes(time) * 60_000 - SHANGHAI_OFFSET_MS;
}

function reminderInstant(value: string): number {
  const matched = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):00\+08:00$/.exec(value);
  if (matched === null) throw new RangeError("提醒时间格式无效");
  return instant(matched[1], matched[2]);
}

export function validateTermConfig(config: TermConfig): TermConfig {
  const firstDay = dayNumber(config.firstWeekMonday);
  if ((firstDay + 4) % 7 !== 1) throw new RangeError("第 1 教学周日期必须是星期一");
  if (!Number.isInteger(config.totalWeeks) || config.totalWeeks < 1 || config.totalWeeks > 30)
    throw new RangeError("总教学周数必须是 1–30 的整数");
  if (config.timezone !== SHANGHAI_TIMEZONE) throw new RangeError("时区必须为 Asia/Shanghai");
  return config;
}

export function validateReminderSettings(settings: ReminderSettings): ReminderSettings {
  if (typeof settings.enabled !== "boolean") throw new RangeError("提醒开关无效");
  if (
    !Number.isInteger(settings.advanceMinutes) ||
    settings.advanceMinutes < 0 ||
    settings.advanceMinutes > 180
  )
    throw new RangeError("提前提醒时间必须是 0–180 分钟的整数");
  return settings;
}

export function getTeachingWeek(date: string, config: TermConfig): number | null {
  const first = dayNumber(validateTermConfig(config).firstWeekMonday);
  const difference = dayNumber(date) - first;
  const week = Math.floor(difference / 7) + 1;
  return difference >= 0 && week <= config.totalWeeks ? week : null;
}

export function getCourseDate(config: TermConfig, week: number, weekday: number): string {
  validateTermConfig(config);
  if (!Number.isInteger(week) || week < 1 || week > config.totalWeeks)
    throw new RangeError("教学周超出学期范围");
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7)
    throw new RangeError("星期必须在 1–7 之间");
  return formatDate(dayNumber(config.firstWeekMonday) + (week - 1) * 7 + weekday - 1);
}

export function shouldCourseOccur(course: Course, week: number): boolean {
  return course.weeks.includes(week);
}

export function createCourseOccurrence(
  course: Course,
  week: number,
  config: TermConfig,
): CourseOccurrence {
  if (!shouldCourseOccur(course, week)) throw new RangeError("课程不在该教学周上课");
  const date = getCourseDate(config, week, course.weekday);
  return {
    courseId: course.id,
    key: `${course.id}:${date}:${course.startTime}`,
    week,
    weekday: course.weekday,
    date,
    startDateTime: formatShanghaiInstant(instant(date, course.startTime)),
    endDateTime: formatShanghaiInstant(instant(date, course.endTime)),
  };
}

export function generateCourseOccurrences(
  courses: readonly Course[],
  config: TermConfig,
): readonly CourseOccurrence[] {
  validateTermConfig(config);
  return courses.flatMap((course) =>
    course.weeks
      .filter((week) => week <= config.totalWeeks)
      .map((week) => createCourseOccurrence(course, week, config)),
  );
}

export function getReminderOccurrence(
  occurrence: CourseOccurrence,
  settings: ReminderSettings,
): ReminderOccurrence {
  validateReminderSettings(settings);
  return {
    courseId: occurrence.courseId,
    courseOccurrenceKey: occurrence.key,
    triggerAt: formatShanghaiInstant(
      reminderInstant(occurrence.startDateTime) - settings.advanceMinutes * 60_000,
    ),
    courseStartAt: occurrence.startDateTime,
  };
}

export function buildReminderPlans(
  courses: readonly Course[],
  configuration: ReminderConfiguration,
): readonly ReminderPlan[] {
  if (!configuration.reminderSettings.enabled || configuration.termConfig === null) return [];
  validateReminderSettings(configuration.reminderSettings);
  return courses.flatMap((course) =>
    course.weeks.map((week) => {
      const occurrence = createCourseOccurrence(course, week, configuration.termConfig!);
      const reminder = getReminderOccurrence(occurrence, configuration.reminderSettings);
      return {
        occurrenceKey: reminder.courseOccurrenceKey,
        triggerAtMilliseconds: reminderInstant(reminder.triggerAt),
        courseStartMilliseconds: reminderInstant(reminder.courseStartAt),
        notification: {
          courseName: course.name,
          startTime: course.startTime,
          classroom: course.classroom,
        },
      };
    }),
  );
}

export function excludeHandledReminderPlans(
  plans: readonly ReminderPlan[],
  handledOccurrenceKeys: ReadonlySet<string>,
): readonly ReminderPlan[] {
  return plans.filter((plan) => !handledOccurrenceKeys.has(plan.occurrenceKey));
}

export function findNextReminder(
  nowMilliseconds: number,
  courses: readonly Course[],
  configuration: ReminderConfiguration,
): ReminderDecision {
  const { termConfig, reminderSettings } = configuration;
  if (!reminderSettings.enabled || termConfig === null) return { kind: "none" };
  validateReminderSettings(reminderSettings);
  const reminders = generateCourseOccurrences(courses, termConfig)
    .map((item) => getReminderOccurrence(item, reminderSettings))
    .sort((a, b) => reminderInstant(a.triggerAt) - reminderInstant(b.triggerAt));
  const catchUp = reminders.find(
    (item) =>
      reminderInstant(item.triggerAt) < nowMilliseconds &&
      nowMilliseconds < reminderInstant(item.courseStartAt),
  );
  if (catchUp) return { kind: "catch-up", reminder: catchUp };
  const future = reminders.find((item) => reminderInstant(item.triggerAt) >= nowMilliseconds);
  return future ? { kind: "future", reminder: future } : { kind: "none" };
}

export function validateTermConfigAgainstCourses(
  courses: readonly Course[],
  config: TermConfig,
): readonly string[] {
  validateTermConfig(config);
  return courses.some((course) => course.weeks.some((week) => week > config.totalWeeks))
    ? ["部分课程周数超出当前总教学周数，超出部分不会生成提醒。"]
    : [];
}
