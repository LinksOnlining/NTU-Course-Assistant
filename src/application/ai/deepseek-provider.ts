import { AI_CAPABILITY_IDS } from "./capability.ts";
import type {
  AIProvider,
  AiProviderToolTurnRequest,
  AiProviderToolTurnResponse,
} from "./provider.ts";
import type { AiValueSchema } from "./tool.ts";
import type { AiProviderId, AiRequest, AiResponse } from "./types.ts";
import type { AiProviderSettings } from "./settings.ts";
import type {
  AiNativeBridge,
  AiProviderErrorCode,
  AiProviderFailure,
  DeepSeekModel,
  NativeGenerationInput,
  NativeToolTurnInput,
  NativeToolTurnResult,
} from "../../types/ai-provider-bridge.ts";

export type {
  AiNativeBridge,
  AiProviderErrorCode,
  AiProviderFailure,
  DeepSeekModel,
  NativeGenerationInput,
  NativeStructuredGenerationInput,
  NativeToolTurnInput,
  NativeToolTurnResult,
  NativeTextResult,
} from "../../types/ai-provider-bridge.ts";

export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;
  readonly requestId?: string;

  constructor(failure: AiProviderFailure) {
    super(failure.message);
    this.name = "AiProviderError";
    this.code = failure.code;
    this.requestId = failure.requestId;
  }
}

function requestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replaceAll("-", "_")
    : `ai_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function providerError(caught: unknown): AiProviderError {
  if (
    typeof caught === "object" &&
    caught !== null &&
    "code" in caught &&
    "message" in caught &&
    typeof caught.code === "string" &&
    typeof caught.message === "string"
  ) {
    return new AiProviderError(caught as AiProviderFailure);
  }
  return new AiProviderError({ code: "unknown", message: "AI 服务发生未知错误。" });
}

export class DeepSeekProvider implements AIProvider {
  readonly id: AiProviderId = "deepseek";
  readonly capabilities = AI_CAPABILITY_IDS;
  private discoveredModels: readonly DeepSeekModel[] | null = null;
  private readonly native: AiNativeBridge;
  private readonly getSettings: () => AiProviderSettings;

  constructor(native: AiNativeBridge, getSettings: () => AiProviderSettings) {
    this.native = native;
    this.getSettings = getSettings;
  }

  async checkAvailability(): Promise<boolean> {
    try {
      return await this.native.getCredentialStatus();
    } catch {
      return false;
    }
  }

  getCredentialStatus(): Promise<boolean> {
    return this.native.getCredentialStatus();
  }

  async saveCredential(secret: string): Promise<boolean> {
    if (secret.trim() === "") {
      throw new AiProviderError({ code: "invalidRequest", message: "请输入 DeepSeek API Key。" });
    }
    try {
      return await this.native.setCredential(secret);
    } catch (caught: unknown) {
      throw providerError(caught);
    }
  }

  async deleteCredential(): Promise<boolean> {
    try {
      return await this.native.deleteCredential();
    } catch (caught: unknown) {
      throw providerError(caught);
    }
  }

  async testConnection(): Promise<readonly DeepSeekModel[]> {
    return this.refreshModels(12);
  }

  async refreshModels(timeoutSeconds = 12): Promise<readonly DeepSeekModel[]> {
    try {
      const models = await this.native.discoverModels(requestId(), timeoutSeconds);
      this.discoveredModels = models;
      return models;
    } catch (caught: unknown) {
      throw providerError(caught);
    }
  }

  async generateText(request: AiRequest): Promise<AiResponse> {
    const settings = this.generationSettings(request);
    try {
      const result = await this.native.generateText(settings);
      return Object.freeze({
        id: request.id,
        providerId: this.id,
        content: result.content,
        createdAt: result.createdAtEpochSeconds
          ? new Date(result.createdAtEpochSeconds * 1000).toISOString()
          : new Date().toISOString(),
        metadata: Object.freeze({
          model: result.model,
          ...(result.inputTokens === undefined ? {} : { inputTokens: result.inputTokens }),
          ...(result.outputTokens === undefined ? {} : { outputTokens: result.outputTokens }),
          ...(result.totalTokens === undefined ? {} : { totalTokens: result.totalTokens }),
        }),
      });
    } catch (caught: unknown) {
      throw providerError(caught);
    }
  }

  async generateStructured<Value>(
    request: AiRequest,
    schema: AiValueSchema<Value>,
  ): Promise<Value> {
    const settings = this.generationSettings(request);
    if (schema.name.trim() === "" || JSON.stringify(schema.jsonSchema).length > 64 * 1024) {
      throw new AiProviderError({ code: "invalidRequest", message: "结构化输出格式无效或过大。" });
    }
    try {
      const value = await this.native.generateStructured({
        ...settings,
        schemaName: schema.name,
        jsonSchema: schema.jsonSchema,
      });
      try {
        return schema.parse(value);
      } catch {
        throw new AiProviderError({
          code: "schemaMismatch",
          message: "DeepSeek 返回内容未通过本地结构校验。",
          requestId: request.id,
        });
      }
    } catch (caught: unknown) {
      throw providerError(caught);
    }
  }

  async generateToolTurn(request: AiProviderToolTurnRequest): Promise<AiProviderToolTurnResponse> {
    const settings = this.getSettings();
    if (
      request.id.trim() === "" ||
      request.id.length > 128 ||
      request.inputItems.length === 0 ||
      request.inputItems.length > 20 ||
      request.tools.length > 12 ||
      (request.toolChoice === "auto" && request.tools.length === 0)
    ) {
      throw new AiProviderError({ code: "invalidRequest", message: "AI 工具请求无效或过大。" });
    }
    const input: NativeToolTurnInput = {
      id: request.id,
      intent: request.intent,
      inputItems: request.inputItems,
      tools: request.tools,
      toolChoice: request.toolChoice,
      model: settings.selectedModel,
      requestTimeoutSeconds: settings.requestTimeoutSeconds,
    };
    try {
      const result: NativeToolTurnResult = await this.native.generateToolTurn(input);
      return result.kind === "final"
        ? { kind: "final", content: result.content }
        : {
            kind: "functionCalls",
            calls: result.calls.map((call) => ({
              callId: call.callId,
              name: call.name,
              arguments: call.arguments,
            })),
          };
    } catch (caught: unknown) {
      throw providerError(caught);
    }
  }

  private generationSettings(request: AiRequest): NativeGenerationInput {
    const settings = this.getSettings();
    if (
      request.id.trim() === "" ||
      request.prompt.trim() === "" ||
      request.prompt.length > 64 * 1024
    ) {
      throw new AiProviderError({ code: "invalidRequest", message: "AI 请求内容无效或过大。" });
    }
    if (settings.reasoningEffort !== "none") {
      const model = this.discoveredModels?.find(
        (candidate) => candidate.id === settings.selectedModel,
      );
      if (!model?.supportedEfforts?.includes(settings.reasoningEffort)) {
        throw new AiProviderError({
          code: "invalidRequest",
          message: "请先测试连接，并确认当前模型支持所选推理模式。",
          requestId: request.id,
        });
      }
    }
    return {
      id: request.id,
      intent: request.intent,
      prompt: request.prompt,
      model: settings.selectedModel,
      reasoningEffort: settings.reasoningEffort,
      requestTimeoutSeconds: settings.requestTimeoutSeconds,
    };
  }
}
