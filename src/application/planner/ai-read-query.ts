import { loadPersonalTasks } from "./personal-tasks.ts";
import { loadPlannerEvents, loadTimeBlocks } from "./planner-schedule.ts";
import { loadRoutines } from "./routines.ts";
import { effectiveOccupancy } from "../timeline/planner-interactions.ts";
import {
  projectPlannerEventsToTimelineItems,
  projectTimeBlocksToTimelineItems,
} from "../timeline/planner-timeline.ts";
import { formatTimelineMinute } from "../timeline/planner-interactions.ts";

export async function readPlannerAiOpenItems(limit: number) {
  const items = (await loadPersonalTasks())
    .filter((task) => task.status === "open")
    .sort(
      (left, right) =>
        (left.deadlineDate ?? "9999-12-31").localeCompare(right.deadlineDate ?? "9999-12-31") ||
        (left.deadlineTime ?? "99:99").localeCompare(right.deadlineTime ?? "99:99") ||
        left.id.localeCompare(right.id),
    )
    .slice(0, limit)
    .map((task) => ({
      title: safeText(task.title),
      status: task.status,
      priority: task.priority,
      deadlineDate: task.deadlineDate,
      deadlineTime: task.deadlineTime,
    }));
  return Object.freeze({ items: Object.freeze(items) });
}

export async function readPlannerAiSchedule(input: {
  readonly from: string;
  readonly to: string;
  readonly limit: number;
}) {
  const [events, blocks] = await Promise.all([
    loadPlannerEvents(input.from, input.to),
    loadTimeBlocks(input.from, input.to),
  ]);
  const eventItems = [...projectPlannerEventsToTimelineItems(events)];
  const blockItems = [...projectTimeBlocksToTimelineItems(blocks, [])];
  const projectedEvents = eventItems
    .sort(compareTimeline)
    .slice(0, input.limit)
    .map((item) => {
      const event = events.find((candidate) => `planner-event:${candidate.id}` === item.id)!;
      const occupancy = effectiveOccupancy(item)!;
      return {
        title: safeText(event.title),
        date: item.date,
        start: item.startTime,
        end: item.endTime,
        location: event.location === null ? null : safeText(event.location),
        occupiedStart: formatTimelineMinute(occupancy.startMinute),
        occupiedEnd: formatTimelineMinute(occupancy.endMinute),
      };
    });
  const projectedBlocks = blockItems
    .sort(compareTimeline)
    .slice(0, input.limit)
    .map((item) => {
      const occupancy = effectiveOccupancy(item)!;
      return {
        date: item.date,
        start: item.startTime,
        end: item.endTime,
        occupiedStart: formatTimelineMinute(occupancy.startMinute),
        occupiedEnd: formatTimelineMinute(occupancy.endMinute),
      };
    });
  return Object.freeze({
    events: Object.freeze(projectedEvents),
    timeBlocks: Object.freeze(projectedBlocks),
    busyCount: projectedEvents.length + projectedBlocks.length,
  });
}

export async function readRoutineAiToday() {
  const now = new Date();
  const date = localDateKey(now);
  const weekday = now.getDay() === 0 ? 7 : now.getDay();
  const items = (await loadRoutines())
    .filter((routine) => routine.enabled && (routine.weekdaysMask & (1 << (weekday - 1))) !== 0)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((routine) => ({
      title: safeText(routine.title),
      targetDurationMinutes: routine.targetDurationMinutes,
      scheduledToday: routine.lastScheduledDate === date,
      preferredStartTime: routine.preferredStartTime,
      preferredEndTime: routine.preferredEndTime,
    }));
  return Object.freeze({ date, items: Object.freeze(items) });
}

function compareTimeline(
  left: { date: string; startTime: string; id: string },
  right: { date: string; startTime: string; id: string },
): number {
  return (
    left.date.localeCompare(right.date) ||
    left.startTime.localeCompare(right.startTime) ||
    left.id.localeCompare(right.id)
  );
}

function safeText(value: string): string {
  return Array.from(value).slice(0, 180).join("");
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
