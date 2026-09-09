import type { CSSProperties } from "react";
import { durationMinutes } from "../core/time.ts";
import { layoutCourses } from "../core/timetable-layout.ts";
import type { Course } from "../types/course.ts";
import type { TimeRange } from "../types/time.ts";
import { DayColumn } from "./DayColumn.tsx";
import { TimeAxis } from "./TimeAxis.tsx";

const DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;

interface TimetableProps {
  readonly courses: readonly Course[];
  readonly userCourseIds?: ReadonlySet<string>;
  readonly currentWeek: number;
  readonly axis: TimeRange;
  readonly pxPerMinute: number;
}

export function Timetable({
  courses,
  userCourseIds = new Set(),
  currentWeek,
  axis,
  pxPerMinute,
}: TimetableProps) {
  if (!Number.isFinite(pxPerMinute) || pxPerMinute <= 0) {
    throw new RangeError("每分钟像素比例必须大于零");
  }
  const days = layoutCourses(courses, currentWeek, axis);
  const timelineHeight = durationMinutes(axis) * pxPerMinute;
  const gridStyle = { "--hour-height": `${60 * pxPerMinute}px` } as CSSProperties;

  return (
    <div className="timetable-scroll" data-testid="timetable-scroll">
      <div className="timetable-grid" data-testid="timetable-grid" style={gridStyle}>
        <div className="week-corner" aria-hidden="true">
          时间
        </div>
        {DAYS.map((day) => (
          <div className="day-header" key={day}>
            {day}
          </div>
        ))}
        <TimeAxis axis={axis} height={timelineHeight} pxPerMinute={pxPerMinute} />
        {DAYS.map((day, index) => (
          <DayColumn
            key={day}
            weekday={index + 1}
            label={day}
            items={days[index]}
            height={timelineHeight}
            pxPerMinute={pxPerMinute}
            userCourseIds={userCourseIds}
          />
        ))}
      </div>
    </div>
  );
}
