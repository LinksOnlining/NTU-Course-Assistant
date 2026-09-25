import type { ModuleId } from "../../modules/contracts.ts";
import type { AiContextBundle, AiJsonValue } from "./context.ts";

export type AiProviderId = "mock" | "openai";

export type AiIntent =
  "summarize" | "plan" | "suggest" | "organize" | "rewrite" | "extract" | "reflect";

export interface AiRequest {
  readonly id: string;
  readonly intent: AiIntent;
  readonly sourceModule: ModuleId;
  readonly createdAt: string;
  readonly context: AiContextBundle;
}

export interface AiResponse {
  readonly id: string;
  readonly providerId: AiProviderId;
  readonly content: string;
  readonly createdAt: string;
  readonly metadata: Readonly<Record<string, AiJsonValue>>;
}
