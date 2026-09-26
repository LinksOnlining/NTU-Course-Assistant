export type AiReasoningEffort = "none" | "low" | "high" | "max";
export type AiModelId = "deepseek-flash" | "deepseek-v4-pro";

export interface AiProviderSettings {
  readonly providerId: "deepseek";
  readonly selectedModel: AiModelId;
  readonly reasoningEffort: AiReasoningEffort;
  readonly requestTimeoutSeconds: number;
}

export const DEFAULT_AI_PROVIDER_SETTINGS: AiProviderSettings = Object.freeze({
  providerId: "deepseek",
  selectedModel: "deepseek-flash",
  reasoningEffort: "none",
  requestTimeoutSeconds: 30,
});

export const AI_MODEL_IDS: readonly AiModelId[] = ["deepseek-flash", "deepseek-v4-pro"];
export const AI_REASONING_EFFORTS: readonly AiReasoningEffort[] = ["none", "low", "high", "max"];

export function normalizeAiProviderSettings(value: unknown): AiProviderSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_AI_PROVIDER_SETTINGS;
  }
  const candidate = value as Record<string, unknown>;
  const selectedModel = AI_MODEL_IDS.includes(candidate.selectedModel as AiModelId)
    ? (candidate.selectedModel as AiModelId)
    : DEFAULT_AI_PROVIDER_SETTINGS.selectedModel;
  const reasoningEffort = AI_REASONING_EFFORTS.includes(
    candidate.reasoningEffort as AiReasoningEffort,
  )
    ? (candidate.reasoningEffort as AiReasoningEffort)
    : DEFAULT_AI_PROVIDER_SETTINGS.reasoningEffort;
  const timeout = candidate.requestTimeoutSeconds;
  const requestTimeoutSeconds =
    typeof timeout === "number" && Number.isInteger(timeout) && timeout >= 5 && timeout <= 120
      ? timeout
      : DEFAULT_AI_PROVIDER_SETTINGS.requestTimeoutSeconds;
  return {
    providerId: "deepseek",
    selectedModel,
    reasoningEffort,
    requestTimeoutSeconds,
  };
}
