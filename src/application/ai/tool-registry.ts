import { workplaceModuleRegistry, type WorkplaceModuleRegistry } from "../../modules/registry.ts";
import type { AIToolContribution, AIToolJsonSchema } from "../../modules/contracts.ts";
import type { AiPermissionId } from "./permission.ts";
import type { AiToolDefinition, AiToolEffect, AiToolExecutionContext } from "./tool.ts";

const SCHEMA_TYPES = new Set(["object", "array", "string", "integer", "number", "boolean", "null"]);

export interface AiToolAdapter<Input = unknown, Output = unknown> {
  readonly id: string;
  parseInput(value: unknown): Input;
  execute(input: Input, context?: AiToolExecutionContext): Promise<Output> | Output;
}

export const AI_PLANNER_PROPOSAL_TOOL_IDS = Object.freeze([
  "planner.propose-task",
  "planner.propose-event",
  "planner.propose-time-block",
] as const);

export type AiPlannerProposalToolId = (typeof AI_PLANNER_PROPOSAL_TOOL_IDS)[number];

export function isPlannerProposalToolId(value: string): value is AiPlannerProposalToolId {
  return (AI_PLANNER_PROPOSAL_TOOL_IDS as readonly string[]).includes(value);
}

export interface AiProposalToolPolicy {
  /** One request's explicit module-level proposal consent; defaults to deny. */
  readonly grantedPermissionIds: readonly string[];
  /** Workflow capability allowlist; prevents unrelated proposal tools being exposed. */
  readonly allowedToolIds: readonly AiPlannerProposalToolId[];
}

export interface AiToolRegistry {
  readonly tools: readonly AiToolDefinition[];
  getByName(name: string): AiToolDefinition | undefined;
  getAvailable(
    permissionGate: {
      require(id: string): { allowed: boolean };
    },
    proposalPolicy?: AiProposalToolPolicy,
  ): readonly AiToolDefinition[];
}

export function createAiToolRegistry(
  adapters: readonly AiToolAdapter[],
  modules: WorkplaceModuleRegistry = workplaceModuleRegistry,
): AiToolRegistry {
  const adapterById = new Map<string, AiToolAdapter>();
  for (const adapter of adapters) {
    if (adapterById.has(adapter.id)) throw new Error(`Duplicate AI tool adapter: ${adapter.id}`);
    adapterById.set(adapter.id, adapter);
  }

  const ids = new Set<string>();
  const names = new Set<string>();
  const tools = modules.aiTools.map((contribution) => {
    validateContribution(contribution, modules);
    if (ids.has(contribution.id)) throw new Error(`Duplicate AI tool id: ${contribution.id}`);
    if (names.has(contribution.name)) {
      throw new Error(`Duplicate AI tool provider name: ${contribution.name}`);
    }
    ids.add(contribution.id);
    names.add(contribution.name);
    const adapter = adapterById.get(contribution.id);
    if (!adapter) throw new Error(`Missing AI tool adapter: ${contribution.id}`);
    return Object.freeze({
      id: contribution.id,
      name: contribution.name,
      moduleId: contribution.moduleId,
      description: contribution.description,
      effect: contribution.effect as AiToolEffect,
      requiredPermission: contribution.permissionIds[0] as AiPermissionId,
      inputSchema: contribution.inputSchema,
      outputSchema: contribution.outputSchema,
      parseInput: adapter.parseInput.bind(adapter),
      execute: (input: unknown, context?: AiToolExecutionContext) =>
        Promise.resolve(adapter.execute(input, context)),
    } satisfies AiToolDefinition);
  });

  if (adapterById.size !== tools.length) {
    const extras = [...adapterById.keys()].filter((id) => !ids.has(id));
    throw new Error(`Unregistered AI tool adapter: ${extras[0] ?? "unknown"}`);
  }

  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return Object.freeze({
    tools: Object.freeze(tools),
    getByName: (name: string) => byName.get(name),
    getAvailable: (
      permissionGate: { require(id: string): { allowed: boolean } },
      proposalPolicy?: AiProposalToolPolicy,
    ) =>
      Object.freeze(
        tools.filter((tool) => {
          if (modules.getModuleState(tool.moduleId)?.available !== true) return false;
          if (tool.effect === "read")
            return permissionGate.require(tool.requiredPermission).allowed;
          if (tool.effect !== "proposal" || tool.requiredPermission !== "planner.propose") {
            return false;
          }
          return (
            proposalPolicy?.grantedPermissionIds.includes("planner.propose") === true &&
            isPlannerProposalToolId(tool.id) &&
            proposalPolicy.allowedToolIds.includes(tool.id)
          );
        }),
      ),
  });
}

