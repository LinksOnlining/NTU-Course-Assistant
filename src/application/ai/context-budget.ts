import { workplaceModuleRegistry } from "../../modules/registry.ts";
import type { ObjectRef } from "../../navigation/types.ts";
import {
  DEFAULT_AI_CONTEXT_BUDGET,
  type AiContextBudget,
  type AiContextBundle,
  type AiContextModuleId,
  type AiJsonValue,
} from "./context.ts";

type BundleWithoutBudget = Omit<AiContextBundle, "budget">;

const MAX_AI_CONTEXT_BYTES = 32 * 1024;
const MAX_AI_CONTEXT_MODULE_BYTES = 18 * 1024;
const MAX_AI_CONTEXT_STRING_LENGTH = 16 * 1024;

export function normalizeAiContextBudget(
  value: Partial<AiContextBudget> | undefined,
): AiContextBudget {
  if (!value) return DEFAULT_AI_CONTEXT_BUDGET;
  return Object.freeze({
    maxTotalBytes: boundedInteger(value.maxTotalBytes, 1024, MAX_AI_CONTEXT_BYTES),
    maxModuleBytes: boundedInteger(value.maxModuleBytes, 512, MAX_AI_CONTEXT_MODULE_BYTES),
    maxStringLength: boundedInteger(value.maxStringLength, 1, MAX_AI_CONTEXT_STRING_LENGTH),
    maxItemsPerModule: boundedInteger(
      value.maxItemsPerModule,
      1,
      DEFAULT_AI_CONTEXT_BUDGET.maxItemsPerModule,
    ),
    maxSelectedItems: boundedInteger(
      value.maxSelectedItems,
      1,
      DEFAULT_AI_CONTEXT_BUDGET.maxSelectedItems,
    ),
  });
}

