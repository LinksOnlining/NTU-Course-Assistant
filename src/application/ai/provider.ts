import type { AiCapabilityId } from "./capability.ts";
import type { AiProviderId, AiRequest, AiResponse } from "./types.ts";
import type { AiValueSchema } from "./tool.ts";

/** Provider 边界不包含网络、密钥存储或供应商 SDK。 */
export interface AIProvider {
  readonly id: AiProviderId;
  readonly capabilities: readonly AiCapabilityId[];
  generateText(request: AiRequest): Promise<AiResponse>;
  generateStructured<T>(request: AiRequest, schema: AiValueSchema<T>): Promise<T>;
  checkAvailability(): Promise<boolean>;
}
