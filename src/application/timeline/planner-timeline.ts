import type { PersonalTask } from "../../types/personal-task.ts";
import type { PlannerEvent, TimeBlock } from "../../types/planner.ts";
import type { TimelineItem } from "./types.ts";

export function projectPlannerEventsToTimelineItems(
  events: readonly PlannerEvent[],
): readonly TimelineItem[] {
  return events.map((event) => ({
    id: `planner-event:${event.id}`,
    sourceType: "plannerEvent",
    sourceRef: { type: "plannerEvent", id: event.id },
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    title: event.title,
    location: event.location,
    status: "normal",
    editable: true,
    draggable: true,
    resizable: true,
    occupiesTime: true,
    bufferBeforeMinutes: event.bufferBeforeMinutes,
    bufferAfterMinutes: event.bufferAfterMinutes,
    warnings: [],
  }));
}

export function projectTimeBlocksToTimelineItems(
  blocks: readonly TimeBlock[],
  tasks: readonly PersonalTask[],
): readonly TimelineItem[] {
  const taskTitles = new Map(tasks.map((task) => [task.id, task.title]));
  return blocks.map((block) => {
    const taskTitle = taskTitles.get(block.personalTaskId);
    return {
      id: `time-block:${block.id}`,
      sourceType: "timeBlock",
      sourceRef: { type: "timeBlock", id: block.id },
      date: block.date,
      startTime: block.startTime,
      endTime: block.endTime,
      title: taskTitle ?? "关联任务",
      location: null,
      status: "normal",
      editable: true,
      draggable: true,
      resizable: true,
      occupiesTime: true,
      bufferBeforeMinutes: block.bufferBeforeMinutes,
      bufferAfterMinutes: block.bufferAfterMinutes,
      warnings: taskTitle ? [] : ["未找到关联任务名称。"],
    };
  });
}
