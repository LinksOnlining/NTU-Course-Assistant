import assert from "node:assert/strict";
import { test } from "node:test";
import { DeepSeekProvider, AiProviderError } from "../../src/application/ai/deepseek-provider.ts";
import {
  DEFAULT_AI_PROVIDER_SETTINGS,
  normalizeAiProviderSettings,
} from "../../src/application/ai/settings.ts";
import {
  AI_PROVIDER_SETTINGS_KEY,
  loadAiProviderSettingsRecord,
  saveAiProviderSettingsRecord,
} from "../../src/services/ai-provider-settings-storage.ts";

const SENTINEL = "phase41-secret-sentinel";
const request = {
  id: "request_41",
  intent: "summarize",
  sourceModule: "workspace",
  createdAt: "2026-09-26T10:00:00.000Z",
  prompt: "仅此显式文本可发送",
  context: {
    selectedItems: [{ moduleId: "diary", objectId: "private-entry" }],
    moduleContexts: { diary: { body: "绝不能自动发送的私密正文" } },
    permissionScope: [],
  },
};

function bridge(overrides = {}) {
  const calls = [];
  return {
    calls,
    async getCredentialStatus() {
      calls.push(["status"]);
      return false;
    },
    async setCredential(secret) {
      calls.push(["set", secret]);
      return true;
    },
    async deleteCredential() {
      calls.push(["delete"]);
      return true;
    },
    async discoverModels(requestId, timeoutSeconds) {
      calls.push(["models", requestId, timeoutSeconds]);
      return [{ id: "deepseek-flash", supportedEfforts: ["low", "high", "max"] }];
    },
    async generateText(input) {
      calls.push(["text", input]);
      return { content: "已规范化回答", model: input.model, inputTokens: 2 };
    },
    async generateStructured(input) {
      calls.push(["structured", input]);
      return { answer: "已校验" };
    },
    async generateToolTurn(input) {
      calls.push(["toolTurn", input]);
      return { kind: "final", content: "工具调用循环完成", model: input.model };
    },
    ...overrides,
  };
}

function settings(overrides = {}) {
  return { ...DEFAULT_AI_PROVIDER_SETTINGS, ...overrides };
}

test("AI 设置损坏时回退默认值，且模型、推理和超时均有边界", () => {
  assert.deepEqual(normalizeAiProviderSettings(null), DEFAULT_AI_PROVIDER_SETTINGS);
  assert.deepEqual(
    normalizeAiProviderSettings({
      providerId: "arbitrary",
      selectedModel: "old-model",
      reasoningEffort: "extreme",
      requestTimeoutSeconds: 999,
    }),
    DEFAULT_AI_PROVIDER_SETTINGS,
  );
  assert.deepEqual(
    normalizeAiProviderSettings({
      selectedModel: "deepseek-v4-pro",
      reasoningEffort: "high",
      requestTimeoutSeconds: 45,
    }),
    {
      providerId: "deepseek",
      selectedModel: "deepseek-v4-pro",
      reasoningEffort: "high",
      requestTimeoutSeconds: 45,
    },
  );
});

test("本地设置只保存非敏感配置，永不持久化 API Key", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const configured = { ...settings({ selectedModel: "deepseek-v4-pro" }), apiKey: SENTINEL };
  assert.equal(saveAiProviderSettingsRecord(configured, storage), true);
  const serialized = values.get(AI_PROVIDER_SETTINGS_KEY);
  assert.ok(serialized);
  assert.equal(serialized.includes(SENTINEL), false);
  assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), [
    "providerId",
    "reasoningEffort",
    "requestTimeoutSeconds",
    "selectedModel",
  ]);
  assert.equal(
    normalizeAiProviderSettings(loadAiProviderSettingsRecord(storage)).selectedModel,
    "deepseek-v4-pro",
  );
});

test("打开 Provider availability 只读凭据状态，不发网络请求", async () => {
  const native = bridge();
  const provider = new DeepSeekProvider(native, () => settings());
  assert.equal(await provider.checkAvailability(), false);
  assert.deepEqual(native.calls, [["status"]]);
});

