import { timeToDayMinute, TIMELINE_DAY_MINUTES } from "./timeline-layout.ts";
import type { TimelineItem } from "./types.ts";

export const PLANNER_POINTER_SNAP_MINUTES = 5;
export const PLANNER_POINTER_MIN_DURATION = 5;

export interface MinuteInterval {
  readonly startMinute: number;
  readonly endMinute: number;
}

export type ResizeEdge = "start" | "end";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function snap(value: number): number {
  return Math.round(value / PLANNER_POINTER_SNAP_MINUTES) * PLANNER_POINTER_SNAP_MINUTES;
}

export function formatTimelineMinute(minute: number): string {
  const safe = clamp(Math.round(minute), 0, TIMELINE_DAY_MINUTES);
  if (safe === TIMELINE_DAY_MINUTES) return "24:00";
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function moveTimelineInterval(
  startMinute: number,
  endMinute: number,
  deltaPixels: number,
): MinuteInterval {
  const duration = clamp(
    endMinute - startMinute,
    PLANNER_POINTER_MIN_DURATION,
    TIMELINE_DAY_MINUTES,
  );
  const snappedDelta = snap(deltaPixels);
  const start = clamp(startMinute + snappedDelta, 0, TIMELINE_DAY_MINUTES - duration);
  return { startMinute: start, endMinute: start + duration };
}

export function resizeTimelineInterval(
  startMinute: number,
  endMinute: number,
  edge: ResizeEdge,
  deltaPixels: number,
): MinuteInterval {
  if (edge === "start") {
    const start = clamp(
      snap(startMinute + deltaPixels),
      0,
      endMinute - PLANNER_POINTER_MIN_DURATION,
    );
    return { startMinute: start, endMinute };
  }
  const end = clamp(
    snap(endMinute + deltaPixels),
    startMinute + PLANNER_POINTER_MIN_DURATION,
    TIMELINE_DAY_MINUTES,
  );
  return { startMinute, endMinute: end };
}

function sourceKey(item: TimelineItem): string {
  const reference = item.sourceRef;
  return reference.type === "academicOccurrence"
    ? `${reference.type}:${reference.courseId}:${reference.date}`
    : `${reference.type}:${reference.id}`;
}

export function effectiveOccupancy(item: TimelineItem): MinuteInterval | null {
  if (!item.occupiesTime || item.status === "cancelled") return null;
  const start = timeToDayMinute(item.startTime);
  const end = timeToDayMinute(item.endTime, true);
  if (start === null || end === null || end <= start) return null;
  return {
    startMinute: clamp(start - (item.bufferBeforeMinutes ?? 0), 0, TIMELINE_DAY_MINUTES),
    endMinute: clamp(end + (item.bufferAfterMinutes ?? 0), 0, TIMELINE_DAY_MINUTES),
  };
}

function overlaps(left: MinuteInterval, right: MinuteInterval): boolean {
  return left.startMinute < right.endMinute && right.startMinute < left.endMinute;
}

/** Returns actual conflicting objects; adjacent effective intervals do not conflict. */
export function findTimelineConflicts(
  items: readonly TimelineItem[],
  proposed: TimelineItem,
): readonly TimelineItem[] {
  const proposedOccupancy = effectiveOccupancy(proposed);
  if (!proposedOccupancy) return [];
  const proposedKey = sourceKey(proposed);
  return items.filter((item) => {
    if (item.date !== proposed.date || sourceKey(item) === proposedKey) return false;
    const occupancy = effectiveOccupancy(item);
    return occupancy !== null && overlaps(proposedOccupancy, occupancy);
  });
}

/** Computes sorted free intervals after merging overlapping and touching occupancy. */
export function computeFreeTimeIntervals(
  items: readonly TimelineItem[],
): readonly MinuteInterval[] {
  const occupied = items
    .map(effectiveOccupancy)
    .filter((interval): interval is MinuteInterval => interval !== null)
    .sort(
      (left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute,
    );
  const merged: MinuteInterval[] = [];
  for (const interval of occupied) {
    const previous = merged.at(-1);
    if (previous && interval.startMinute <= previous.endMinute) {
      merged[merged.length - 1] = {
        startMinute: previous.startMinute,
        endMinute: Math.max(previous.endMinute, interval.endMinute),
      };
    } else {
      merged.push(interval);
    }
  }

  const free: MinuteInterval[] = [];
  let cursor = 0;
  for (const interval of merged) {
    if (interval.startMinute > cursor) {
      free.push({ startMinute: cursor, endMinute: interval.startMinute });
    }
    cursor = Math.max(cursor, interval.endMinute);
  }
  if (cursor < TIMELINE_DAY_MINUTES) {
    free.push({ startMinute: cursor, endMinute: TIMELINE_DAY_MINUTES });
  }
  return free;
}
