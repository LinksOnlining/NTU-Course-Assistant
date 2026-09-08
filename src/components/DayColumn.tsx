import type { PositionedCourse } from "../core/timetable-layout.ts";
import { CourseCard } from "./CourseCard.tsx";

interface DayColumnProps {
  readonly weekday: number;
  readonly label: string;
  readonly items: readonly PositionedCourse[];
  readonly height: number;
  readonly pxPerMinute: number;
}

export function DayColumn({ weekday, label, items, height, pxPerMinute }: DayColumnProps) {
  return (
    <section
      className="day-column"
      data-testid="day-column"
      data-weekday={weekday}
      aria-label={`${label}课程`}
      style={{ height }}
    >
      {items.map((item) => (
        <CourseCard key={item.course.id} item={item} pxPerMinute={pxPerMinute} />
      ))}
    </section>
  );
}
