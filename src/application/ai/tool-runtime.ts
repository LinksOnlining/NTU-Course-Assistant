import type { AiRequest, AiResponse } from "./types.ts";
import { AiPermissionGate } from "./permission.ts";
import type { AiDataAccessSettings } from "./permission.ts";
import type { AIProvider, AiProviderFunctionCall, AiProviderToolInputItem } from "./provider.ts";
import type { AiToolDefinition, AiToolErrorCode, AiToolResult } from "./tool.ts";
import type { AiJsonValue } from "./context.ts";
import { sanitizeAiText } from "./context-projector.ts";
import { validateJsonSchema, type AiToolRegistry } from "./tool-registry.ts";

export const AI_TOOL_LOOP_LIMITS = Object.freeze({
  maxProviderRounds: 4,
  maxToolCallsTotal: 8,
  maxToolCallsPerRound: 4,
  maxToolOutputBytes: 8 * 1024,
  maxTotalToolOutputBytes: 24 * 1024,
  maxArgumentsBytes: 8 * 1024,
});

export type AiToolLoopResult =
  | {
      readonly status: "completed";
      readonly response: AiResponse;
      readonly providerRounds: number;
      readonly toolCalls: number;
      readonly toolNames: readonly string[];
    }
  | {
      readonly status: "failed";
      readonly code: "toolLoopLimitExceeded" | "providerFailure";
      readonly message: string;
      readonly providerRounds: number;
      readonly toolCalls: number;
    };

export async function runAiToolLoop(input: {
  readonly request: AiRequest;
  readonly provider: AIProvider;
  readonly registry: AiToolRegistry;
  readonly permissionSettings: AiDataAccessSettings | unknown;
}): Promise<AiToolLoopResult> {
  const gate = new AiPermissionGate({
    settings: input.permissionSettings,
    requestId: input.request.id,
  });
  const available = input.registry.getAvailable(gate);
  const providerTools = available.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }));
  const inputItems: AiProviderToolInputItem[] = [
    { kind: "message", role: "user", content: input.request.prompt },
  ];
  const executedCache = new Map<string, string>();
  const seenCallIds = new Set<string>();
  const toolNames: string[] = [];
  let totalCalls = 0;
  let totalOutputBytes = 0;

  for (let round = 1; round <= AI_TOOL_LOOP_LIMITS.maxProviderRounds; round += 1) {
    let turn;
    try {
      turn = await input.provider.generateToolTurn({
        id: input.request.id,
        intent: input.request.intent,
        inputItems,
        tools: providerTools,
        toolChoice: providerTools.length ? "auto" : "none",
      });
    } catch {
      return {
        status: "failed",
        code: "providerFailure",
        message: "AI 服务本轮请求失败，请稍后重试。",
        providerRounds: round,
        toolCalls: totalCalls,
      };
    }

    if (turn.kind === "final") {
      const response: AiResponse = Object.freeze({
        id: input.request.id,
        providerId: input.provider.id,
        content: turn.content,
        createdAt: input.request.createdAt,
        metadata: Object.freeze({
          toolRounds: round,
          toolCalls: totalCalls,
          toolNames: Object.freeze([...new Set(toolNames)]),
          toolReasoning: "none",
        }),
      });
      return {
        status: "completed",
        response,
        providerRounds: round,
        toolCalls: totalCalls,
        toolNames: Object.freeze([...new Set(toolNames)]),
      };
    }

    const calls = turn.calls;
    if (
      calls.length === 0 ||
      calls.length > AI_TOOL_LOOP_LIMITS.maxToolCallsPerRound ||
      totalCalls + calls.length > AI_TOOL_LOOP_LIMITS.maxToolCallsTotal
    ) {
      return limitFailure(round, totalCalls);
    }

    for (const call of calls) {
      if (!validCallId(call.callId) || seenCallIds.has(call.callId)) {
        return {
          status: "failed",
          code: "providerFailure",
          message: "AI 服务返回了无效的函数调用编号。",
          providerRounds: round,
          toolCalls: totalCalls,
        };
      }
      seenCallIds.add(call.callId);
    }

    totalCalls += calls.length;
    for (const call of calls) {
      inputItems.push({
        kind: "functionCall",
        callId: call.callId,
        name: call.name,
        arguments: call.arguments,
      });
    }
    for (const call of calls) {
      const result = await executeCall(call, input.registry, gate, executedCache);
      toolNames.push(call.name);
      let serialized = result.serialized;
      let bytes = utf8Bytes(serialized);
      if (bytes + totalOutputBytes > AI_TOOL_LOOP_LIMITS.maxTotalToolOutputBytes) {
        serialized = serializeFailure("TOOL_LIMIT_EXCEEDED", "本次工具结果已达到安全上限。");
        bytes = utf8Bytes(serialized);
      }
      if (
        bytes > AI_TOOL_LOOP_LIMITS.maxToolOutputBytes ||
        bytes + totalOutputBytes > AI_TOOL_LOOP_LIMITS.maxTotalToolOutputBytes
      ) {
        return limitFailure(round, totalCalls);
      }
      totalOutputBytes += bytes;
      inputItems.push({ kind: "functionCallOutput", callId: call.callId, output: serialized });
    }

    if (round === AI_TOOL_LOOP_LIMITS.maxProviderRounds) return limitFailure(round, totalCalls);
  }

  return limitFailure(AI_TOOL_LOOP_LIMITS.maxProviderRounds, totalCalls);
}

