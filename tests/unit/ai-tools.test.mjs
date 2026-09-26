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

test("生产 AIToolRegistry 只从 WorkspaceModuleRegistry 获取六个只读贡献且顺序稳定", () => {
  const definitions = workplaceModuleRegistry.aiTools;
  assert.equal(definitions.length, 6);
  assert.ok(definitions.every(({ effect }) => effect === "read"));
  assert.deepEqual(
    definitions.map(({ name }) => name),
    [
      "academic_get_upcoming",
      "planner_get_open_items",
      "routine_get_today",
      "weather_get_summary",
      "workspace_get_overview",
      "planner_get_schedule",
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
    !definitions.some(({ id, name }) => /diary|inbox|search|database|http/iu.test(`${id} ${name}`)),
  );
  const runtime = createAiToolRegistry(AI_TOOL_ADAPTERS);
  assert.deepEqual(
    runtime.tools.map(({ id }) => id),
    definitions.map(({ id }) => id),
  );
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

test("权限被关闭时下一请求立即过滤；proposal/mutation 始终不暴露或执行", async () => {
  const declaration = {
    id: "workspace.proposal-test",
    name: "workspace_proposal_test",
    moduleId: "workspace",
    order: 10,
    description: "禁止执行的 proposal",
    effect: "proposal",
    permissionIds: ["workspace.read"],
    inputSchema: TOOL_INPUT,
    outputSchema: TOOL_OUTPUT,
  };
  const state = fixture({ declarations: [declaration] });
  assert.deepEqual(state.registry.getAvailable({ require: () => ({ allowed: true }) }), []);
  const ai = provider([
    functionCalls(call("call-proposal", "workspace_proposal_test")),
    { kind: "final", content: "拒绝" },
  ]);
  await runAiToolLoop({
    request: request(),
    provider: ai,
    registry: state.registry,
    permissionSettings: ALLOWED,
  });
  assert.equal(JSON.parse(outputItems(ai.calls[1])[0].output).error.code, "PERMISSION_DENIED");
  assert.deepEqual(state.executions, []);
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
