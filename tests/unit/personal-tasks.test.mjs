import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPersonalTask,
  deletePersonalTask,
  personalTaskDeadlineKind,
  personalTaskDeadlineLabel,
  setPersonalTaskCompleted,
  sortPersonalTasks,
  updatePersonalTask,
  validatePersonalTaskDraft,
} from "../../src/application/planner/personal-tasks.ts";

const today = "2026-09-23";
const draft = {
  title: "整理资料",
  description: "",
  priority: "none",
  deadlineDate: "",
  deadlineTime: "",
};

function task(id, deadlineDate = null, deadlineTime = null, priority = "none") {
  return {
    id,
    title: id,
    description: null,
    status: "open",
    priority,
    deadlineDate,
    deadlineTime,
    createdAt: "2026-09-23T08:00:00.000Z",
    updatedAt: "2026-09-23T08:00:00.000Z",
    completedAt: null,
  };
}

test("PersonalTask validates title, description, priority and optional deadline combinations", () => {
  assert.deepEqual(validatePersonalTaskDraft(draft), {});
  assert.equal(
    validatePersonalTaskDraft({ ...draft, deadlineTime: "09:00" }).deadlineDate,
    "填写截止时间时也需要选择日期。",
  );
  assert.equal(
    validatePersonalTaskDraft({ ...draft, deadlineDate: "2026-02-30" }).deadlineDate,
    "请输入有效的日期。",
  );
  assert.equal(
    validatePersonalTaskDraft({ ...draft, deadlineDate: "2026-09-23", deadlineTime: "24:00" })
      .deadlineTime,
    "请输入有效的时间。",
  );
  assert.equal(validatePersonalTaskDraft({ ...draft, title: "  " }).title, "请输入任务标题。");
  assert.equal(
    validatePersonalTaskDraft({ ...draft, priority: "urgent" }).priority,
    "请选择有效的优先级。",
  );
});

test("deadline semantics do not mark date-only task due today as overdue", () => {
  assert.equal(personalTaskDeadlineKind(task("date-only", today), today, "23:59"), "today");
  assert.equal(
    personalTaskDeadlineKind(task("past-time", today, "11:59"), today, "12:00"),
    "overdue",
  );
  assert.equal(
    personalTaskDeadlineKind(task("future-time", today, "12:01"), today, "12:00"),
    "today",
  );
  assert.equal(personalTaskDeadlineKind(task("older", "2026-09-22"), today, "12:00"), "overdue");
  assert.equal(personalTaskDeadlineKind(task("future", "2026-09-24"), today, "12:00"), "upcoming");
  assert.equal(personalTaskDeadlineKind(task("none"), today, "12:00"), "none");
});

test("task sorting groups deadline state, places date-only after timed tasks and uses priority for ties", () => {
  const sorted = sortPersonalTasks(
    [
      task("none"),
      task("date-only", today),
      task("today-high", today, "09:00", "high"),
      task("today-low", today, "09:00", "low"),
      task("overdue", "2026-09-20"),
      task("future", "2026-09-25"),
      task("today-later", today, "10:00"),
    ],
    today,
    "09:30",
  );
  assert.deepEqual(
    sorted.map((item) => item.id),
    ["overdue", "today-high", "today-low", "today-later", "date-only", "future", "none"],
  );
});

test("deadline labels use natural local dates without turning date-only deadlines into a time", () => {
  assert.equal(personalTaskDeadlineLabel(task("today", today), today, "12:00"), "今天");
  assert.equal(
    personalTaskDeadlineLabel(task("tomorrow", "2026-09-24", "09:30"), today, "12:00"),
    "明天 09:30",
  );
  assert.equal(personalTaskDeadlineLabel(task("week", "2026-09-26"), today, "12:00"), "周六");
  assert.equal(
    personalTaskDeadlineLabel(task("past", today, "08:00"), today, "12:00"),
    "已逾期 · 今天 08:00",
  );
  assert.equal(personalTaskDeadlineLabel(task("none"), today, "12:00"), "无截止日期");
});

test("Application use cases create, update, complete, reopen and delete through repository", async () => {
  const records = new Map();
  const calls = [];
  const repository = {
    async loadPersonalTasks() {
      return [...records.values()];
    },
    async createPersonalTask(value) {
      calls.push("create");
      records.set(value.id, value);
      return value;
    },
    async updatePersonalTask(value) {
      calls.push("update");
      records.set(value.id, value);
      return value;
    },
    async setPersonalTaskCompleted(id, completed, updatedAt) {
      calls.push(completed ? "complete" : "reopen");
      const value = {
        ...records.get(id),
        status: completed ? "completed" : "open",
        completedAt: completed ? updatedAt : null,
        updatedAt,
      };
      records.set(id, value);
      return value;
    },
    async deletePersonalTask(id) {
      calls.push("delete");
      records.delete(id);
    },
  };

  const created = await createPersonalTask(
    { ...draft, title: "  整理资料 ", description: "  附件  ", deadlineDate: today },
    repository,
    new Date("2026-09-23T08:00:00.000Z"),
    "task-1",
  );
  assert.equal(created.title, "整理资料");
  assert.equal(created.description, "附件");
  assert.equal(created.status, "open");
  assert.equal(created.createdAt, "2026-09-23T08:00:00.000Z");

  const edited = await updatePersonalTask(
    created,
    { ...draft, title: "提交资料", priority: "high", deadlineDate: today, deadlineTime: "17:00" },
    repository,
    new Date("2026-09-23T09:00:00.000Z"),
  );
  assert.equal(edited.id, created.id);
  assert.equal(edited.createdAt, created.createdAt);
  assert.equal(edited.title, "提交资料");

  const completed = await setPersonalTaskCompleted(
    "task-1",
    true,
    repository,
    new Date("2026-09-23T10:00:00.000Z"),
  );
  assert.equal(completed.status, "completed");
  assert.equal(completed.completedAt, "2026-09-23T10:00:00.000Z");

  const reopened = await setPersonalTaskCompleted(
    "task-1",
    false,
    repository,
    new Date("2026-09-23T11:00:00.000Z"),
  );
  assert.equal(reopened.status, "open");
  assert.equal(reopened.completedAt, null);
  await deletePersonalTask("task-1", repository);
  assert.equal(records.size, 0);
  assert.deepEqual(calls, ["create", "update", "complete", "reopen", "delete"]);
});
