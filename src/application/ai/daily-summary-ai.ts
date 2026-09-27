import type { AiJsonObject } from "./tool.ts";
import { sanitizeAiText } from "./context-projector.ts";

export interface DailySummaryAiDraft {
  readonly overview: string;
}

export const dailySummarySchema = Object.freeze({
  name: "daily_summary_overview_v1",
  jsonSchema: Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["overview"],
    properties: { overview: { type: "string", minLength: 1, maxLength: 500 } },
  }) as AiJsonObject,
  parse(value: unknown): DailySummaryAiDraft {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("Daily Summary result is invalid");
    }
    const candidate = value as Record<string, unknown>;
    if (Object.keys(candidate).some((key) => key !== "overview")) {
      throw new Error("Daily Summary result has unexpected fields");
    }
    if (typeof candidate.overview !== "string" || !candidate.overview.trim()) {
      throw new Error("Daily Summary overview is invalid");
    }
    const overview = sanitizeAiText(candidate.overview)
      .replace(/\p{Cc}/gu, " ")
      .trim();
    if (!overview || [...overview].length > 500) {
      throw new Error("Daily Summary overview is invalid");
    }
    return Object.freeze({ overview });
  },
});
