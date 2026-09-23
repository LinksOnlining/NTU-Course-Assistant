import type { AcademicCourseOccurrence } from "../../types/academic-occurrence.ts";
import type { Course } from "../../types/course.ts";
import type { TimelineItem, TimelineItemStatus } from "./types.ts";

function projectionBase(occurrence: AcademicCourseOccurrence): string {
  return `academic:${occurrence.courseId}:${occurrence.date}`;
}

function getProjectionId(
  occurrence: AcademicCourseOccurrence,
  duplicateCount: number,
  duplicateIndex: number,
  duplicateIdentityCounts: ReadonlyMap<string, number>,
): { id: string; warning: string | null } {
  const base = projectionBase(occurrence);
  if (duplicateCount === 1) return { id: base, warning: null };

  const identity = occurrence.appliedOverrideId
    ? `override:${occurrence.appliedOverrideId}`
    : occurrence.source === "BASE"
      ? "base"
      : `override:${occurrence.appliedOverrideKind ?? "unknown"}`;
  const hasStableIdentity = occurrence.source === "BASE" || occurrence.appliedOverrideId !== null;
  const needsOrdinal = (duplicateIdentityCounts.get(identity) ?? 0) > 1;
  return {
    id: `${base}:${identity}${needsOrdinal ? `:${duplicateIndex}` : ""}`,
    warning: hasStableIdentity ? null : "同日安排缺少稳定来源标识。",
  };
}

/** Projects canonical, already-resolved occurrences without reinterpreting overrides or times. */
export function projectAcademicOccurrencesToTimelineItems(
  occurrences: readonly AcademicCourseOccurrence[],
  courses: readonly Course[],
): readonly TimelineItem[] {
  const courseNames = new Map(courses.map((course) => [course.id, course.name]));
  const grouped = new Map<string, AcademicCourseOccurrence[]>();
  for (const occurrence of occurrences) {
    const key = `${occurrence.courseId}\u0000${occurrence.date}`;
    grouped.set(key, [...(grouped.get(key) ?? []), occurrence]);
  }

  return occurrences.map((occurrence) => {
    const group = grouped.get(`${occurrence.courseId}\u0000${occurrence.date}`) ?? [occurrence];
    const identityCounts = new Map<string, number>();
    for (const item of group) {
      const itemIdentity = item.appliedOverrideId
        ? `override:${item.appliedOverrideId}`
        : item.source === "BASE"
          ? "base"
          : `override:${item.appliedOverrideKind ?? "unknown"}`;
      identityCounts.set(itemIdentity, (identityCounts.get(itemIdentity) ?? 0) + 1);
    }
    const duplicateIndex = group.indexOf(occurrence);
    const { id, warning } = getProjectionId(
      occurrence,
      group.length,
      duplicateIndex,
      identityCounts,
    );
    const title = courseNames.get(occurrence.courseId);
    const status = occurrence.status.toLowerCase() as TimelineItemStatus;
    const warnings = [...(title ? [] : ["未找到对应课程名称。"]), ...(warning ? [warning] : [])];

    return {
      id,
      sourceType: "academicOccurrence",
      sourceRef: {
        type: "academicOccurrence",
        courseId: occurrence.courseId,
        date: occurrence.date,
      },
      date: occurrence.date,
      startTime: occurrence.startTime,
      endTime: occurrence.endTime,
      title: title ?? "课程",
      location: occurrence.room,
      status,
      editable: false,
      draggable: false,
      resizable: false,
      occupiesTime: occurrence.status !== "CANCELLED",
      warnings,
    };
  });
}
