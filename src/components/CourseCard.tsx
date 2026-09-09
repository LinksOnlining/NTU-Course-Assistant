import type { PositionedCourse } from "../core/timetable-layout.ts";
import type { Course } from "../types/course.ts";

interface CourseCardProps {
  readonly item: PositionedCourse;
  readonly pxPerMinute: number;
  readonly isUserCourse: boolean;
  readonly onEdit?: (course: Course) => void;
}

export function CourseCard({ item, pxPerMinute, isUserCourse, onEdit }: CourseCardProps) {
  const { course, lane, laneCount } = item;
  const laneWidth = 100 / laneCount;
  const density =
    item.durationMinutes <= 45 ? "compact" : item.durationMinutes < 75 ? "short" : "full";
  const title = [
    isUserCourse ? "用户添加" : "测试数据",
    course.name,
    `${course.startTime}–${course.endTime}`,
    course.classroom ?? "教室待定",
    course.teacher ?? "教师待定",
  ].join(" · ");

  return (
    <article
      className={`course-card course-card--${density}`}
      data-course-id={course.id}
      data-density={density}
      data-duration-minutes={item.durationMinutes}
      data-lane={lane}
      data-lane-count={laneCount}
      data-source={isUserCourse ? "user" : "fixture"}
      style={{
        top: item.offsetMinutes * pxPerMinute,
        height: item.durationMinutes * pxPerMinute,
        left: `calc(${lane * laneWidth}% + 3px)`,
        width: `calc(${laneWidth}% - 6px)`,
      }}
      tabIndex={0}
      title={title}
      aria-label={title}
    >
      {isUserCourse && <span className="course-origin">用户添加</span>}
      {isUserCourse && onEdit && (
        <button
          type="button"
          className="course-edit-button"
          onClick={() => onEdit(course)}
          aria-label={`编辑 ${course.name}`}
        >
          编辑
        </button>
      )}
      <strong className="course-name">{course.name}</strong>
      <span className="course-time">
        {course.startTime}–{course.endTime}
      </span>
      <span className="course-classroom">{course.classroom ?? "教室待定"}</span>
      <span className="course-teacher">{course.teacher ?? "教师待定"}</span>
    </article>
  );
}
