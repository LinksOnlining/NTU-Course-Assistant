import assert from "node:assert/strict";
import { test } from "node:test";
import { AI_TOOL_ADAPTERS } from "../../src/application/ai/tool-adapters.ts";
import { MockAIProvider } from "../../src/application/ai/mock-provider.ts";
import {
  createAiToolRegistry,
  validateJsonSchema,
} from "../../src/application/ai/tool-registry.ts";
import { runAiToolLoop, AI_TOOL_LOOP_LIMITS } from "../../src/application/ai/tool-runtime.ts";
import { BUILT_IN_MODULES } from "../../src/modules/built-in-modules.ts";
import {
  createWorkplaceModuleRegistry,
  workplaceModuleRegistry,
} from "../../src/modules/registry.ts";

const ALLOWED = { persistentGrants: ["workspace.read"] };
const TOOL_INPUT = {
  type: "object",
  properties: { value: { type: "string", maxLength: 100 } },
  required: ["value"],
  additionalProperties: false,
};
const TOOL_OUTPUT = {
  type: "object",
  properties: { value: { type: "string" } },
  required: ["value"],
  additionalProperties: false,
};

function fixture(options = {}) {
  const declarations = options.declarations ?? [
    {
      id: "workspace.test",
      name: "workspace_test_read",
      moduleId: "workspace",
      order: 10,
      description: "读取测试摘要",
      effect: "read",
      permissionIds: ["workspace.read"],
      inputSchema: TOOL_INPUT,
      outputSchema: TOOL_OUTPUT,
    },
  ];
  const workspace = BUILT_IN_MODULES.find(({ id }) => id === "workspace");
  const module = {
    ...workspace,
    permissions: [
      {
        id: "workspace.read",
        moduleId: "workspace",
        action: "read",
        label: "读取工作台",
        description: "测试读取权限",
      },
    ],
    aiTools: declarations,
  };
  const modules = createWorkplaceModuleRegistry([module]);
  const executions = [];
  const adapters = declarations.map((declaration) => ({
    id: declaration.id,
    parseInput(value) {
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        typeof value.value !== "string"
      ) {
        throw new Error("invalid test input");
      }
      return { value: value.value };
    },
    async execute(input) {
      executions.push([declaration.name, input]);
      return options.execute?.(declaration, input) ?? { value: input.value };
    },
  }));
  return { modules, executions, registry: createAiToolRegistry(adapters, modules) };
}

function request(prompt = "总结我的安排") {
  return {
    id: "request_phase43",
    intent: "summarize",
    sourceModule: "workspace",
    createdAt: "2026-09-26T10:00:00.000Z",
    prompt,
    context: { selectedItems: [], moduleContexts: {}, permissionScope: [] },
  };
}

function provider(turns) {
  const calls = [];
  return {
    id: "mock",
    calls,
    async generateToolTurn(turn) {
      calls.push(structuredClone(turn));
      const next = turns.shift();
      if (next instanceof Error) throw next;
      return next ?? { kind: "final", content: "完成" };
    },
  };
}

function functionCalls(...calls) {
  return { kind: "functionCalls", calls };
}

function call(callId, name = "workspace_test_read", args = '{"value":"ok"}') {
  return { callId, name, arguments: args };
}

function outputItems(turn) {
  return turn.inputItems.filter((item) => item.kind === "functionCallOutput");
}

test("生产 AIToolRegistry 从 WorkspaceModuleRegistry 获取六项读取与三项提案工具且顺序稳定", () => {
  const definitions = workplaceModuleRegistry.aiTools;
  assert.equal(definitions.length, 9);
  assert.equal(definitions.filter(({ effect }) => effect === "read").length, 6);
  assert.equal(definitions.filter(({ effect }) => effect === "proposal").length, 3);
  assert.deepEqual(
    definitions.map(({ name }) => name),
    [
      "academic_get_upcoming",
      "planner_get_open_items",
      "routine_get_today",
      "weather_get_summary",
      "workspace_get_overview",
      "planner_get_schedule",
      "planner_propose_task",
      "planner_propose_event",
      "planner_propose_time_block",
    ],
  );
  assert.ok(
    definitions.every(
      ({ permissionIds, inputSchema, outputSchema }) =>
        permissionIds.length === 1 &&
        inputSchema.type === "object" &&
        outputSchema.type === "object",
    ),
  );
  assert.ok(definitions.every(({ name }) => /^[a-zA-Z0-9_-]{1,128}$/u.test(name)));
  assert.ok(
    definitions
      .filter(({ effect }) => effect === "proposal")
      .every(
        ({ moduleId, permissionIds }) =>
          moduleId === "planner" &&
          permissionIds.length === 1 &&
          permissionIds[0] === "planner.propose",
      ),
  );
  assert.ok(
    !definitions.some(({ id, name }) => /diary|inbox|search|database|http/iu.test(`${id} ${name}`)),
  );
  const runtime = createAiToolRegistry(AI_TOOL_ADAPTERS);
  assert.deepEqual(
    runtime.tools.map(({ id }) => id),
    definitions.map(({ id }) => id),
  );
});

