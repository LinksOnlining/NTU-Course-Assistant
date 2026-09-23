import { useState, type FormEvent } from "react";
import {
  COURSE_CLASSROOM_MAX_LENGTH,
  COURSE_NAME_MAX_LENGTH,
  COURSE_TEACHER_MAX_LENGTH,
  validateCourseInput,
} from "../core/course-input.ts";
import { formatWeeks } from "../core/weeks.ts";
import type { Course } from "../types/course.ts";
import type { CourseInput, CourseInputErrors } from "../types/course-input.ts";
import type { PeriodTime } from "../types/time.ts";
import { resolveCourseTime } from "../core/period-time.ts";
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
  readonly periods: readonly PeriodTime[];
  readonly course?: Course;
  readonly onSave: (course: Course) => Promise<void>;
  readonly onDelete?: (id: string) => Promise<void>;
  readonly onCancel: () => void;
}

function inputFromCourse(course: Course, periods: readonly PeriodTime[]): CourseInput {
  const time = resolveCourseTime(course, periods);
  return {
    name: course.name,
    teacher: course.teacher ?? "",
    classroom: course.classroom ?? "",
    weekday: course.weekday,
    startTime: time.startTime,
    endTime: time.endTime,
    weeks: formatWeeks(course.weeks),
  };
}

export function CourseForm({ axis, periods, course, onSave, onDelete, onCancel }: CourseFormProps) {
  const isEditing = course !== undefined;
  const [input, setInput] = useState<CourseInput>(() =>
    course ? inputFromCourse(course, periods) : INITIAL_INPUT,
  );
  const [errors, setErrors] = useState<CourseInputErrors>({});
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [storageError, setStorageError] = useState("");

  const update = <Field extends keyof CourseInput>(field: Field, value: CourseInput[Field]) => {
    setInput((current) => ({ ...current, [field]: value }));
    setErrors({});
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validateCourseInput(input, course?.id ?? crypto.randomUUID(), { axis });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setIsSaving(true);
    setStorageError("");
    try {
      const currentPeriodTime =
        course && course.startPeriod !== null && course.endPeriod !== null
          ? resolveCourseTime(course, periods)
          : null;
      const unchangedPeriodBasedTime =
        currentPeriodTime !== null &&
        input.startTime === currentPeriodTime.startTime &&
        input.endTime === currentPeriodTime.endTime;
      await onSave(
        unchangedPeriodBasedTime && course
          ? { ...result.course, startPeriod: course.startPeriod, endPeriod: course.endPeriod }
          : result.course,
      );
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "课程保存失败，请稍后重试。");
      setIsSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!onDelete) return;
    setIsSaving(true);
    setStorageError("");
    try {
      await onDelete(id);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "课程删除失败，请稍后重试。");
      setIsSaving(false);
    }
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
            <p className="eyebrow">PHASE 2.2 · 仅保存在内存</p>
            <h2 id="course-form-title">{isEditing ? "编辑课程" : "添加课程"}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onCancel}
            aria-label={`关闭${isEditing ? "编辑" : "添加"}课程表单`}
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
          {storageError && (
            <p className="form-error" role="alert">
              {storageError}
            </p>
          )}
          <p className="axis-note">
            当前时间轴显示 {axis.startTime}–{axis.endTime}，超出范围的课程暂不能保存。
          </p>
          <div className="form-actions">
            {isEditing && course && onDelete && (
              <button
                type="button"
                className="danger-button"
                onClick={() => setIsConfirmingDelete(true)}
                aria-label={`删除 ${course.name}`}
              >
                删除课程
              </button>
            )}
            <span className="form-actions-spacer" />
            <button
              type="button"
              className="secondary-button"
              onClick={onCancel}
              disabled={isSaving}
            >
              取消
            </button>
            <button type="submit" className="primary-button" disabled={isSaving}>
              {isSaving ? "正在保存…" : isEditing ? "保存修改" : "保存课程"}
            </button>
          </div>
          {isConfirmingDelete && course && onDelete && (
            <div className="delete-confirmation" role="alert">
              <p>确定删除“{course.name}”吗？</p>
              <div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setIsConfirmingDelete(false)}
                >
                  保留课程
                </button>
                <button
                  type="button"
                  className="danger-button danger-button--confirm"
                  onClick={() => void remove(course.id)}
                  aria-label={`确认删除 ${course.name}`}
                  disabled={isSaving}
                >
                  确认删除
                </button>
              </div>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
