import type { ModuleId } from "../../modules/contracts.ts";
import type { AiContextBundle, AiJsonValue } from "./context.ts";

export type AiProviderId = "mock" | "deepseek";

export type AiIntent =
  | "summarize"
  | "plan"
  | "suggest"
  | "organize"
  | "rewrite"
  | "extract"
  | "reflect"
  | "todayAnalyze"
  | "todayPlan"
  | "diaryReflectSelected"
  | "inboxInterpretSelected"
  | "inboxProposeTask"
  | "inboxProposeEvent";

export interface AiRequest {
  readonly id: string;
  readonly intent: AiIntent;
  readonly sourceModule: ModuleId;
  readonly createdAt: string;
  /** 本次调用显式提供的文本；Phase 4.1 不会自动从 Workspace 收集上下文。 */
  readonly prompt: string;
  readonly context: AiContextBundle;
}

export interface AiResponse {
  readonly id: string;
  readonly providerId: AiProviderId;
  readonly content: string;
  readonly createdAt: string;
  readonly metadata: Readonly<Record<string, AiJsonValue>>;
}
