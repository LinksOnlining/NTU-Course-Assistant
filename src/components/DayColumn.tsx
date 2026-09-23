import type { PositionedCourse } from "../core/timetable-layout.ts";
import type { Course } from "../types/course.ts";
import { CourseCard } from "./CourseCard.tsx";

interface DayColumnProps {
  readonly weekday: number;
  readonly label: string;
  readonly items: readonly PositionedCourse[];
  readonly height: number;
  readonly pxPerMinute: number;
  readonly userCourseIds: ReadonlySet<string>;
  readonly onEditCourse?: (course: Course) => void;
  readonly currentTimeOffset: number | null;
  readonly currentTimeLabel: string;
}

export function DayColumn({
  weekday,
  label,
  items,
  height,
  pxPerMinute,
  userCourseIds,
  onEditCourse,
  currentTimeOffset,
  currentTimeLabel,
}: DayColumnProps) {
  return (
    <section
      className="day-column"
      data-testid="day-column"
      data-weekday={weekday}
      aria-label={`${label}课程`}
      style={{ height }}
    >
      {items.map((item) => (
        <CourseCard
          key={item.course.id}
          item={item}
          pxPerMinute={pxPerMinute}
          isUserCourse={userCourseIds.has(item.sourceCourseId ?? item.course.id)}
          onEdit={onEditCourse}
        />
      ))}
      {currentTimeOffset !== null && (
        <div className="current-time-line" style={{ top: currentTimeOffset }} aria-label="当前时间">
          <span>● {currentTimeLabel}</span>
        </div>
      )}
    </section>
  );
}
