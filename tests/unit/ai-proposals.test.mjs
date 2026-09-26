import assert from "node:assert/strict";
import { test } from "node:test";
import { createAiPlannerProposalRuntime } from "../../src/application/ai/proposal-runtime.ts";
import { createAiToolRegistry } from "../../src/application/ai/tool-registry.ts";
import { runAiToolLoop } from "../../src/application/ai/tool-runtime.ts";
import { BUILT_IN_MODULES } from "../../src/modules/built-in-modules.ts";
import { createWorkplaceModuleRegistry } from "../../src/modules/registry.ts";

const TIME = "2026-09-26T10:00:00.000Z";

function task(id = "task-1", overrides = {}) {
  return {
    id,
    title: "准备报告",
    status: "open",
    updatedAt: TIME,
    ...overrides,
  };
}

function conflictItem(overrides = {}) {
  return {
    id: "event:existing",
    sourceType: "plannerEvent",
    sourceRef: { type: "plannerEvent", id: "existing" },
    date: "2026-09-27",
    startTime: "09:00",
    endTime: "10:00",
    title: "已有会议",
    location: null,
    status: "normal",
    editable: true,
    draggable: true,
    resizable: true,
    occupiesTime: true,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    warnings: [],
    ...overrides,
  };
}

function runtimePorts(overrides = {}) {
  const writes = [];
  let id = 0;
  let currentTasks = [task()];
  return {
    writes,
    setTasks: (value) => {
      currentTasks = value;
    },
    ports: {
      now: () => new Date(TIME),
      createId: () => `generated-${++id}`,
      loadTermConfig: async () => null,
      loadTasks: async () => currentTasks,
      loadScheduleDay: async (date) => ({
        date,
        events: [],
        timeBlocks: [],
        timelineItems: [],
        tasks: currentTasks,
        warnings: [],
      }),
      createTask: async (draft) => {
        writes.push(["task", draft]);
        return { id: "created-task", ...draft };
      },
      createEvent: async (draft) => {
        writes.push(["event", draft]);
        return { id: "created-event", ...draft };
      },
      createBlock: async (draft) => {
        writes.push(["timeBlock", draft]);
        return { id: "created-block", ...draft };
      },
      ...overrides,
    },
  };
}

function provider(turns) {
  const calls = [];
  return {
    id: "mock",
    calls,
    async generateToolTurn(turn) {
      calls.push(structuredClone(turn));
      return turns.shift() ?? { kind: "final", content: "完成" };
    },
  };
}

const request = {
  id: "proposal-test-request",
  intent: "plan",
  sourceModule: "planner",
  createdAt: TIME,
  prompt: "安排规划",
  context: { selectedItems: [], moduleContexts: {}, permissionScope: [] },
};

test("Proposal 创建只产生本地待审记录，取消/未确认不写入，确认后仅调用既有 Application UseCase", async () => {
  const fixture = runtimePorts();
  const runtime = createAiPlannerProposalRuntime({ ports: fixture.ports });
  const proposal = await runtime.proposeTask(
    {
      title: "整理课程资料",
      deadlineDate: null,
      deadlineTime: null,
      priority: "medium",
    },
    "mock",
  );
  assert.equal(proposal.status, "reviewRequired");
  assert.equal(proposal.requiredPermission, "planner.propose");
  assert.equal(proposal.requiresConfirmation, true);
  assert.deepEqual(fixture.writes, []);
  assert.equal(
    (
      await runtime.apply({
        id: proposal.id,
        confirmed: false,
        expectedPreviewRevision: 1,
        permissionIds: ["planner.propose"],
      })
    ).status,
    "notConfirmed",
  );
  assert.deepEqual(fixture.writes, []);
  const applied = await runtime.apply({
    id: proposal.id,
    confirmed: true,
    expectedPreviewRevision: 1,
    permissionIds: ["planner.propose"],
  });
  assert.equal(applied.status, "applied");
  assert.deepEqual(
    fixture.writes.map(([kind]) => kind),
    ["task"],
  );
  assert.equal(
    (
      await runtime.apply({
        id: proposal.id,
        confirmed: true,
        expectedPreviewRevision: 1,
        permissionIds: ["planner.propose"],
      })
    ).status,
    "alreadyApplied",
  );
  assert.equal(fixture.writes.length, 1);
});