export function enforceAiContextBudget(
  bundle: BundleWithoutBudget,
  limits: AiContextBudget,
  initialOmittedCount = 0,
  initialTruncatedModules: readonly AiContextModuleId[] = [],
): AiContextBundle {
  const moduleContexts: Partial<Record<AiContextModuleId, AiJsonValue>> = {};
  const moduleBytes: Partial<Record<AiContextModuleId, number>> = {};
  const truncatedModules = new Set<AiContextModuleId>(initialTruncatedModules);
  const redactions = [...bundle.redactions];
  let omittedCount = initialOmittedCount;

  for (const [moduleId, raw] of Object.entries(bundle.moduleContexts) as [
    AiContextModuleId,
    AiJsonValue,
  ][]) {
    const limited = limitValue(raw, limits.maxStringLength, limits.maxItemsPerModule);
    omittedCount += limited.omittedCount;
    let value = limited.value;
    let moduleTruncated = limited.truncated;
    while (serializedBytes(value) > limits.maxModuleBytes) {
      const removed = removeLastArrayItem(value);
      if (!removed.changed) break;
      value = removed.value;
      omittedCount += removed.omittedCount;
      moduleTruncated = true;
    }
    if (serializedBytes(value) > limits.maxModuleBytes) {
      omittedCount += countItems(value) || 1;
      moduleTruncated = true;
      continue;
    }
    moduleContexts[moduleId] = value;
    moduleBytes[moduleId] = serializedBytes(value);
    if (moduleTruncated) {
      truncatedModules.add(moduleId);
      redactions.push({ scope: permissionForModule(moduleId), reason: "budget" });
    }
  }

  const omittedScopes = [...bundle.permissions.omittedScopes];
  const includedScopes = [...bundle.permissions.includedScopes];
  const selectedItems = [...bundle.selectedItems];
  const state = {
    ...bundle,
    selectedItems,
    moduleContexts,
    permissions: { includedScopes, omittedScopes },
    redactions: uniqueRedactions(redactions),
  };
  let result = withBudget(state, limits, 0, omittedCount, [...truncatedModules], moduleBytes);

  const removalOrder = [...workplaceModuleRegistry.aiContextProviders]
    .sort((a, b) => b.priority - a.priority || compareStableText(b.id, a.id))
    .map(({ moduleId }) => moduleId as AiContextModuleId);
  while (serializedBytes(result) > limits.maxTotalBytes) {
    const moduleId = removalOrder.find((id) => id in result.moduleContexts);
    if (!moduleId) {
      const selectedItems = [...result.selectedItems];
      const removedSelection = selectedItems.pop();
      if (removedSelection) {
        const nextTruncated = new Set(result.budget.truncatedModules);
        const selectedModule = refModule(removedSelection);
        if (selectedModule) nextTruncated.add(selectedModule);
        result = withBudget(
          { ...result, selectedItems },
          limits,
          0,
          result.budget.omittedCount + 1,
          [...nextTruncated],
          moduleBytes,
        );
        continue;
      }
      if (result.permissions.omittedScopes.length > 0) {
        result = withBudget(
          {
            ...result,
            permissions: {
              ...result.permissions,
              omittedScopes: result.permissions.omittedScopes.slice(0, -1),
            },
          },
          limits,
          0,
          result.budget.omittedCount + 1,
          result.budget.truncatedModules,
          moduleBytes,
        );
        continue;
      }
      if (result.redactions.length > 0) {
        result = withBudget(
          { ...result, redactions: result.redactions.slice(0, -1) },
          limits,
          0,
          result.budget.omittedCount,
          result.budget.truncatedModules,
          moduleBytes,
        );
        continue;
      }
      if (result.providerFailures.length > 0) {
        result = withBudget(
          { ...result, providerFailures: result.providerFailures.slice(0, -1) },
          limits,
          0,
          result.budget.omittedCount + 1,
          result.budget.truncatedModules,
          moduleBytes,
        );
        continue;
      }
      if (result.permissions.includedScopes.length > 0) {
        result = withBudget(
          {
            ...result,
            permissions: {
              ...result.permissions,
              includedScopes: result.permissions.includedScopes.slice(0, -1),
            },
          },
          limits,
          0,
          result.budget.omittedCount + 1,
          result.budget.truncatedModules,
          moduleBytes,
        );
        continue;
      }
      if (result.requestId.length > 0) {
        result = { ...result, requestId: result.requestId.slice(0, -1) };
        continue;
      }
      if (result.timeContext.timeZone.length > 0) {
        result = { ...result, timeContext: { ...result.timeContext, timeZone: "" } };
        continue;
      }
      if (result.timeContext.localTime.length > 0) {
        result = { ...result, timeContext: { ...result.timeContext, localTime: "" } };
        continue;
      }
      if (result.timeContext.localDate.length > 0) {
        result = { ...result, timeContext: { ...result.timeContext, localDate: "" } };
        continue;
      }
      break;
    }
    const removedCount = Math.max(1, countItems(result.moduleContexts[moduleId] ?? null));
    const nextModules = { ...result.moduleContexts };
    delete nextModules[moduleId];
    const permissionId = permissionForModule(moduleId);
    const nextIncluded = result.permissions.includedScopes.filter((id) => id !== permissionId);
    const nextOmitted = [
      ...result.permissions.omittedScopes,
      { permissionId, reason: "budget" as const },
    ];
    const nextSelected = result.selectedItems.filter((item) => refModule(item) !== moduleId);
    const nextTruncated = new Set(result.budget.truncatedModules);
    nextTruncated.add(moduleId);
    omittedCount =
      result.budget.omittedCount +
      removedCount +
      (result.selectedItems.length - nextSelected.length);
    moduleBytes[moduleId] = 0;
    truncatedModules.add(moduleId);
    result = withBudget(
      {
        ...result,
        selectedItems: nextSelected,
        moduleContexts: nextModules,
        permissions: { includedScopes: nextIncluded, omittedScopes: nextOmitted },
        redactions: uniqueRedactions([
          ...result.redactions,
          { scope: permissionId, reason: "budget" },
        ]),
      },
      limits,
      0,
      omittedCount,
      [...nextTruncated],
      moduleBytes,
    );
  }

  return deepFreeze(finalizeUsedBytes(result));
}

export function serializedAiContextBytes(value: unknown): number {
  return serializedBytes(value);
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.floor(value)))
    : maximum;
}

