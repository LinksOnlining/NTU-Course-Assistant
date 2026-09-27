import type { AiJsonObject } from "./tool.ts";
import type { AiPlannerProposalToolId } from "./tool-registry.ts";
import type { AiPersistentReadPermissionId } from "./permission.ts";
import type { AiIntent } from "./types.ts";
import { sanitizeAiText } from "./context-projector.ts";

export type AiWorkflowId =
  "today.analyze" | "today.plan" | "dailyBrief.generate" | "dailySummary.generate";
export type AiWorkflowRequestId = AiWorkflowId | "planner.route";
export type AiWorkflowResponseMode =
  "structured-analysis" | "proposal-plan" | "daily-brief" | "daily-summary";

export interface AiWorkflowDefinition {
  readonly id: AiWorkflowId;
  readonly intent: AiIntent;
  readonly requestedScopes: readonly AiPersistentReadPermissionId[];
  readonly allowedReadToolIds: readonly string[];
  readonly allowedProposalToolIds: readonly AiPlannerProposalToolId[];
  readonly responseMode: AiWorkflowResponseMode;
}

const TODAY_SCOPES = Object.freeze([
  "workspace.read",
  "academic.read",
  "planner.read",
  "routine.read",
  "weather.read",
] as const);

const READ_TOOLS = Object.freeze([
  "workspace.overview",
  "academic.upcoming",
  "planner.open-items",
  "planner.schedule",
  "routine.today",
  "weather.summary",
]);

export const TODAY_AI_WORKFLOWS: Readonly<Record<AiWorkflowId, AiWorkflowDefinition>> =
  Object.freeze({
    "today.analyze": Object.freeze({
      id: "today.analyze",
      intent: "todayAnalyze",
      requestedScopes: TODAY_SCOPES,
      allowedReadToolIds: READ_TOOLS,
      allowedProposalToolIds: Object.freeze([]) as readonly AiPlannerProposalToolId[],
      responseMode: "structured-analysis",
    }),
    "today.plan": Object.freeze({
      id: "today.plan",
      intent: "todayPlan",
      requestedScopes: TODAY_SCOPES,
      allowedReadToolIds: READ_TOOLS,
      allowedProposalToolIds: Object.freeze(["planner.propose-time-block"] as const),
      responseMode: "proposal-plan",
    }),
    "dailyBrief.generate": Object.freeze({
      id: "dailyBrief.generate",
      intent: "dailyBrief",
      requestedScopes: Object.freeze([
        "academic.read",
        "planner.read",
        "routine.read",
        "weather.read",
      ] as const),
      allowedReadToolIds: Object.freeze([]),
      allowedProposalToolIds: Object.freeze([]) as readonly AiPlannerProposalToolId[],
      responseMode: "daily-brief",
    }),
    "dailySummary.generate": Object.freeze({
      id: "dailySummary.generate",
      intent: "dailySummary",
      requestedScopes: Object.freeze(["academic.read", "planner.read", "routine.read"] as const),
      allowedReadToolIds: Object.freeze([]),
      allowedProposalToolIds: Object.freeze([]) as readonly AiPlannerProposalToolId[],
      responseMode: "daily-summary",
    }),
  });

export interface TodayAnalysisResult {
  readonly summary: string;
  readonly risks: readonly string[];
  readonly suggestions: readonly string[];
  readonly limitations: readonly string[];
}

function parseBoundedText(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("AI analysis text is invalid");
  }
  const normalized = sanitizeAiText(value)
    .replace(/\p{Cc}/gu, " ")
    .trim();
  if (normalized.length === 0) throw new Error("AI analysis text is invalid");
  if ([...normalized].length > maxLength) throw new Error("AI analysis text is too long");
  return normalized;
}

function parseTextList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 5) throw new Error("AI analysis list is invalid");
  return Object.freeze(value.map((item) => parseBoundedText(item, 240)));
}

export const todayAnalysisSchema = Object.freeze({
  name: "today_analysis_v1",
  jsonSchema: Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["summary", "risks", "suggestions", "limitations"],
    properties: {
      summary: { type: "string", minLength: 1, maxLength: 500 },
      risks: {
        type: "array",
        maxItems: 5,
        items: { type: "string", minLength: 1, maxLength: 240 },
      },
      suggestions: {
        type: "array",
        maxItems: 5,
        items: { type: "string", minLength: 1, maxLength: 240 },
      },
      limitations: {
        type: "array",
        maxItems: 5,
        items: { type: "string", minLength: 1, maxLength: 240 },
      },
    },
  }) as AiJsonObject,
  parse(value: unknown): TodayAnalysisResult {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("AI analysis result is invalid");
    }
    const candidate = value as Record<string, unknown>;
    const expectedKeys = ["summary", "risks", "suggestions", "limitations"];
    if (Object.keys(candidate).some((key) => !expectedKeys.includes(key))) {
      throw new Error("AI analysis result has unexpected fields");
    }
    return Object.freeze({
      summary: parseBoundedText(candidate.summary, 500),
      risks: parseTextList(candidate.risks),
      suggestions: parseTextList(candidate.suggestions),
      limitations: parseTextList(candidate.limitations),
    });
  },
});