test("日程冲突变化会刷新本地 Preview 并要求再次确认后才写入", async () => {
  let loads = 0;
  const fixture = runtimePorts({
    loadScheduleDay: async (date) => ({
      date,
      events: [],
      timeBlocks: [],
      timelineItems: ++loads === 1 ? [] : [conflictItem()],
      tasks: [task()],
      warnings: [],
    }),
  });
  const runtime = createAiPlannerProposalRuntime({ ports: fixture.ports });
  const proposal = await runtime.proposeEvent(
    {
      title: "课程复习",
      date: "2026-09-27",
      startTime: "09:30",
      endTime: "10:30",
      location: null,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
    },
    "deepseek",
  );
  assert.equal(proposal.preview.warnings.length, 0);
  const first = await runtime.apply({
    id: proposal.id,
    confirmed: true,
    expectedPreviewRevision: 1,
    permissionIds: ["planner.propose"],
  });
  assert.equal(first.status, "needsReconfirmation");
  assert.equal(first.proposal.preview.revision, 2);
  assert.equal(first.proposal.preview.warnings.length, 1);
  assert.deepEqual(fixture.writes, []);
  const second = await runtime.apply({
    id: proposal.id,
    confirmed: true,
    expectedPreviewRevision: 2,
    permissionIds: ["planner.propose"],
  });
  assert.equal(
    second.status,
    "applied",
    "overlap warns but does not hard-block the user's confirmed action",
  );
  assert.equal(fixture.writes.length, 1);
});

test("TimeBlock 提案必须关联未完成任务，任务变化要求重新确认", async () => {
  const fixture = runtimePorts();
  const runtime = createAiPlannerProposalRuntime({ ports: fixture.ports });
  const proposal = await runtime.proposeTimeBlock(
    {
      personalTaskId: "task-1",
      date: "2026-09-27",
      startTime: "13:00",
      endTime: "14:00",
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
    },
    "mock",
  );
  fixture.setTasks([
    task("task-1", { title: "更新后的任务名", updatedAt: "2026-09-26T11:00:00.000Z" }),
  ]);
  const stalePreview = await runtime.apply({
    id: proposal.id,
    confirmed: true,
    expectedPreviewRevision: 1,
    permissionIds: ["planner.propose"],
  });
  assert.equal(stalePreview.status, "needsReconfirmation");
  assert.equal(stalePreview.proposal.preview.revision, 2);
  assert.equal(stalePreview.proposal.preview.fields[0].value, "更新后的任务名");
  assert.deepEqual(fixture.writes, []);
  fixture.setTasks([
    task("task-1", { status: "completed", updatedAt: "2026-09-26T12:00:00.000Z" }),
  ]);
  assert.equal(
    (
      await runtime.apply({
        id: proposal.id,
        confirmed: true,
        expectedPreviewRevision: 2,
        permissionIds: ["planner.propose"],
      })
    ).status,
    "stale",
  );
  assert.deepEqual(fixture.writes, []);
});