function limitValue(
  value: AiJsonValue,
  maxStringLength: number,
  maxItems: number,
): { value: AiJsonValue; omittedCount: number; truncated: boolean } {
  if (typeof value === "string") {
    const points = Array.from(value);
    return points.length <= maxStringLength
      ? { value, omittedCount: 0, truncated: false }
      : {
          value: points.slice(0, maxStringLength).join(""),
          omittedCount: 0,
          truncated: true,
        };
  }
  if (Array.isArray(value)) {
    const kept = value.slice(0, maxItems);
    let omittedCount = value.length - kept.length;
    let truncated = omittedCount > 0;
    const items = kept.map((item) => {
      const limited = limitValue(item, maxStringLength, maxItems);
      omittedCount += limited.omittedCount;
      truncated ||= limited.truncated;
      return limited.value;
    });
    return { value: items, omittedCount, truncated };
  }
  if (isJsonObject(value)) {
    const result: Record<string, AiJsonValue> = {};
    let omittedCount = 0;
    let truncated = false;
    for (const key of Object.keys(value).sort()) {
      const limited = limitValue(value[key], maxStringLength, maxItems);
      result[key] = limited.value;
      omittedCount += limited.omittedCount;
      truncated ||= limited.truncated;
    }
    return { value: result, omittedCount, truncated };
  }
  return { value, omittedCount: 0, truncated: false };
}

function removeLastArrayItem(value: AiJsonValue): {
  value: AiJsonValue;
  changed: boolean;
  omittedCount: number;
} {
  if (Array.isArray(value)) {
    if (value.length === 0) return { value, changed: false, omittedCount: 0 };
    return { value: value.slice(0, -1), changed: true, omittedCount: 1 };
  }
  if (isJsonObject(value)) {
    for (const key of Object.keys(value).sort().reverse()) {
      const result = removeLastArrayItem(value[key]);
      if (!result.changed) continue;
      return {
        value: { ...value, [key]: result.value },
        changed: true,
        omittedCount: result.omittedCount,
      };
    }
  }
  return { value, changed: false, omittedCount: 0 };
}

function countItems(value: AiJsonValue): number {
  if (Array.isArray(value)) {
    return value.length + value.reduce<number>((sum, item) => sum + countItems(item), 0);
  }
  if (isJsonObject(value)) {
    return Object.values(value).reduce<number>((sum, item) => sum + countItems(item), 0);
  }
  return 0;
}

function permissionForModule(moduleId: AiContextModuleId): string {
  return (
    workplaceModuleRegistry.aiContextProviders.find((provider) => provider.moduleId === moduleId)
      ?.permissionId ?? `${moduleId}.read`
  );
}

function refModule(item: ObjectRef): AiContextModuleId | null {
  switch (item.type) {
    case "course":
    case "academicOccurrence":
    case "academicTask":
    case "exam":
    case "semester":
    case "courseOverride":
      return "academic";
    case "personalTask":
    case "plannerEvent":
    case "timeBlock":
      return "planner";
    case "diaryEntry":
      return "diary";
    case "inboxItem":
      return "inbox";
  }
  return null;
}

function isJsonObject(value: AiJsonValue): value is { readonly [key: string]: AiJsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function uniqueRedactions(
  items: readonly AiContextBundle["redactions"][number][],
): AiContextBundle["redactions"] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.scope}:${item.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function withBudget(
  bundle: BundleWithoutBudget | AiContextBundle,
  limits: AiContextBudget,
  usedBytes: number,
  omittedCount: number,
  truncatedModules: readonly AiContextModuleId[],
  moduleBytes: Partial<Record<AiContextModuleId, number>>,
): AiContextBundle {
  return {
    ...bundle,
    budget: {
      ...limits,
      usedBytes,
      truncated: truncatedModules.length > 0,
      omittedCount,
      truncatedModules: Object.freeze([...new Set(truncatedModules)].sort()),
      moduleBytes: Object.freeze({ ...moduleBytes }),
    },
  };
}

function finalizeUsedBytes(bundle: AiContextBundle): AiContextBundle {
  let result = bundle;
  for (let index = 0; index < 8; index += 1) {
    const size = serializedBytes(result);
    if (size === result.budget.usedBytes) break;
    result = { ...result, budget: { ...result.budget, usedBytes: size } };
  }
  return result;
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? "").length;
}

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    if (!Object.isFrozen(value)) Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