test("planner.propose 与 workflow 工具 allowlist 共同决定仅暴露对应 Proposal Tool", () => {
  const runtime = createAiToolRegistry(AI_TOOL_ADAPTERS);
  const noReadPermissions = { require: () => ({ allowed: false }) };
  const proposalNames = (policy) =>
    runtime
      .getAvailable(noReadPermissions, policy)
      .filter(({ effect }) => effect === "proposal")
      .map(({ name }) => name);

  assert.deepEqual(
    proposalNames({
      grantedPermissionIds: [],
      allowedToolIds: [
        "planner.propose-task",
        "planner.propose-event",
        "planner.propose-time-block",
      ],
    }),
    [],
    "planner.propose OFF must expose no Planner Proposal Tool",
  );
  assert.deepEqual(
    proposalNames({
      grantedPermissionIds: ["planner.propose"],
      allowedToolIds: ["planner.propose-task"],
    }),
    ["planner_propose_task"],
  );
  assert.deepEqual(
    proposalNames({
      grantedPermissionIds: ["planner.propose"],
      allowedToolIds: ["planner.propose-event"],
    }),
    ["planner_propose_event"],
  );
  assert.deepEqual(
    proposalNames({
      grantedPermissionIds: ["planner.propose"],
      allowedToolIds: ["planner.propose-time-block"],
    }),
    ["planner_propose_time_block"],
  );
  assert.deepEqual(
    proposalNames({ grantedPermissionIds: ["planner.propose"], allowedToolIds: [] }),
    [],
    "permission alone cannot expose Proposal Tools without workflow capability",
  );
});

test("每个 Proposal Tool 的输出 schema 只接受自身 Proposal 类型", () => {
  const proposals = workplaceModuleRegistry.aiTools.filter(({ effect }) => effect === "proposal");
  for (const [toolName, proposalType] of [
    ["planner_propose_task", "task"],
    ["planner_propose_event", "event"],
    ["planner_propose_time_block", "timeBlock"],
  ]) {
    const tool = proposals.find(({ name }) => name === toolName);
    const schema = tool.outputSchema;
    assert.deepEqual(schema.properties.proposalType.enum, [proposalType]);
    assert.equal(
      validateJsonSchema(
        { status: "reviewRequired", proposalId: "proposal-1", proposalType },
        schema,
      ),
      true,
    );
    for (const otherType of ["task", "event", "timeBlock"].filter(
      (type) => type !== proposalType,
    )) {
      assert.equal(
        validateJsonSchema(
          { status: "reviewRequired", proposalId: "proposal-1", proposalType: otherType },
          schema,
        ),
        false,
        `${toolName} must reject ${otherType} output`,
      );
    }
  }
});

test("权限关闭的工具不会发给 Provider；无工具时选择 none；新请求读取新权限", async () => {
  const state = fixture();
  const noPermissionProvider = provider([{ kind: "final", content: "无工具" }]);
  const noPermission = await runAiToolLoop({
    request: request(),
    provider: noPermissionProvider,
    registry: state.registry,
    permissionSettings: { persistentGrants: [] },
  });
  assert.equal(noPermission.status, "completed");
  assert.deepEqual(noPermissionProvider.calls[0].tools, []);
  assert.equal(noPermissionProvider.calls[0].toolChoice, "none");

  const allowedProvider = provider([{ kind: "final", content: "有工具" }]);
  await runAiToolLoop({
    request: request(),
    provider: allowedProvider,
    registry: state.registry,
    permissionSettings: ALLOWED,
  });
  assert.deepEqual(
    allowedProvider.calls[0].tools.map(({ name }) => name),
    ["workspace_test_read"],
  );
  assert.equal(allowedProvider.calls[0].toolChoice, "auto");
});

