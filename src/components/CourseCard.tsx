import type { PositionedCourse } from "../core/timetable-layout.ts";
import type { Course } from "../types/course.ts";
import { timeRangeToPeriods } from "../core/period-time.ts";
import type { PeriodTime } from "../types/time.ts";

interface CourseCardProps {
  readonly item: PositionedCourse;
  readonly pxPerMinute: number;
  readonly isUserCourse: boolean;
  readonly onEdit?: (course: Course) => void;
  readonly periods: readonly PeriodTime[];
}

const CARD_TONES = ["mint", "sky", "lilac", "peach", "lemon", "rose"] as const;

function cardTone(id: string): (typeof CARD_TONES)[number] {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return CARD_TONES[hash % CARD_TONES.length];
}

function textDensity(course: Course, durationMinutes: number, laneCount: number) {
  const contentLength =
    course.name.length +
    course.startTime.length +
    course.endTime.length +
    (course.classroom?.length ?? 0) +
    (course.teacher?.length ?? 0);
  if (durationMinutes <= 45) {
    return contentLength > 42 || laneCount > 1 ? "tiny" : "micro";
  }
  if (durationMinutes < 75 && laneCount > 1) return "micro";
  if (durationMinutes < 75 || laneCount > 1) return "small";
  if (durationMinutes <= 105 && contentLength > 32) return contentLength > 58 ? "micro" : "small";
  return "regular";
}

export function CourseCard({ item, pxPerMinute, isUserCourse, onEdit, periods }: CourseCardProps) {
  const { course, lane, laneCount } = item;
  const laneWidth = 100 / laneCount;
  const density =
    item.durationMinutes <= 45 ? "compact" : item.durationMinutes < 75 ? "short" : "full";
  const mappedPeriods =
    course.startPeriod === null || course.endPeriod === null
      ? null
      : timeRangeToPeriods(course, periods);
  const periodLabel =
    mappedPeriods === null
      ? null
      : mappedPeriods.startPeriod === mappedPeriods.endPeriod
        ? `第${mappedPeriods.startPeriod}节`
        : `第${mappedPeriods.startPeriod}–${mappedPeriods.endPeriod}节`;
  const timeLabel = `${periodLabel ? `${periodLabel} · ` : ""}${course.startTime}–${course.endTime}`;
  const title = [
    course.name,
    timeLabel,
    course.classroom ?? "教室待定",
    course.teacher ?? "教师待定",
  ].join(" · ");
  const tone = cardTone(course.id);
  const contentDensity = textDensity(course, item.durationMinutes, laneCount);
  const canEdit = isUserCourse && onEdit !== undefined;
  const openEditor = () => onEdit?.(item.sourceCourse ?? course);
  const statusLabel =
    item.occurrenceStatus === "CANCELLED"
      ? "本次停课"
      : item.occurrenceStatus === "RESCHEDULED"
        ? "调课"
        : item.occurrenceStatus === "MAKEUP"
          ? "补课"
          : null;

  return (
    <article
      className={`course-card course-card--${density}${
        item.occurrenceStatus ? ` course-card--${item.occurrenceStatus.toLowerCase()}` : ""
      }`}
      data-course-id={course.id}
      data-density={density}
      data-duration-minutes={item.durationMinutes}
      data-lane={lane}
      data-lane-count={laneCount}
      data-source={isUserCourse ? "user" : "fixture"}
      data-tone={tone}
      data-text-density={contentDensity}
      style={{
        top: item.offsetMinutes * pxPerMinute,
        height: item.durationMinutes * pxPerMinute,
        left: `calc(${lane * laneWidth}% + 3px)`,
        width: `calc(${laneWidth}% - 6px)`,
      }}
      tabIndex={0}
      title={title}
      aria-label={canEdit ? `${title}。点击或按 Enter 编辑课程。` : title}
      onClick={canEdit ? openEditor : undefined}
      onKeyDown={
        canEdit
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openEditor();
              }
            }
          : undefined
      }
    >
      <strong className="course-name">{course.name}</strong>
      {statusLabel && <span className="course-status">{statusLabel}</span>}
      <span className="course-time">{timeLabel}</span>
      <span className="course-classroom">{course.classroom ?? "教室待定"}</span>
      <span className="course-teacher">{course.teacher ?? "教师待定"}</span>
    </article>
  );
}
