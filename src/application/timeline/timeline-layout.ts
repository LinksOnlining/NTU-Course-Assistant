import type { TimelineItem } from "./types.ts";

export const TIMELINE_DAY_MINUTES = 24 * 60;
export const TIMELINE_PIXELS_PER_MINUTE = 1;
export const TIMELINE_MIN_ITEM_HEIGHT = 24;

export interface TimelineTick {
  readonly minute: number;
  readonly label: string | null;
  readonly kind: "hour" | "half-hour" | "end";
}

export interface TimelinePlacement {
  readonly id: string;
  readonly top: number;
  readonly height: number;
  readonly leftPercent: number;
  readonly widthPercent: number;
  readonly lane: number;
  readonly laneCount: number;
}

export interface TimelineLayoutWarning {
  readonly itemId: string;
  readonly message: string;
}

export interface TimelineLayout {
  readonly height: number;
  readonly ticks: readonly TimelineTick[];
  readonly placements: readonly TimelinePlacement[];
  readonly warnings: readonly TimelineLayoutWarning[];
}

interface TimedItem {
  readonly item: TimelineItem;
  readonly start: number;
  readonly end: number;
}

export function timeToDayMinute(value: string, allowEndOfDay = false): number | null {
  const match = /^(\d{2}):(\d{2})$/u.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59) return null;
  if (allowEndOfDay && hour === 24 && minute === 0) return TIMELINE_DAY_MINUTES;
  if (hour > 23) return null;
  return hour * 60 + minute;
}

function createTicks(): readonly TimelineTick[] {
  const ticks: TimelineTick[] = [];
  for (let minute = 0; minute < TIMELINE_DAY_MINUTES; minute += 30) {
    const hour = Math.floor(minute / 60);
    const isHour = minute % 60 === 0;
    ticks.push({
      minute,
      label: isHour ? `${String(hour).padStart(2, "0")}:00` : null,
      kind: isHour ? "hour" : "half-hour",
    });
  }
  ticks.push({ minute: TIMELINE_DAY_MINUTES, label: "24:00", kind: "end" });
  return ticks;
}

function assignLanes(group: readonly TimedItem[]): readonly TimelinePlacement[] {
  const laneEnds: number[] = [];
  const assigned = group.map(({ item, start, end }) => {
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = end;
    return { id: item.id, start, end, lane };
  });
  const laneCount = Math.max(1, laneEnds.length);
  return assigned.map(({ id, start, end, lane }) => ({
    id,
    top: start * TIMELINE_PIXELS_PER_MINUTE,
    height:
      Math.min(Math.max(end - start, TIMELINE_MIN_ITEM_HEIGHT), TIMELINE_DAY_MINUTES - start) *
      TIMELINE_PIXELS_PER_MINUTE,
    leftPercent: (lane * 100) / laneCount,
    widthPercent: 100 / laneCount,
    lane,
    laneCount,
  }));
}

/** Maps display intervals to one 1,440px day. Invalid intervals are skipped with explicit warnings. */
export function layoutTimelineItems(items: readonly TimelineItem[]): TimelineLayout {
  const warnings: TimelineLayoutWarning[] = [];
  const valid: TimedItem[] = [];
  for (const item of items) {
    const start = timeToDayMinute(item.startTime);
    const end = timeToDayMinute(item.endTime, true);
    if (start === null || end === null || end <= start) {
      warnings.push({ itemId: item.id, message: "时间无效或不在同一天，已从时间轴略过。" });
      continue;
    }
    valid.push({ item, start, end });
  }

  valid.sort(
    (left, right) =>
      left.start - right.start || left.end - right.end || left.item.id.localeCompare(right.item.id),
  );

  const placements: TimelinePlacement[] = [];
  let group: TimedItem[] = [];
  let groupEnd = -1;
  const flush = () => {
    if (group.length > 0) placements.push(...assignLanes(group));
    group = [];
    groupEnd = -1;
  };

  for (const item of valid) {
    if (group.length > 0 && item.start >= groupEnd) flush();
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  flush();

  const byInputOrder = new Map(placements.map((placement) => [placement.id, placement]));
  return {
    height: TIMELINE_DAY_MINUTES * TIMELINE_PIXELS_PER_MINUTE,
    ticks: createTicks(),
    placements: items.flatMap((item) => {
      const placement = byInputOrder.get(item.id);
      return placement ? [placement] : [];
    }),
    warnings,
  };
}
