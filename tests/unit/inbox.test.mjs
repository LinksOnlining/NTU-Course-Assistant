import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInboxText } from "../../src/application/inbox/inbox-parser.ts";
import {
  captureInboxText,
  confirmInboxEvent,
  confirmInboxTask,
  validateInboxEventProposal,
} from "../../src/application/inbox/inbox.ts";

const captured = "2026-09-24";

test("Inbox parser recognizes task prefix and explicit deadline without changing raw wording", () => {
  assert.deepEqual(parseInboxText("任务：整理材料 截止明天 18:00", captured), {
    kind: "task",
    title: "整理材料",
    date: null,
    startTime: null,
    endTime: null,
    deadlineDate: "2026-09-25",
    deadlineTime: "18:00",
  });
  assert.equal(parseInboxText("待办:今天提交报告", captured).deadlineDate, null);
  assert.equal(parseInboxText("任务：今天提交报告", captured).date, captured);
});

test("Inbox parser handles event dates, full date, month/day and time ranges", () => {
  assert.deepEqual(parseInboxText("日程：后天 09:30-11:00 项目讨论", captured), {
    kind: "event",
    title: "项目讨论",
    date: "2026-09-26",
    startTime: "09:30",
    endTime: "11:00",
    deadlineDate: null,
    deadlineTime: null,
  });
  assert.equal(parseInboxText("安排：2026-10-02 10:00 至 11:00 复诊", captured).date, "2026-10-02");
  assert.equal(parseInboxText("安排：10月8日 10:00-11:00 讨论", captured).date, "2026-10-08");
});

test("Inbox parser does not guess ambiguous afternoon time or intent", () => {
  const proposal = parseInboxText("明天下午去图书馆", captured);
  assert.equal(proposal.kind, "unknown");
  assert.equal(proposal.date, "2026-09-25");
  assert.equal(proposal.startTime, null);
  assert.equal(proposal.endTime, null);
  assert.equal(proposal.title, "下午去图书馆");
});

test("single event time leaves end unresolved and invalid dates are not normalized", () => {
  const event = parseInboxText("日程：今天 14:00 讨论", captured);
  assert.equal(event.startTime, "14:00");
  assert.equal(event.endTime, null);
  assert.match(validateInboxEventProposal(event), /结束时间/u);
  const reversed = parseInboxText("日程：今天 14:00-13:00 讨论", captured);
  assert.equal(reversed.startTime, "14:00");
  assert.equal(reversed.endTime, null);
  assert.equal(reversed.title, "讨论");
  assert.equal(parseInboxText("日程：2026-02-30 开会", captured).date, null);
});

function repositoryFixture({ failParse = false } = {}) {
  const items = new Map();
  const calls = [];
  return {
    items,
    calls,
    createInboxItem: async (id, rawText, createdAt) => {
      calls.push("raw");
      const item = {
        id,
        rawText,
        status: "pending",
        parseKind: null,
        parsePayloadJson: null,
        parserVersion: null,
        confirmedTargetType: null,
        confirmedTargetId: null,
        createdAt,
        updatedAt: createdAt,
      };
      items.set(id, item);
      return item;
    },
    loadInboxItems: async () => [...items.values()],
    saveInboxParseResult: async (id, parseKind, parsePayloadJson, parserVersion, updatedAt) => {
      calls.push("parse");
      assert.ok(items.has(id), "raw must be durable before parsing is saved");
      if (failParse) throw new Error("parse persistence failed");
      const saved = {
        ...items.get(id),
        status: parseKind === "unknown" ? "needs_review" : "ready",
        parseKind,
        parsePayloadJson,
        parserVersion,
        updatedAt,
      };
      items.set(id, saved);
      return saved;
    },
    dismissInboxItem: async () => {},
    deleteInboxItem: async (id) => items.delete(id),
    confirmInboxAsTask: async (id, task) => {
      calls.push("confirm-task");
      return { targetType: "personalTask", targetId: task.id };
    },
    confirmInboxAsEvent: async (id, event) => {
      calls.push("confirm-event");
      return { targetType: "plannerEvent", targetId: event.id };
    },
  };
}

test("capture persists raw first and preserves it when parse result persistence fails", async () => {
  const repository = repositoryFixture({ failParse: true });
  const result = await captureInboxText(
    "任务：本地内容",
    repository,
    new Date("2026-09-24T09:00:00"),
    "raw-first",
  );
  assert.deepEqual(repository.calls, ["raw", "parse"]);
  assert.equal(result.item.rawText, "任务：本地内容");
  assert.equal(result.item.status, "pending");
  assert.ok(result.parseError);
});

test("unknown intents require an explicit type and malformed stored proposals reparse from raw", async () => {
  const repository = repositoryFixture();
  const item = await repository.createInboxItem(
    "unknown-kind",
    "明天下午去图书馆",
    "2026-09-24T09:00:00",
  );
  const malformed = {
    ...item,
    parsePayloadJson: JSON.stringify({
      kind: "unexpected",
      title: "不可信类型",
      date: null,
      startTime: null,
      endTime: null,
      deadlineDate: null,
      deadlineTime: null,
    }),
  };
  const { proposalForInboxItem } = await import("../../src/application/inbox/inbox.ts");
  const proposal = proposalForInboxItem(malformed);
  assert.equal(proposal.kind, "unknown");
  assert.equal(proposal.date, "2026-09-25");
  assert.equal(proposal.startTime, null);
});

test("reviewed proposal fields are used for task and event confirmation", async () => {
  const repository = repositoryFixture();
  const item = await repository.createInboxItem("reviewed", "raw", "2026-09-24T09:00:00Z");
  let createdTask;
  let createdEvent;
  repository.confirmInboxAsTask = async (id, task) => {
    createdTask = task;
    return { targetType: "personalTask", targetId: task.id };
  };
  repository.confirmInboxAsEvent = async (id, event) => {
    createdEvent = event;
    return { targetType: "plannerEvent", targetId: event.id };
  };
  const taskProposal = {
    kind: "task",
    title: "用户编辑后的任务",
    date: null,
    startTime: null,
    endTime: null,
    deadlineDate: "2026-09-25",
    deadlineTime: "17:00",
  };
  const eventProposal = {
    kind: "event",
    title: "用户编辑后的日程",
    date: "2026-09-26",
    startTime: "10:00",
    endTime: "11:00",
    deadlineDate: null,
    deadlineTime: null,
  };
  await confirmInboxTask(
    item,
    taskProposal,
    repository,
    new Date("2026-09-24T09:00:00Z"),
    "task-id",
  );
  await confirmInboxEvent(
    item,
    eventProposal,
    repository,
    new Date("2026-09-24T09:00:00Z"),
    "event-id",
  );
  assert.equal(createdTask.title, "用户编辑后的任务");
  assert.equal(createdTask.deadlineDate, "2026-09-25");
  assert.equal(createdEvent.date, "2026-09-26");
  assert.equal(createdEvent.endTime, "11:00");
});