async function executeCall(
  call: AiProviderFunctionCall,
  registry: AiToolRegistry,
  gate: AiPermissionGate,
  cache: Map<string, string>,
): Promise<{ readonly serialized: string }> {
  const tool = registry.getByName(call.name);
  if (!tool) return { serialized: serializeFailure("UNKNOWN_TOOL", "未知的只读工具。") };
  if (utf8Bytes(call.arguments) > AI_TOOL_LOOP_LIMITS.maxArgumentsBytes) {
    return { serialized: serializeFailure("INVALID_ARGUMENTS", "工具参数无效。") };
  }

  let parsed: unknown;
  let normalized: unknown;
  try {
    parsed = JSON.parse(call.arguments) as unknown;
    if (!validateJsonSchema(parsed, tool.inputSchema)) {
      return { serialized: serializeFailure("INVALID_ARGUMENTS", "工具参数未通过格式校验。") };
    }
    normalized = tool.parseInput(parsed);
  } catch {
    return { serialized: serializeFailure("INVALID_ARGUMENTS", "工具参数无效。") };
  }

  if (tool.effect !== "read" || !gate.require(tool.requiredPermission).allowed) {
    return { serialized: serializeFailure("PERMISSION_DENIED", "当前请求未获准读取此类数据。") };
  }
  const fingerprint = `${tool.name}:${stableStringify(normalized)}`;
  const cached = cache.get(fingerprint);
  if (cached !== undefined) return { serialized: cached };

  let output: unknown;
  try {
    output = await tool.execute(normalized);
  } catch {
    return { serialized: serializeFailure("TOOL_FAILED", "读取应用数据失败。") };
  }
  const sanitizedOutput = sanitizeJsonValue(output);
  if (!validateJsonSchema(sanitizedOutput, tool.outputSchema)) {
    return { serialized: serializeFailure("OUTPUT_VALIDATION_FAILED", "工具结果未通过安全校验。") };
  }
  const serialized = fitSuccessResult(
    sanitizedOutput,
    tool,
    AI_TOOL_LOOP_LIMITS.maxToolOutputBytes,
  );
  cache.set(fingerprint, serialized);
  return { serialized };
}

function fitSuccessResult(value: unknown, tool: AiToolDefinition, maxBytes: number): string {
  const data = cloneJson(value) as AiJsonValue;
  let omittedCount = 0;
  const serialize = () =>
    JSON.stringify({
      success: true,
      data,
      truncated: omittedCount > 0,
      omittedCount,
    } satisfies AiToolResult);
  while (utf8Bytes(serialize()) > maxBytes) {
    const arrays = collectArrays(data);
    const largest = arrays.sort(
      (left, right) =>
        right.value.length - left.value.length || left.path.localeCompare(right.path),
    )[0];
    if (largest && largest.value.length > 0) {
      largest.value.pop();
      omittedCount += 1;
      continue;
    }
    const strings = collectStrings(data).sort(
      (left, right) =>
        right.value.length - left.value.length || left.path.localeCompare(right.path),
    );
    const longest = strings[0];
    if (!longest || longest.value.length <= 8) {
      return serializeFailure("TOOL_FAILED", "读取结果超过安全输出上限。");
    }
    const nextLength = Math.max(8, Math.floor(longest.value.length * 0.75));
    const removed = [...longest.value].length - nextLength;
    longest.set(Array.from(longest.value).slice(0, nextLength).join(""));
    omittedCount += removed;
  }
  if (!validateJsonSchema(data, tool.outputSchema)) {
    return serializeFailure("OUTPUT_VALIDATION_FAILED", "裁剪后的工具结果未通过安全校验。");
  }
  return serialize();
}

function collectArrays(
  value: unknown,
  path = "$",
  result: { value: unknown[]; path: string }[] = [],
) {
  if (Array.isArray(value)) {
    result.push({ value, path });
    value.forEach((item, index) => collectArrays(item, `${path}[${index}]`, result));
  } else if (isRecord(value)) {
    for (const key of Object.keys(value).sort())
      collectArrays(value[key], `${path}.${key}`, result);
  }
  return result;
}

function collectStrings(
  value: unknown,
  path = "$",
  result: { value: string; path: string; set: (next: string) => void }[] = [],
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStrings(item, `${path}[${index}]`, result));
  } else if (isRecord(value)) {
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (typeof item === "string")
        result.push({
          value: item,
          path: `${path}.${key}`,
          set: (next) => {
            value[key] = next;
          },
        });
      else collectStrings(item, `${path}.${key}`, result);
    }
  }
  return result;
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeAiText(value);
  if (Array.isArray(value)) return value.map(sanitizeJsonValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeJsonValue(item)]),
    );
  }
  return value;
}

function serializeFailure(code: AiToolErrorCode, message: string): string {
  return JSON.stringify({ success: false, error: { code, message } } satisfies AiToolResult);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function validCallId(value: string): boolean {
  return (
    value.trim().length > 0 &&
    value.length <= 128 &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}

function limitFailure(round: number, toolCalls: number): AiToolLoopResult {
  return {
    status: "failed",
    code: "toolLoopLimitExceeded",
    message: "本次 AI 工具调用已达到安全上限。",
    providerRounds: round,
    toolCalls,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