function validateContribution(
  contribution: AIToolContribution,
  modules: WorkplaceModuleRegistry,
): void {
  if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(contribution.name)) {
    throw new Error(`Invalid AI tool provider name: ${contribution.name}`);
  }
  if (contribution.permissionIds.length !== 1) {
    throw new Error(`AI tool must declare exactly one permission: ${contribution.id}`);
  }
  const permission = modules.permissions.find((item) => item.id === contribution.permissionIds[0]);
  if (!permission || permission.moduleId !== contribution.moduleId) {
    throw new Error(
      `AI tool permission is unknown or belongs to another module: ${contribution.id}`,
    );
  }
  if (contribution.effect === "read" && permission.action !== "read") {
    throw new Error(`Read AI tool must use a read permission: ${contribution.id}`);
  }
  if (
    contribution.effect === "proposal" &&
    (contribution.moduleId !== "planner" ||
      contribution.permissionIds[0] !== "planner.propose" ||
      permission.action !== "propose")
  ) {
    throw new Error(`Planner proposal tool must use planner.propose: ${contribution.id}`);
  }
  if (contribution.effect === "mutation" || contribution.effect === "write") {
    throw new Error(`AI mutation tools are not executable: ${contribution.id}`);
  }
  if (!isJsonSchema(contribution.inputSchema) || !isJsonSchema(contribution.outputSchema)) {
    throw new Error(`Invalid AI tool schema: ${contribution.id}`);
  }
}

function isJsonSchema(value: AIToolJsonSchema): boolean {
  if (!isRecord(value) || value.type !== "object") {
    return false;
  }
  try {
    if (JSON.stringify(value).length > 32 * 1024) return false;
  } catch {
    return false;
  }
  const properties = value.properties;
  const required = value.required;
  if (properties !== undefined && !isRecord(properties)) return false;
  if (
    required !== undefined &&
    (!Array.isArray(required) ||
      !required.every((key) => isString(key) && isRecord(properties) && key in properties))
  ) {
    return false;
  }
  return Object.values((properties as Record<string, unknown> | undefined) ?? {}).every(
    isSchemaNode,
  );
}

function isSchemaNode(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const type = value.type;
  const validType = isString(type)
    ? SCHEMA_TYPES.has(type)
    : Array.isArray(type) &&
      type.length > 0 &&
      type.every((item) => isString(item) && SCHEMA_TYPES.has(item));
  if (!validType || (value.properties !== undefined && !isRecord(value.properties))) {
    return false;
  }
  if (value.pattern !== undefined) {
    if (typeof value.pattern !== "string") return false;
    try {
      new RegExp(value.pattern, "u");
    } catch {
      return false;
    }
  }
  const required = value.required;
  const properties = value.properties;
  if (
    required !== undefined &&
    (!Array.isArray(required) ||
      !required.every((key) => isString(key) && isRecord(properties) && key in properties))
  ) {
    return false;
  }
  if (value.items !== undefined && !isSchemaNode(value.items)) return false;
  if (
    value.additionalProperties !== undefined &&
    value.additionalProperties !== true &&
    value.additionalProperties !== false &&
    !isSchemaNode(value.additionalProperties)
  ) {
    return false;
  }
  return Object.values((properties as Record<string, unknown> | undefined) ?? {}).every(
    isSchemaNode,
  );
}

export function validateJsonSchema(value: unknown, schema: AIToolJsonSchema): boolean {
  if (!isJsonValue(value) || !isJsonSchema(schema)) return false;
  return validateNode(value, schema);
}

function validateNode(value: unknown, schema: Record<string, unknown>): boolean {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (!types.some((type) => matchesType(value, type))) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => jsonEqual(item, value)))
    return false;
  if (typeof value === "string") {
    const length = [...value].length;
    if (typeof schema.minLength === "number" && length < schema.minLength) return false;
    if (typeof schema.maxLength === "number" && length > schema.maxLength) return false;
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value))
      return false;
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return false;
    if (typeof schema.maximum === "number" && value > schema.maximum) return false;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
    if (
      isRecord(schema.items) &&
      !value.every((item) => validateNode(item, schema.items as Record<string, unknown>))
    ) {
      return false;
    }
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (required.some((key) => typeof key !== "string" || !(key in value))) return false;
    if (
      schema.additionalProperties === false &&
      Object.keys(value).some((key) => !(key in properties))
    ) {
      return false;
    }
    for (const [key, item] of Object.entries(value)) {
      const propertySchema = properties[key];
      if (isRecord(propertySchema) && !validateNode(item, propertySchema)) return false;
      if (propertySchema === undefined && isRecord(schema.additionalProperties)) {
        if (!validateNode(item, schema.additionalProperties)) return false;
      }
    }
  }
  return true;
}

function matchesType(value: unknown, type: unknown): boolean {
  switch (type) {
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return false;
  }
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
