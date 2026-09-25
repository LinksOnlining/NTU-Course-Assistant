import { AI_CAPABILITY_IDS } from "./capability.ts";
import type { AIProvider } from "./provider.ts";
import type { AiRequest, AiResponse } from "./types.ts";
import type { AiValueSchema } from "./tool.ts";

export type MockAIProviderMode = "success" | "failure" | "unavailable";

/** 确定性离线 Provider，仅供架构和测试使用。 */
export class MockAIProvider implements AIProvider {
  readonly id = "mock" as const;
  readonly capabilities = AI_CAPABILITY_IDS;
  private readonly mode: MockAIProviderMode;

  constructor(mode: MockAIProviderMode = "success") {
    this.mode = mode;
  }

  async checkAvailability(): Promise<boolean> {
    return this.mode !== "unavailable";
  }

  async generateText(request: AiRequest): Promise<AiResponse> {
    this.assertRequestAvailable();
    return Object.freeze({
      id: `${request.id}:mock`,
      providerId: this.id,
      content: "这是 Mock AI Provider 的固定测试回复。",
      createdAt: request.createdAt,
      metadata: Object.freeze({ mock: true }),
    });
  }

  async generateStructured<Value>(
    request: AiRequest,
    schema: AiValueSchema<Value>,
  ): Promise<Value> {
    this.assertRequestAvailable();
    return schema.parse({
      requestId: request.id,
      result: "这是 Mock AI Provider 的结构化测试结果。",
    });
  }

  private assertRequestAvailable(): void {
    if (this.mode === "unavailable") throw new Error("Mock AI Provider 当前不可用。");
    if (this.mode === "failure") throw new Error("Mock AI Provider 模拟请求失败。");
  }
}