test("测试连接只请求模型列表，不发送 prompt 或 Workspace 上下文", async () => {
  const native = bridge();
  const provider = new DeepSeekProvider(native, () => settings());
  const models = await provider.testConnection();
  assert.deepEqual(
    models.map(({ id }) => id),
    ["deepseek-flash"],
  );
  assert.equal(native.calls.length, 1);
  assert.equal(native.calls[0][0], "models");
  assert.equal(JSON.stringify(native.calls).includes("私密正文"), false);
  assert.equal(JSON.stringify(native.calls).includes("prompt"), false);
});

test("文本生成只传显式 prompt，且响应收敛到 Application DTO", async () => {
  const native = bridge();
  const provider = new DeepSeekProvider(native, () => settings());
  const response = await provider.generateText(request);
  assert.equal(response.providerId, "deepseek");
  assert.equal(response.content, "已规范化回答");
  assert.deepEqual(response.metadata, { model: "deepseek-flash", inputTokens: 2 });
  assert.deepEqual(native.calls[0], [
    "text",
    {
      id: request.id,
      intent: request.intent,
      prompt: request.prompt,
      model: "deepseek-flash",
      reasoningEffort: "none",
      requestTimeoutSeconds: 30,
    },
  ]);
  assert.equal(JSON.stringify(native.calls).includes("私密正文"), false);
});

test("结构化输出通过调用方本地解析器二次校验", async () => {
  const native = bridge();
  const provider = new DeepSeekProvider(native, () => settings());
  const schema = {
    name: "short_answer",
    jsonSchema: { type: "object", properties: { answer: { type: "string" } } },
    parse(value) {
      if (typeof value?.answer !== "string") throw new Error("invalid");
      return { answer: value.answer };
    },
  };
  assert.deepEqual(await provider.generateStructured(request, schema), { answer: "已校验" });
  assert.equal(native.calls[0][1].schemaName, "short_answer");
  const invalidProvider = new DeepSeekProvider(
    bridge({
      async generateStructured() {
        return { answer: 4 };
      },
    }),
    () => settings(),
  );
  await assert.rejects(invalidProvider.generateStructured(request, schema), (error) => {
    assert.ok(error instanceof AiProviderError);
    assert.equal(error.code, "schemaMismatch");
    return true;
  });
});

test("Tool adapter 只传显式 user prompt 与 provider-neutral function transcript，且固定当前模型/超时", async () => {
  const native = bridge();
  const provider = new DeepSeekProvider(native, () => settings({ reasoningEffort: "max" }));
  const result = await provider.generateToolTurn({
    id: "request_tool",
    intent: "summarize",
    inputItems: [
      { kind: "message", role: "user", content: request.prompt },
      { kind: "functionCall", callId: "call_1", name: "workspace_get_overview", arguments: "{}" },
      { kind: "functionCallOutput", callId: "call_1", output: '{"success":true}' },
    ],
    tools: [
      {
        name: "workspace_get_overview",
        description: "读取摘要",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    ],
    toolChoice: "auto",
  });
  assert.deepEqual(result, { kind: "final", content: "工具调用循环完成" });
  assert.equal(native.calls[0][0], "toolTurn");
  assert.deepEqual(native.calls[0][1], {
    id: "request_tool",
    intent: "summarize",
    inputItems: [
      { kind: "message", role: "user", content: request.prompt },
      { kind: "functionCall", callId: "call_1", name: "workspace_get_overview", arguments: "{}" },
      { kind: "functionCallOutput", callId: "call_1", output: '{"success":true}' },
    ],
    tools: [
      {
        name: "workspace_get_overview",
        description: "读取摘要",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    ],
    toolChoice: "auto",
    model: "deepseek-flash",
    requestTimeoutSeconds: 30,
  });
  assert.equal(JSON.stringify(native.calls).includes("私密正文"), false);
});

test("不支持的推理级别在调用 Native 前拒绝，失败不暴露凭据", async () => {
  const native = bridge();
  const provider = new DeepSeekProvider(native, () => settings({ reasoningEffort: "high" }));
  await assert.rejects(provider.generateText(request), (error) => error.code === "invalidRequest");
  assert.deepEqual(native.calls, []);

  const failed = new DeepSeekProvider(
    bridge({
      async setCredential() {
        throw { code: "credentialStoreUnavailable", message: "安全凭据服务不可用" };
      },
    }),
    () => settings(),
  );
  await assert.rejects(failed.saveCredential(SENTINEL), (error) => {
    assert.equal(error.message.includes(SENTINEL), false);
    assert.equal(JSON.stringify(error).includes(SENTINEL), false);
    return true;
  });
});