test("单次只读调用完成后按真实 call_id 配对，再接收最终回复", async () => {
  const state = fixture();
  const ai = provider([functionCalls(call("call-1")), { kind: "final", content: "下周有安排" }]);
  const result = await runAiToolLoop({
    request: request(),
    provider: ai,
    registry: state.registry,
    permissionSettings: ALLOWED,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.toolCalls, 1);
  assert.equal(result.providerRounds, 2);
  assert.deepEqual(state.executions, [["workspace_test_read", { value: "ok" }]]);
  assert.deepEqual(outputItems(ai.calls[1]), [
    {
      kind: "functionCallOutput",
      callId: "call-1",
      output: '{"success":true,"data":{"value":"ok"},"truncated":false,"omittedCount":0}',
    },
  ]);
});

test("MockAIProvider 可确定性模拟调用后回复及 Provider 中途失败", async () => {
  const state = fixture();
  const mock = new MockAIProvider("success", [
    functionCalls(call("mock-call")),
    { kind: "final", content: "模拟完成" },
  ]);
  const result = await runAiToolLoop({
    request: request(),
    provider: mock,
    registry: state.registry,
    permissionSettings: ALLOWED,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.response.content, "模拟完成");

  const failedMock = new MockAIProvider("success", [
    functionCalls(call("mock-before-error")),
    new Error("internal sentinel"),
  ]);
  const failed = await runAiToolLoop({
    request: request(),
    provider: failedMock,
    registry: state.registry,
    permissionSettings: ALLOWED,
  });
  assert.equal(failed.code, "providerFailure");
  assert.doesNotMatch(failed.message, /internal sentinel/iu);
});

test("同轮多个调用按响应顺序执行；完全相同的参数只读取一次", async () => {
  const state = fixture();
  const ai = provider([
    functionCalls(call("call-1"), call("call-2", "workspace_test_read", '{ "value" : "ok" }')),
    { kind: "final", content: "已读取" },
  ]);
  const result = await runAiToolLoop({
    request: request(),
    provider: ai,
    registry: state.registry,
    permissionSettings: ALLOWED,
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(state.executions, [["workspace_test_read", { value: "ok" }]]);
  assert.equal(outputItems(ai.calls[1]).length, 2);
  assert.equal(outputItems(ai.calls[1])[0].output, outputItems(ai.calls[1])[1].output);
});

test("未知、未授权、JSON/Schema/Domain 无效和工具异常均安全失败且不执行", async () => {
  for (const [name, args, settings, expected] of [
    ["not_registered", "{}", ALLOWED, "UNKNOWN_TOOL"],
    ["workspace_test_read", '{"value":"ok"}', { persistentGrants: [] }, "PERMISSION_DENIED"],
    ["workspace_test_read", "{", ALLOWED, "INVALID_ARGUMENTS"],
    ["workspace_test_read", "{}", ALLOWED, "INVALID_ARGUMENTS"],
  ]) {
    const state = fixture();
    const ai = provider([
      functionCalls(call("call-1", name, args)),
      { kind: "final", content: "继续" },
    ]);
    await runAiToolLoop({
      request: request(),
      provider: ai,
      registry: state.registry,
      permissionSettings: settings,
    });
    const output = JSON.parse(outputItems(ai.calls[1])[0].output);
    assert.equal(output.error.code, expected);
    assert.deepEqual(state.executions, []);
  }

  const failureState = fixture({
    execute: () => {
      throw new Error("secret filesystem path C:\\private");
    },
  });
  const failureProvider = provider([
    functionCalls(call("call-fail")),
    { kind: "final", content: "已继续" },
  ]);
  await runAiToolLoop({
    request: request(),
    provider: failureProvider,
    registry: failureState.registry,
    permissionSettings: ALLOWED,
  });
  const safe = outputItems(failureProvider.calls[1])[0].output;
  assert.equal(JSON.parse(safe).error.code, "TOOL_FAILED");
  assert.doesNotMatch(safe, /filesystem|C:\\private|secret/iu);

  const domainAdapter = AI_TOOL_ADAPTERS.find(({ id }) => id === "academic.upcoming");
  assert.throws(
    () => domainAdapter.parseInput({ from: "2026-09-01", to: "2026-10-05" }),
    /horizon/u,
  );
  assert.throws(() => domainAdapter.parseInput({ from: "2026-09-01", limit: 5 }), /partial/u);
});

test("未提供 workflow proposal capability 时 Provider 伪造调用也不能执行", async () => {
  const planner = BUILT_IN_MODULES.find(({ id }) => id === "planner");
  const declaration = planner.aiTools.find(({ id }) => id === "planner.propose-task");
  const modules = createWorkplaceModuleRegistry([{ ...planner, aiTools: [declaration] }]);
  let executions = 0;
  const registry = createAiToolRegistry(
    [
      {
        id: declaration.id,
        parseInput: (value) => value,
        execute: () => {
          executions += 1;
          return { status: "reviewRequired", proposalId: "unexpected", proposalType: "task" };
        },
      },
    ],
    modules,
  );
  const ai = provider([
    functionCalls(
      call(
        "call-proposal",
        "planner_propose_task",
        JSON.stringify({ title: "任务", deadlineDate: null, deadlineTime: null, priority: "none" }),
      ),
    ),
  ]);
  const result = await runAiToolLoop({
    request: request(),
    provider: ai,
    registry,
    permissionSettings: ALLOWED,
  });
  assert.equal(result.status, "failed");
  assert.equal(executions, 0);
  assert.equal(ai.calls.length, 1);
});

test("输出 Schema 拒绝敏感哨兵；裁剪显式标记 truncated/omittedCount", async () => {
  const state = fixture({
    execute: (_declaration, input) => ({
      value: input.value,
      hiddenNotes: "DIARY_SENTINEL",
      path: "C:\\private",
      secret: "SECRET_SENTINEL",
    }),
  });
  const ai = provider([
    functionCalls(call("call-private")),
    { kind: "final", content: "安全错误" },
  ]);
  await runAiToolLoop({
    request: request(),
    provider: ai,
    registry: state.registry,
    permissionSettings: ALLOWED,
  });
  const serialized = outputItems(ai.calls[1])[0].output;
  assert.equal(JSON.parse(serialized).error.code, "OUTPUT_VALIDATION_FAILED");
  assert.doesNotMatch(serialized, /DIARY_SENTINEL|C:\\private|SECRET_SENTINEL/iu);

  const large = fixture({ execute: () => ({ value: "课程".repeat(5000) }) });
  const largeProvider = provider([
    functionCalls(call("call-large")),
    { kind: "final", content: "完成" },
  ]);
  await runAiToolLoop({
    request: request(),
    provider: largeProvider,
    registry: large.registry,
    permissionSettings: ALLOWED,
  });
  const output = JSON.parse(outputItems(largeProvider.calls[1])[0].output);
  assert.equal(output.success, true);
  assert.equal(output.truncated, true);
  assert.ok(output.omittedCount > 0);
  assert.ok(
    new TextEncoder().encode(outputItems(largeProvider.calls[1])[0].output).length <=
      AI_TOOL_LOOP_LIMITS.maxToolOutputBytes,
  );
});

test("Tool output 复用 context 脱敏规则，清除路径与 token/password 样式字符串", async () => {
  const state = fixture({
    execute: () => ({
      value: "token=FAKE_SECRET_SENTINEL at C:\\Users\\LinYu\\private\\sample.txt",
    }),
  });
  const ai = provider([functionCalls(call("call-redact")), { kind: "final", content: "安全" }]);
  await runAiToolLoop({
    request: request(),
    provider: ai,
    registry: state.registry,
    permissionSettings: ALLOWED,
  });
  const serialized = outputItems(ai.calls[1])[0].output;
  const value = JSON.parse(serialized).data.value;
  assert.match(value, /\[敏感值已省略\]/u);
  assert.match(value, /\[本地路径已省略\]/u);
  assert.doesNotMatch(serialized, /FAKE_SECRET_SENTINEL|C:\\Users\\LinYu|private\\sample/iu);
});

test("单次输出不超过 8 KiB，单请求输出总量不超过 24 KiB", async () => {
  const state = fixture({
    execute: (_declaration, input) => ({ value: `${input.value}: ${"x".repeat(7400)}` }),
  });
  const ai = provider([
    functionCalls(
      ...Array.from({ length: 4 }, (_, index) =>
        call(`budget-${index}`, "workspace_test_read", JSON.stringify({ value: String(index) })),
      ),
    ),
    { kind: "final", content: "已完成" },
  ]);
  const result = await runAiToolLoop({
    request: request(),
    provider: ai,
    registry: state.registry,
    permissionSettings: ALLOWED,
  });
  assert.equal(result.status, "completed");
  const outputs = outputItems(ai.calls[1]).map(({ output }) => output);
  assert.ok(
    outputs.every(
      (value) => new TextEncoder().encode(value).length <= AI_TOOL_LOOP_LIMITS.maxToolOutputBytes,
    ),
  );
  assert.ok(
    outputs.reduce((sum, value) => sum + new TextEncoder().encode(value).length, 0) <=
      AI_TOOL_LOOP_LIMITS.maxTotalToolOutputBytes,
  );
  assert.equal(JSON.parse(outputs[3]).error.code, "TOOL_LIMIT_EXCEEDED");
});

test("限制轮次、每轮/总调用数、重复 call_id 与 Provider 中途失败", async () => {
  const state = fixture();
  const tooMany = provider([
    functionCalls(...Array.from({ length: 5 }, (_, index) => call(`call-${index + 1}`))),
  ]);
  const perRound = await runAiToolLoop({
    request: request(),
    provider: tooMany,
    registry: state.registry,
    permissionSettings: ALLOWED,
  });
  assert.equal(perRound.status, "failed");
  assert.equal(perRound.code, "toolLoopLimitExceeded");
  assert.deepEqual(state.executions, []);

  const repeatedId = provider([functionCalls(call("duplicate-id"), call("duplicate-id"))]);
  const invalidIds = await runAiToolLoop({
    request: request(),
    provider: repeatedId,
    registry: state.registry,
    permissionSettings: ALLOWED,
  });
  assert.equal(invalidIds.code, "providerFailure");
  assert.deepEqual(state.executions, []);

  const everyRound = provider([
    functionCalls(call("r1")),
    functionCalls(call("r2")),
    functionCalls(call("r3")),
    functionCalls(call("r4")),
  ]);
  const rounds = await runAiToolLoop({
    request: request(),
    provider: everyRound,
    registry: state.registry,
    permissionSettings: ALLOWED,
  });
  assert.equal(rounds.code, "toolLoopLimitExceeded");
  assert.equal(rounds.providerRounds, AI_TOOL_LOOP_LIMITS.maxProviderRounds);
  assert.equal(rounds.toolCalls, 4);
  assert.equal(state.executions.length, 1);

  const eightCalls = [
    ...Array.from({ length: 4 }, (_, index) =>
      call(`total-${index}`, "workspace_test_read", JSON.stringify({ value: `first-${index}` })),
    ),
    ...Array.from({ length: 4 }, (_, index) =>
      call(
        `total-${index + 4}`,
        "workspace_test_read",
        JSON.stringify({ value: `second-${index}` }),
      ),
    ),
  ];
  const totalLimitProvider = provider([
    functionCalls(...eightCalls.slice(0, 4)),
    functionCalls(...eightCalls.slice(4)),
    functionCalls(
      call("total-overflow", "workspace_test_read", JSON.stringify({ value: "ninth" })),
    ),
  ]);
  const totalLimit = await runAiToolLoop({
    request: request(),
    provider: totalLimitProvider,
    registry: state.registry,
    permissionSettings: ALLOWED,
  });
  assert.equal(totalLimit.code, "toolLoopLimitExceeded");
  assert.equal(totalLimit.toolCalls, AI_TOOL_LOOP_LIMITS.maxToolCallsTotal);

  const midFailure = provider([
    functionCalls(call("before-failure")),
    new Error("provider internal response"),
  ]);
  const failed = await runAiToolLoop({
    request: request(),
    provider: midFailure,
    registry: state.registry,
    permissionSettings: ALLOWED,
  });
  assert.equal(failed.code, "providerFailure");
  assert.doesNotMatch(failed.message, /internal response/iu);
});

test("內置输入边界约束日期 horizon 与数量；JSON Schema 校验只接受约定结构", () => {
  const upcoming = workplaceModuleRegistry.aiTools.find(({ id }) => id === "academic.upcoming");
  assert.equal(validateJsonSchema({}, upcoming.inputSchema), true);
  assert.equal(
    validateJsonSchema({ from: "invalid", to: "2026-10-01" }, upcoming.inputSchema),
    false,
  );
  assert.equal(
    validateJsonSchema(
      { value: "x" },
      {
        ...TOOL_INPUT,
        properties: { value: { type: "string", pattern: "[" } },
      },
    ),
    false,
  );
  assert.equal(validateJsonSchema({ value: "x" }, { ...TOOL_INPUT, required: ["missing"] }), false);
  const adapter = AI_TOOL_ADAPTERS.find(({ id }) => id === "planner.schedule");
  assert.deepEqual(adapter.parseInput({ limit: 5 }), {
    from: adapter.parseInput({}).from,
    to: adapter.parseInput({}).to,
    limit: 5,
  });
  assert.throws(() => adapter.parseInput({ limit: 51 }), /limit/u);
});

test("工作流 read allowlist 在 Provider 工具暴露和执行时双重拒绝其他已授权读取工具", async () => {
  const declarations = [
    {
      id: "workspace.test",
      name: "workspace_test_read",
      moduleId: "workspace",
      order: 10,
      description: "允许的摘要",
      effect: "read",
      permissionIds: ["workspace.read"],
      inputSchema: TOOL_INPUT,
      outputSchema: TOOL_OUTPUT,
    },
    {
      id: "workspace.other",
      name: "workspace_other_read",
      moduleId: "workspace",
      order: 20,
      description: "工作流未开放的摘要",
      effect: "read",
      permissionIds: ["workspace.read"],
      inputSchema: TOOL_INPUT,
      outputSchema: TOOL_OUTPUT,
    },
  ];
  const state = fixture({ declarations });
  const mock = provider([
    functionCalls(call("forged-read", "workspace_other_read")),
    { kind: "final", content: "完成" },
  ]);
  const result = await runAiToolLoop({
    request: request(),
    provider: mock,
    registry: state.registry,
    permissionSettings: ALLOWED,
    allowedReadToolIds: ["workspace.test"],
  });

  assert.equal(result.status, "completed");
  assert.deepEqual(
    mock.calls[0].tools.map(({ name }) => name),
    ["workspace_test_read"],
  );
  assert.deepEqual(state.executions, []);
  const denied = JSON.parse(outputItems(mock.calls[1])[0].output);
  assert.equal(denied.error.code, "PERMISSION_DENIED");
});

test("Today 工作流的日期范围工具默认限制到本次时间窗并拒绝越界读取", async () => {
  const executed = [];
  const rangedTool = {
    id: "academic.upcoming",
    name: "academic_get_upcoming",
    moduleId: "academic",
    effect: "read",
    requiredPermission: "academic.read",
    inputSchema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: [],
      additionalProperties: false,
    },
    outputSchema: TOOL_OUTPUT,
    parseInput: (value) => value,
    async execute(value) {
      executed.push(value);
      return { value: "范围内摘要" };
    },
  };
  const registry = {
    tools: [rangedTool],
    getByName: (name) => (name === rangedTool.name ? rangedTool : undefined),
    getAvailable: (gate) => (gate.require("academic.read").allowed ? [rangedTool] : []),
  };
  const timeWindow = { from: "2026-09-26", to: "2026-10-02" };
  const defaultRangeProvider = provider([
    functionCalls(call("default-range", rangedTool.name, "{}")),
    { kind: "final", content: "完成" },
  ]);
  const bounded = await runAiToolLoop({
    request: request(),
    provider: defaultRangeProvider,
    registry,
    permissionSettings: { persistentGrants: ["academic.read"] },
    allowedReadToolIds: ["academic.upcoming"],
    allowedDateRange: timeWindow,
  });
  assert.equal(bounded.status, "completed");
  assert.deepEqual(executed, [timeWindow]);

  executed.length = 0;
  const outsideProvider = provider([
    functionCalls(
      call(
        "outside-range",
        rangedTool.name,
        JSON.stringify({ from: "2026-10-03", to: "2026-10-03" }),
      ),
    ),
    { kind: "final", content: "只能基于有限信息回答" },
  ]);
  const outside = await runAiToolLoop({
    request: request(),
    provider: outsideProvider,
    registry,
    permissionSettings: { persistentGrants: ["academic.read"] },
    allowedReadToolIds: ["academic.upcoming"],
    allowedDateRange: timeWindow,
  });
  assert.equal(outside.status, "completed");
  assert.equal(outside.failedToolCount, 1);
  assert.deepEqual(executed, []);
  assert.equal(
    JSON.parse(outputItems(outsideProvider.calls[1])[0].output).error.code,
    "PERMISSION_DENIED",
  );
});
