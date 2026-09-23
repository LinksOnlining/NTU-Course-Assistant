import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPlannerEvent,
  createTimeBlock,
  deletePlannerEvent,
  deleteTimeBlock,
  loadTimeBlocks,
  loadTimeBlocksForTask,
  loadPlannerEvents,
  updatePlannerEvent,
  updateTimeBlock,
  validatePlannerEventDraft,
  validateTimeBlockDraft,
} from "../../src/application/planner/planner-schedule.ts";
import {
  projectPlannerEventsToTimelineItems,
  projectTimeBlocksToTimelineItems,
} from "../../src/application/timeline/planner-timeline.ts";

const eventDraft = {
  title: "复习",
  description: "整理笔记",
  date: "2026-09-24",
  startTime: "09:00",
  endTime: "10:30",
  location: "图书馆",
  bufferBeforeMinutes: 15,
  bufferAfterMinutes: 20,
};

const blockDraft = {
  personalTaskId: "task-1",
  date: "2026-09-24",
  startTime: "13:00",
  endTime: "14:00",
  bufferBeforeMinutes: 5,
  bufferAfterMinutes: 10,
};

function repository() {
  const events = [];
  const blocks = [];
  return {
    events,
    blocks,
    async loadPlannerEvents(start, end) {
      return events.filter((event) => event.date >= start && event.date <= end);
    },
    async createPlannerEvent(event) {
      events.push(event);
      return event;
    },
    async updatePlannerEvent(event) {
      const index = events.findIndex((item) => item.id === event.id);
      events[index] = event;
      return event;
    },
    async deletePlannerEvent(id) {
      events.splice(
        events.findIndex((item) => item.id === id),
        1,
      );
    },
    async loadTimeBlocks(start, end) {
      return blocks.filter((block) => block.date >= start && block.date <= end);
    },
    async loadTimeBlocksForTask(taskId) {
      return blocks.filter((block) => block.personalTaskId === taskId);
    },
    async createTimeBlock(block) {
      blocks.push(block);
      return block;
    },
    async updateTimeBlock(block) {
      const index = blocks.findIndex((item) => item.id === block.id);
      blocks[index] = block;
      return block;
    },
    async deleteTimeBlock(id) {
      blocks.splice(
        blocks.findIndex((item) => item.id === id),
        1,
      );
    },
  };
}

test("PlannerEvent validation accepts local dates, optional fields, and bounded buffers", () => {
  assert.deepEqual(validatePlannerEventDraft(eventDraft), {});
  assert.deepEqual(validatePlannerEventDraft({ ...eventDraft, endTime: "24:00" }), {});
  assert.equal(
    validatePlannerEventDraft({ ...eventDraft, date: "2026-02-30" }).date,
    "请输入有效的日期。",
  );
  assert.equal(
    validatePlannerEventDraft({ ...eventDraft, endTime: "08:30" }).endTime,
    "当前版本暂不支持跨午夜日程。",
  );
  assert.equal(
    validatePlannerEventDraft({ ...eventDraft, endTime: "09:00" }).endTime,
    "结束时间必须晚于开始时间。",
  );
  assert.match(
    validatePlannerEventDraft({ ...eventDraft, bufferAfterMinutes: 241 }).bufferAfterMinutes,
    /0–240/u,
  );
});

test("TimeBlock validation requires a task and valid single-day interval", () => {
  assert.deepEqual(validateTimeBlockDraft(blockDraft), {});
  assert.equal(
    validateTimeBlockDraft({ ...blockDraft, personalTaskId: "" }).personalTaskId,
    "请选择关联任务。",
  );
  assert.equal(
    validateTimeBlockDraft({ ...blockDraft, startTime: "23:00", endTime: "01:00" }).endTime,
    "当前版本暂不支持跨午夜日程。",
  );
});