test("过期提案和写入失败均不会形成重复写入；失败状态为终态", async () => {
  let now = new Date(TIME);
  const fixture = runtimePorts({
    now: () => now,
    createTask: async () => {
      throw new Error("database unavailable");
    },
  });
  const runtime = createAiPlannerProposalRuntime({ ports: fixture.ports });
  const proposal = await runtime.proposeTask(
    {
      title: "到期任务",
      deadlineDate: null,
      deadlineTime: null,
      priority: "none",
    },
    "mock",
  );
  now = new Date(Date.parse(TIME) + 16 * 60_000);
  assert.equal(
    (
      await runtime.apply({
        id: proposal.id,
        confirmed: true,
        expectedPreviewRevision: 1,
        permissionIds: ["planner.propose"],
      })
    ).status,
    "expired",
  );
  assert.equal(runtime.get(proposal.id).status, "stale");

  now = new Date(TIME);
  const second = await runtime.proposeTask(
    {
      title: "失败任务",
      deadlineDate: null,
      deadlineTime: null,
      priority: "none",
    },
    "mock",
  );
  const failed = await runtime.apply({
    id: second.id,
    confirmed: true,
    expectedPreviewRevision: 1,
    permissionIds: ["planner.propose"],
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.proposal.status, "failed");
  assert.equal(
    (
      await runtime.apply({
        id: second.id,
        confirmed: true,
        expectedPreviewRevision: 1,
        permissionIds: ["planner.propose"],
      })
    ).status,
    "stale",
  );
});

test("同一 Proposal 并发双确认最多只调用一次 Application UseCase", async () => {
  const fixture = runtimePorts({
    createTask: async (draft) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      fixture.writes.push(["task", draft]);
      return { id: "only-one-task", ...draft };
    },
  });
  const runtime = createAiPlannerProposalRuntime({ ports: fixture.ports });
  const proposal = await runtime.proposeTask(
    {
      title: "并发确认测试",
      deadlineDate: null,
      deadlineTime: null,
      priority: "low",
    },
    "mock",
  );
  const confirmation = {
    id: proposal.id,
    confirmed: true,
    expectedPreviewRevision: 1,
    permissionIds: ["planner.propose"],
  };
  const results = await Promise.all([runtime.apply(confirmation), runtime.apply(confirmation)]);
  assert.deepEqual(
    results.map(({ status }) => status),
    ["applied", "applied"],
  );
  assert.equal(fixture.writes.length, 1);
});

test("Provider 工具列表按 planner.propose 和单一 workflow allowlist 限制；伪造其他名称不执行", async () => {
  const planner = BUILT_IN_MODULES.find(({ id }) => id === "planner");
  const declarations = planner.aiTools.filter(({ effect }) => effect === "proposal");
  const modules = createWorkplaceModuleRegistry([{ ...planner, aiTools: declarations }]);
  const executions = [];
  const registry = createAiToolRegistry(
    declarations.map((declaration) => ({
      id: declaration.id,
      parseInput: (value) => value,
      execute: (value) => {
        executions.push([declaration.name, value]);
        return { status: "reviewRequired", proposalId: "p", proposalType: "task" };
      },
    })),
    modules,
  );
  const policy = {
    grantedPermissionIds: ["planner.propose"],
    allowedToolIds: ["planner.propose-task"],
  };
  assert.deepEqual(
    registry.getAvailable({ require: () => ({ allowed: false }) }, policy).map(({ name }) => name),
    ["planner_propose_task"],
  );
  const ai = provider([
    {
      kind: "functionCalls",
      calls: [
        {
          callId: "forged-event-call",
          name: "planner_propose_event",
          arguments: JSON.stringify({
            title: "伪造日程",
            date: "2026-09-27",
            startTime: "09:00",
            endTime: "10:00",
            location: null,
            bufferBeforeMinutes: 0,
            bufferAfterMinutes: 0,
          }),
        },
      ],
    },
  ]);
  const result = await runAiToolLoop({
    request,
    provider: ai,
    registry,
    permissionSettings: { persistentGrants: [] },
    proposalPolicy: policy,
  });
  assert.equal(result.status, "failed");
  assert.deepEqual(executions, []);
  assert.equal(
    ai.calls.length,
    1,
    "a denied proposal call ends without a Provider follow-up that could escalate scope",
  );

  const multiCallProvider = provider([
    {
      kind: "functionCalls",
      calls: [
        {
          callId: "task-call",
          name: "planner_propose_task",
          arguments: JSON.stringify({
            title: "任务",
            deadlineDate: null,
            deadlineTime: null,
            priority: "none",
          }),
        },
        {
          callId: "event-call",
          name: "planner_propose_event",
          arguments: JSON.stringify({
            title: "日程",
            date: "2026-09-27",
            startTime: "09:00",
            endTime: "10:00",
            location: null,
            bufferBeforeMinutes: 0,
            bufferAfterMinutes: 0,
          }),
        },
      ],
    },
  ]);
  assert.equal(
    (
      await runAiToolLoop({
        request,
        provider: multiCallProvider,
        registry,
        permissionSettings: { persistentGrants: [] },
        proposalPolicy: {
          grantedPermissionIds: ["planner.propose"],
          allowedToolIds: ["planner.propose-task", "planner.propose-event"],
        },
      })
    ).status,
    "failed",
  );
  assert.deepEqual(
    executions,
    [],
    "multiple Proposal calls are rejected before any proposal is created",
  );
});
