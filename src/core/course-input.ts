import type { Course } from "../types/course.ts";
import type {
  CourseInput,
  CourseInputErrors,
  CourseValidationOptions,
  CourseValidationResult,
} from "../types/course-input.ts";
import { durationMinutes, timeToMinutes } from "./time.ts";
import { parseWeeks } from "./weeks.ts";

export const COURSE_NAME_MAX_LENGTH = 80;
export const COURSE_TEACHER_MAX_LENGTH = 100;
export const COURSE_CLASSROOM_MAX_LENGTH = 100;

function optionalText(value: string): string | null {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function isWeekday(value: number): value is Course["weekday"] {
  return Number.isInteger(value) && value >= 1 && value <= 7;
}

/** Convert external values into a Course only after every invariant has passed. */
export function validateCourseInput(
  input: CourseInput,
  id: string,
  options: CourseValidationOptions = {},
): CourseValidationResult {
  const errors: Partial<Record<keyof CourseInput | "form", string>> = {};
  const name = input.name.trim();
  const teacher = optionalText(input.teacher);
  const classroom = optionalText(input.classroom);

  if (name === "") errors.name = "课程名称不能为空";
  else if (name.length > COURSE_NAME_MAX_LENGTH) {
    errors.name = `课程名称不能超过 ${COURSE_NAME_MAX_LENGTH} 个字符`;
  }
  if (teacher !== null && teacher.length > COURSE_TEACHER_MAX_LENGTH) {
    errors.teacher = `教师不能超过 ${COURSE_TEACHER_MAX_LENGTH} 个字符`;
  }
  if (classroom !== null && classroom.length > COURSE_CLASSROOM_MAX_LENGTH) {
    errors.classroom = `教室不能超过 ${COURSE_CLASSROOM_MAX_LENGTH} 个字符`;
  }
  if (!isWeekday(input.weekday)) errors.weekday = "请选择周一至周日";
  if (id.trim() === "") errors.form = "无法生成课程 ID，请重试";

  let validTime = true;
  try {
    timeToMinutes(input.startTime);
  } catch {
    errors.startTime = "请输入有效的开始时间";
    validTime = false;
  }
  try {
    timeToMinutes(input.endTime);
  } catch {
    errors.endTime = "请输入有效的结束时间";
    validTime = false;
  }
  if (validTime) {
    try {
      durationMinutes({ startTime: input.startTime, endTime: input.endTime });
    } catch {
      errors.endTime = "结束时间必须晚于开始时间，且不能跨午夜";
    }
    const axis = options.axis;
    if (
      axis &&
      (timeToMinutes(input.startTime) < timeToMinutes(axis.startTime) ||
        timeToMinutes(input.endTime) > timeToMinutes(axis.endTime))
    ) {
      errors.endTime = `课程时间超出当前显示范围（${axis.startTime}–${axis.endTime}）`;
    }
  }

  let weeks: readonly number[] = [];
  try {
    weeks = parseWeeks(input.weeks);
  } catch (error) {
    errors.weeks = error instanceof RangeError ? error.message : "周数格式不正确";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors: errors as CourseInputErrors };
  }

  const course: Course = {
    id: id.trim(),
    name,
    teacher,
    classroom,
    weekday: input.weekday as Course["weekday"],
    startPeriod: null,
    endPeriod: null,
    startTime: input.startTime,
    endTime: input.endTime,
    weeks,
  };
  return { ok: true, course };
}