test("PlannerEvent create/edit normalizes optional fields and preserves stable identity", async () => {
  const store = repository();
  const now = new Date("2026-09-23T08:00:00.000Z");
  const created = await createPlannerEvent(
    { ...eventDraft, title: "  复习  ", description: "  ", location: " " },
    store,
    now,
    "event-1",
  );
  assert.equal(created.id, "event-1");
  assert.equal(created.title, "复习");
  assert.equal(created.description, null);
  assert.equal(created.location, null);
  const edited = await updatePlannerEvent(
    created,
    { ...eventDraft, title: "期中复习", date: "2026-09-25" },
    store,
    new Date("2026-09-24T08:00:00.000Z"),
  );
  assert.equal(edited.id, created.id);
  assert.equal(edited.createdAt, created.createdAt);
  assert.equal(edited.updatedAt, "2026-09-24T08:00:00.000Z");
  assert.deepEqual(await loadPlannerEvents("2026-09-25", "2026-09-25", store), [edited]);
  await assert.rejects(loadPlannerEvents("2026-09-26", "2026-09-25", store), /结束日期/u);
  await deletePlannerEvent(edited.id, store);
  assert.deepEqual(await loadPlannerEvents("2026-09-25", "2026-09-25", store), []);
});

test("TimeBlock create/edit stores only task identity and preserves creation time", async () => {
  const store = repository();
  const created = await createTimeBlock(
    blockDraft,
    store,
    new Date("2026-09-23T08:00:00.000Z"),
    "block-1",
  );
  assert.equal(created.personalTaskId, "task-1");
  assert.equal("title" in created, false);
  const edited = await updateTimeBlock(
    created,
    { ...blockDraft, startTime: "14:00", endTime: "15:00", bufferAfterMinutes: 20 },
    store,
    new Date("2026-09-24T08:00:00.000Z"),
  );
  assert.equal(edited.createdAt, created.createdAt);
  assert.equal(edited.startTime, "14:00");
  assert.equal(edited.bufferAfterMinutes, 20);
  assert.deepEqual(await loadTimeBlocks("2026-09-24", "2026-09-24", store), [edited]);
  assert.deepEqual(await loadTimeBlocksForTask("task-1", store), [edited]);
  await deleteTimeBlock(edited.id, store);
  assert.deepEqual(await loadTimeBlocksForTask("task-1", store), []);
});

test("Planner Timeline adapters retain stable source references, editing permissions, and task titles", () => {
  const event = {
    id: "event-1",
    ...eventDraft,
    description: null,
    createdAt: "2026-09-23T08:00:00.000Z",
    updatedAt: "2026-09-23T08:00:00.000Z",
  };
  const block = {
    id: "block-1",
    ...blockDraft,
    createdAt: "2026-09-23T08:00:00.000Z",
    updatedAt: "2026-09-23T08:00:00.000Z",
  };
  const eventItem = projectPlannerEventsToTimelineItems([event])[0];
  assert.equal(eventItem.sourceType, "plannerEvent");
  assert.deepEqual(eventItem.sourceRef, { type: "plannerEvent", id: "event-1" });
  assert.deepEqual(
    [eventItem.editable, eventItem.draggable, eventItem.resizable, eventItem.occupiesTime],
    [true, true, true, true],
  );

  const task = {
    id: "task-1",
    title: "复习期中内容",
    description: null,
    status: "open",
    priority: "none",
    deadlineDate: null,
    deadlineTime: null,
    createdAt: "2026-09-23T08:00:00.000Z",
    updatedAt: "2026-09-23T08:00:00.000Z",
    completedAt: null,
  };
  const blockItem = projectTimeBlocksToTimelineItems([block], [task])[0];
  assert.equal(blockItem.title, "复习期中内容");
  assert.deepEqual(blockItem.sourceRef, { type: "timeBlock", id: "block-1" });
  assert.deepEqual(
    [blockItem.editable, blockItem.draggable, blockItem.resizable, blockItem.occupiesTime],
    [true, true, true, true],
  );
  assert.equal(
    projectTimeBlocksToTimelineItems([block], [{ ...task, title: "已改名" }])[0].title,
    "已改名",
  );
  assert.deepEqual(projectTimeBlocksToTimelineItems([block], [])[0].warnings, [
    "未找到关联任务名称。",
  ]);
});
