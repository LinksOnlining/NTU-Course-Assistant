import type { PositionedCourse } from "../core/timetable-layout.ts";
import { timeToMinutes } from "../core/time.ts";
import type { Course } from "../types/course.ts";
import type { PeriodTime, TimeRange } from "../types/time.ts";
import { CourseCard } from "./CourseCard.tsx";

interface DayColumnProps {
  readonly weekday: number;
  readonly label: string;
  readonly items: readonly PositionedCourse[];
  readonly height: number;
  readonly pxPerMinute: number;
  readonly axis: TimeRange;
  readonly userCourseIds: ReadonlySet<string>;
  readonly onEditCourse?: (course: Course) => void;
  readonly periods: readonly PeriodTime[];
}

export function DayColumn({
  weekday,
  label,
  items,
  height,
  pxPerMinute,
  axis,
  userCourseIds,
  onEditCourse,
  periods,
}: DayColumnProps) {
  const axisStart = timeToMinutes(axis.startTime);

  return (
    <section
      className="day-column"
      data-testid="day-column"
      data-weekday={weekday}
      aria-label={`${label}课程`}
      style={{ height }}
    >
      {periods.map((period) => {
        const top = (timeToMinutes(period.startTime) - axisStart) * pxPerMinute;
        if (top < 0 || top > height) return null;
        return (
          <span
            aria-hidden="true"
            className="period-guide"
            data-period-guide={period.period}
            key={period.period}
            style={{ top }}
          />
        );
      })}
      {items.map((item) => (
        <CourseCard
          key={item.course.id}
          item={item}
          pxPerMinute={pxPerMinute}
          isUserCourse={userCourseIds.has(item.course.id)}
          periods={periods}
          onEdit={onEditCourse}
        />
      ))}
    </section>
  );
}
