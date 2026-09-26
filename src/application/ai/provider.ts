import type { AiCapabilityId } from "./capability.ts";
import type { AiProviderId, AiRequest, AiResponse } from "./types.ts";
import type { AiJsonObject, AiValueSchema } from "./tool.ts";

export type AiToolChoice = "none" | "auto";

export type AiProviderToolInputItem =
  | { readonly kind: "message"; readonly role: "user"; readonly content: string }
  | {
      readonly kind: "functionCall";
      readonly callId: string;
      readonly name: string;
      readonly arguments: string;
    }
  | { readonly kind: "functionCallOutput"; readonly callId: string; readonly output: string };

export interface AiProviderFunctionDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: AiJsonObject;
}

export interface AiProviderToolTurnRequest {
  readonly id: string;
  readonly intent: AiRequest["intent"];
  readonly inputItems: readonly AiProviderToolInputItem[];
  readonly tools: readonly AiProviderFunctionDefinition[];
  readonly toolChoice: AiToolChoice;
}

export interface AiProviderFunctionCall {
  readonly callId: string;
  readonly name: string;
  /** Provider arguments are untrusted and intentionally remain an opaque string here. */
  readonly arguments: string;
}

export type AiProviderToolTurnResponse =
  | { readonly kind: "final"; readonly content: string }
  | { readonly kind: "functionCalls"; readonly calls: readonly AiProviderFunctionCall[] };

/** Provider-neutral contract；DeepSeek adapter 只委托专用 Native bridge 处理网络与凭据。 */
export interface AIProvider {
  readonly id: AiProviderId;
  readonly capabilities: readonly AiCapabilityId[];
  generateText(request: AiRequest): Promise<AiResponse>;
  generateStructured<T>(request: AiRequest, schema: AiValueSchema<T>): Promise<T>;
  generateToolTurn(request: AiProviderToolTurnRequest): Promise<AiProviderToolTurnResponse>;
  checkAvailability(): Promise<boolean>;
}
