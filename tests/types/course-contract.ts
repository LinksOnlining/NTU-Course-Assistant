import type { Course } from "../../src/types/course.ts";

const course: Course = {
  id: "type-test",
  name: "类型测试",
  teacher: null,
  classroom: null,
  weekday: 1,
  startPeriod: 1,
  endPeriod: 2,
  startTime: "08:00",
  endTime: "09:35",
  weeks: [1, 3],
};
// @ts-expect-error Weekdays are 1–7, not arbitrary numbers.
course.weekday = 8;
// @ts-expect-error UI geometry is not a Course field.
export const withUi: Course = { ...course, top: 60 };
// @ts-expect-error Teachers must be text or null.
export const invalidTeacher: Course = { ...course, teacher: 123 };
// @ts-expect-error Weekdays are 1–7.
export const invalidDay: Course = { ...course, weekday: 8 };
// @ts-expect-error Week numbers are numeric.
export const invalidWeeks: Course = { ...course, weeks: ["1"] };
// @ts-expect-error Callers cannot mutate the recurrence array.
course.weeks.push(5);
// @ts-expect-error Identity and recurrence fields are required.
export const incomplete: Course = { name: "missing fields" };
