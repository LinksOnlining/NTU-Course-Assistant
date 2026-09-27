import type { AiJsonObject } from "./tool.ts";
import { sanitizeAiText } from "./context-projector.ts";

export interface DailySummaryAiDraft {
  readonly overview: string;
  readonly highlights: readonly string[];
  readonly unfinished: readonly string[];
  readonly tomorrowNotes: readonly string[];
}

const summaryItemsSchema = Object.freeze({
  type: "array",
  maxItems: 8,
  items: Object.freeze({ type: "string", minLength: 1, maxLength: 180 }),
});

function parseSummaryItems(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 8) {
    throw new Error("Daily Summary list is invalid");
  }
  const items = value.map((item) => {
    if (typeof item !== "string") throw new Error("Daily Summary item is invalid");
    const text = sanitizeAiText(item)
      .replace(/\p{Cc}/gu, " ")
      .trim();
    if (!text || [...text].length > 180) throw new Error("Daily Summary item is invalid");
    return text;
  });
  return Object.freeze(items);
}

export const dailySummarySchema = Object.freeze({
  name: "daily_summary_v2",
  jsonSchema: Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["overview", "highlights", "unfinished", "tomorrowNotes"],
    properties: {
      overview: { type: "string", minLength: 1, maxLength: 500 },
      highlights: summaryItemsSchema,
      unfinished: summaryItemsSchema,
      tomorrowNotes: summaryItemsSchema,
    },
  }) as AiJsonObject,
  parse(value: unknown): DailySummaryAiDraft {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("Daily Summary result is invalid");
    }
    const candidate = value as Record<string, unknown>;
    const keys = ["overview", "highlights", "unfinished", "tomorrowNotes"];
    if (Object.keys(candidate).length !== keys.length || keys.some((key) => !(key in candidate))) {
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
    return Object.freeze({
      overview,
      highlights: parseSummaryItems(candidate.highlights),
      unfinished: parseSummaryItems(candidate.unfinished),
      tomorrowNotes: parseSummaryItems(candidate.tomorrowNotes),
    });
  },
});
