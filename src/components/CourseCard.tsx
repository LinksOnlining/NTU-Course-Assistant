import type { PositionedCourse } from "../core/timetable-layout.ts";

interface CourseCardProps {
  readonly item: PositionedCourse;
  readonly pxPerMinute: number;
}

export function CourseCard({ item, pxPerMinute }: CourseCardProps) {
  const { course, lane, laneCount } = item;
  const laneWidth = 100 / laneCount;
  const title = [
    course.name,
    `${course.startTime}–${course.endTime}`,
    course.classroom ?? "教室待定",
    course.teacher ?? "教师待定",
  ].join(" · ");

  return (
    <article
      className="course-card"
      data-course-id={course.id}
      data-lane={lane}
      data-lane-count={laneCount}
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
      <strong className="course-name">{course.name}</strong>
      <span className="course-time">
        {course.startTime}–{course.endTime}
      </span>
      <span className="course-classroom">{course.classroom ?? "教室待定"}</span>
      <span className="course-teacher">{course.teacher ?? "教师待定"}</span>
    </article>
  );
}
