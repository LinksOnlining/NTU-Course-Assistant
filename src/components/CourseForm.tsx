import { useState, type FormEvent } from "react";
import {
  COURSE_CLASSROOM_MAX_LENGTH,
  COURSE_NAME_MAX_LENGTH,
  COURSE_TEACHER_MAX_LENGTH,
  validateCourseInput,
} from "../core/course-input.ts";
import type { Course } from "../types/course.ts";
import type { CourseInput, CourseInputErrors } from "../types/course-input.ts";
import type { TimeRange } from "../types/time.ts";
import { CourseFormField } from "./CourseFormField.tsx";

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;
const INITIAL_INPUT: CourseInput = {
  name: "",
  teacher: "",
  classroom: "",
  weekday: 1,
  startTime: "",
  endTime: "",
  weeks: "",
};

interface CourseFormProps {
  readonly axis: TimeRange;
  readonly onAdd: (course: Course) => void;
  readonly onCancel: () => void;
}

export function CourseForm({ axis, onAdd, onCancel }: CourseFormProps) {
  const [input, setInput] = useState<CourseInput>(INITIAL_INPUT);
  const [errors, setErrors] = useState<CourseInputErrors>({});

  const update = <Field extends keyof CourseInput>(field: Field, value: CourseInput[Field]) => {
    setInput((current) => ({ ...current, [field]: value }));
    setErrors({});
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validateCourseInput(input, crypto.randomUUID(), { axis });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    onAdd(result.course);
  };

  return (
    <div className="course-form-backdrop">
      <section
        className="course-form-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="course-form-title"
      >
        <div className="course-form-heading">
          <div>
            <p className="eyebrow">PHASE 2.1 · 仅保存在内存</p>
            <h2 id="course-form-title">添加课程</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onCancel}
            aria-label="关闭添加课程表单"
          >
            ×
          </button>
        </div>
        <form className="course-form" onSubmit={submit} noValidate>
          <CourseFormField id="course-name" label="课程名称" error={errors.name}>
            <input
              id="course-name"
              value={input.name}
              maxLength={COURSE_NAME_MAX_LENGTH}
              onChange={(event) => update("name", event.target.value)}
              aria-describedby="course-name-message"
              aria-invalid={Boolean(errors.name)}
              autoFocus
            />
          </CourseFormField>
          <div className="form-row">
            <CourseFormField id="course-teacher" label="教师（可选）" error={errors.teacher}>
              <input
                id="course-teacher"
                value={input.teacher}
                maxLength={COURSE_TEACHER_MAX_LENGTH}
                onChange={(event) => update("teacher", event.target.value)}
                aria-describedby="course-teacher-message"
                aria-invalid={Boolean(errors.teacher)}
              />
            </CourseFormField>
            <CourseFormField id="course-classroom" label="教室（可选）" error={errors.classroom}>
              <input
                id="course-classroom"
                value={input.classroom}
                maxLength={COURSE_CLASSROOM_MAX_LENGTH}
                onChange={(event) => update("classroom", event.target.value)}
                aria-describedby="course-classroom-message"
                aria-invalid={Boolean(errors.classroom)}
              />
            </CourseFormField>
          </div>
          <CourseFormField id="course-weekday" label="星期" error={errors.weekday}>
            <select
              id="course-weekday"
              value={input.weekday}
              onChange={(event) => update("weekday", Number(event.target.value))}
              aria-describedby="course-weekday-message"
              aria-invalid={Boolean(errors.weekday)}
            >
              {WEEKDAYS.map((day, index) => (
                <option value={index + 1} key={day}>
                  {day}
                </option>
              ))}
            </select>
          </CourseFormField>
          <div className="form-row">
            <CourseFormField id="course-start-time" label="开始时间" error={errors.startTime}>
              <input
                id="course-start-time"
                type="time"
                value={input.startTime}
                onChange={(event) => update("startTime", event.target.value)}
                aria-describedby="course-start-time-message"
                aria-invalid={Boolean(errors.startTime)}
              />
            </CourseFormField>
            <CourseFormField id="course-end-time" label="结束时间" error={errors.endTime}>
              <input
                id="course-end-time"
                type="time"
                value={input.endTime}
                onChange={(event) => update("endTime", event.target.value)}
                aria-describedby="course-end-time-message"
                aria-invalid={Boolean(errors.endTime)}
              />
            </CourseFormField>
          </div>
          <CourseFormField
            id="course-weeks"
            label="上课周数"
            error={errors.weeks}
            hint="例如：1-16、7,15 或 1-4,7,10-12（最多 30 周）"
          >
            <input
              id="course-weeks"
              value={input.weeks}
              placeholder="1-16"
              onChange={(event) => update("weeks", event.target.value)}
              aria-describedby="course-weeks-message"
              aria-invalid={Boolean(errors.weeks)}
            />
          </CourseFormField>
          {errors.form && (
            <p className="form-error" role="alert">
              {errors.form}
            </p>
          )}
          <p className="axis-note">
            当前时间轴显示 {axis.startTime}–{axis.endTime}，超出范围的课程暂不能保存。
          </p>
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={onCancel}>
              取消
            </button>
            <button type="submit" className="primary-button">
              保存课程
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
