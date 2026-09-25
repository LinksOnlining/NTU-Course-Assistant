import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MockAIProvider,
  canTransitionAiProposal,
  evaluateAiPermission,
} from "../../src/application/ai/index.ts";
import { workplaceModuleRegistry } from "../../src/modules/registry.ts";

const request = {
  id: "request-1",
  intent: "summarize",
  sourceModule: "workspace",
  createdAt: "2026-09-25T10:00:00.000Z",
  context: {
    selectedItems: [],
    moduleContexts: {},
    permissionScope: [],
  },
};

test("MockAIProvider 成功响应固定、离线且可替换", async () => {
  const provider = new MockAIProvider();
  assert.equal(await provider.checkAvailability(), true);
  assert.deepEqual(await provider.generateText(request), {
    id: "request-1:mock",
    providerId: "mock",
    content: "这是 Mock AI Provider 的固定测试回复。",
    createdAt: request.createdAt,
    metadata: { mock: true },
  });
  assert.deepEqual(provider.capabilities, [
    "ai.summary",
    "ai.planning",
    "ai.suggestion",
    "ai.classification",
  ]);
});

test("MockAIProvider 可模拟请求失败和不可用状态", async () => {
  const failed = new MockAIProvider("failure");
  assert.equal(await failed.checkAvailability(), true);
  await assert.rejects(failed.generateText(request), /模拟请求失败/u);

  const unavailable = new MockAIProvider("unavailable");
  assert.equal(await unavailable.checkAvailability(), false);
  await assert.rejects(unavailable.generateText(request), /当前不可用/u);
});

test("结构化 Provider 输出必须经由调用方 schema parser 校验", async () => {
  const schema = {
    parse(value) {
      assert.equal(typeof value.requestId, "string");
      assert.equal(typeof value.result, "string");
      return { result: value.result };
    },
  };
  assert.deepEqual(await new MockAIProvider().generateStructured(request, schema), {
    result: "这是 Mock AI Provider 的结构化测试结果。",
  });
});

test("AI 权限默认拒绝，propose/apply 始终要求确认", () => {
  const readPermission = workplaceModuleRegistry.permissions.find(
    ({ id }) => id === "planner.read",
  );
  const proposePermission = workplaceModuleRegistry.permissions.find(
    ({ id }) => id === "planner.propose",
  );
  assert.deepEqual(evaluateAiPermission(readPermission), {
    allowed: false,
    requiresConfirmation: false,
  });
  assert.deepEqual(evaluateAiPermission(readPermission, ["planner.read"]), {
    allowed: true,
    requiresConfirmation: false,
  });
  assert.deepEqual(evaluateAiPermission(proposePermission), {
    allowed: false,
    requiresConfirmation: true,
  });
  assert.deepEqual(evaluateAiPermission(proposePermission, ["planner.propose"]), {
    allowed: true,
    requiresConfirmation: true,
  });
  assert.deepEqual(
    evaluateAiPermission(
      {
        id: "planner.apply",
        moduleId: "planner",
        action: "apply",
        label: "应用规划建议",
        description: "仅供权限策略测试。",
      },
      ["planner.apply"],
    ),
    { allowed: true, requiresConfirmation: true },
  );
  assert.deepEqual(evaluateAiPermission(undefined, ["planner.propose"]), {
    allowed: false,
    requiresConfirmation: false,
  });
});

test("Proposal 状态只能沿显式审阅与确认路径流转", () => {
  assert.equal(canTransitionAiProposal("draft", "reviewRequired"), true);
  assert.equal(canTransitionAiProposal("reviewRequired", "approved"), true);
  assert.equal(canTransitionAiProposal("approved", "applied"), true);
  assert.equal(canTransitionAiProposal("draft", "applied"), false);
  assert.equal(canTransitionAiProposal("rejected", "approved"), false);
  assert.equal(canTransitionAiProposal("applied", "failed"), false);
  assert.equal(canTransitionAiProposal("approved", "stale"), true);
});
