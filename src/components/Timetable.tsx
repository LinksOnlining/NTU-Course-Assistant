import type { CSSProperties, RefObject } from "react";
import { durationMinutes, offsetMinutes } from "../core/time.ts";
import { layoutCourseOccurrences, layoutCourses } from "../core/timetable-layout.ts";
import type { Course } from "../types/course.ts";
import type { AcademicCourseOccurrence } from "../types/academic-occurrence.ts";
import type { PeriodTime, TimeRange } from "../types/time.ts";
import { DayColumn } from "./DayColumn.tsx";
import { TimeAxis } from "./TimeAxis.tsx";

const DAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;

interface TimetableProps {
  readonly courses: readonly Course[];
  readonly occurrences?: readonly AcademicCourseOccurrence[];
  readonly userCourseIds?: ReadonlySet<string>;
  readonly currentWeek: number;
  readonly axis: TimeRange;
  readonly pxPerMinute: number;
  readonly periods: readonly PeriodTime[];
  readonly visibleWeekdays?: readonly number[];
  readonly currentWeekday?: number | null;
  readonly nowMinutes?: number | null;
  readonly nowTimeLabel?: string;
  readonly scrollRef?: RefObject<HTMLDivElement | null>;
  readonly onEditCourse?: (course: Course) => void;
}

export function Timetable({
  courses,
  occurrences,
  userCourseIds = new Set(),
  currentWeek,
  axis,
  pxPerMinute,
  periods,
  visibleWeekdays = [1, 2, 3, 4, 5, 6, 7],
  currentWeekday = null,
  nowMinutes = null,
  nowTimeLabel = "",
  scrollRef,
  onEditCourse,
}: TimetableProps) {
  if (!Number.isFinite(pxPerMinute) || pxPerMinute <= 0) {
    throw new RangeError("每分钟像素比例必须大于零");
  }
  const days = occurrences
    ? layoutCourseOccurrences(courses, occurrences, currentWeek, axis)
    : layoutCourses(courses, currentWeek, axis);
  const timelineHeight = durationMinutes(axis) * pxPerMinute;
  const gridStyle = { "--hour-height": `${60 * pxPerMinute}px` } as CSSProperties;

  const visibleDays = visibleWeekdays.map((weekday) => ({ weekday, label: DAYS[weekday - 1] }));
  const currentOffset =
    nowMinutes === null
      ? null
      : (nowMinutes - offsetMinutes(axis.startTime, "00:00")) * pxPerMinute;
  return (
    <div className="timetable-scroll" data-testid="timetable-scroll" ref={scrollRef}>
      <div
        className="timetable-grid"
        data-testid="timetable-grid"
        style={{
          ...gridStyle,
          gridTemplateColumns: `124px repeat(${visibleDays.length}, minmax(154px, 1fr))`,
          minWidth: `${124 + visibleDays.length * 154}px`,
        }}
      >
        <div className="week-corner" aria-hidden="true">
          节次 / 时间
        </div>
        {visibleDays.map(({ weekday, label }) => (
          <div
            className={`day-header${weekday === currentWeekday ? " day-header--today" : ""}`}
            key={label}
          >
            {label}
          </div>
        ))}
        <TimeAxis axis={axis} height={timelineHeight} pxPerMinute={pxPerMinute} periods={periods} />
        {visibleDays.map(({ weekday, label }) => (
          <DayColumn
            key={label}
            weekday={weekday}
            label={label}
            items={days[weekday - 1]}
            height={timelineHeight}
            pxPerMinute={pxPerMinute}
            userCourseIds={userCourseIds}
            periods={periods}
            onEditCourse={onEditCourse}
            currentTimeOffset={
              weekday === currentWeekday &&
              currentOffset !== null &&
              currentOffset >= 0 &&
              currentOffset <= timelineHeight
                ? currentOffset
                : null
            }
            currentTimeLabel={nowTimeLabel}
          />
        ))}
      </div>
    </div>
  );
}
