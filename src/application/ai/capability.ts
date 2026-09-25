import type { AICapabilityContribution } from "../../modules/contracts.ts";
import type { AiPermissionId } from "./permission.ts";

export const AI_CAPABILITY_IDS = [
  "ai.summary",
  "ai.planning",
  "ai.suggestion",
  "ai.classification",
] as const;

export type AiCapabilityId = (typeof AI_CAPABILITY_IDS)[number];

export type AiCapability = Omit<
  AICapabilityContribution,
  "id" | "moduleId" | "requiredPermissions"
> & {
  readonly id: AiCapabilityId;
  readonly moduleId: "ai";
  readonly requiredPermissions: readonly AiPermissionId[];
};
