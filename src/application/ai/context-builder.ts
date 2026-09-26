import { workplaceModuleRegistry } from "../../modules/registry.ts";
import type { ObjectRef } from "../../navigation/types.ts";
import type {
  AiContextBundle,
  AiContextDateRange,
  AiContextModuleId,
  AiContextTime,
  AiContextProvider,
  AiContextRequest,
  AiContextSourceRequest,
  AiContextSources,
} from "./context.ts";
import { enforceAiContextBudget, normalizeAiContextBudget } from "./context-budget.ts";
import {
  getSelectedItemsForModule,
  objectRefKey,
  objectRefModule,
  projectAiContextSnapshot,
} from "./context-projector.ts";
import type { AiContextOmissionReason } from "./context.ts";
import { AiPermissionGate, type AiContextPermissionId } from "./permission.ts";

/** Query first after authorization; each source sees only its own module and bounded request. */
export async function buildAiContext(
  request: AiContextRequest,
  settings: unknown,
  sources: AiContextSources,
): Promise<AiContextBundle> {
  const limits = normalizeAiContextBudget(request.budget);
  const selectionInput = request.selectedItems.slice(0, 100);
  const canonicalSelection = selectionInput
    .map(normalizeObjectRef)
    .filter((item): item is ObjectRef => item !== null);
  const orderedSelected = uniqueAndSortRefs(canonicalSelection);
  const selectedItems = orderedSelected.slice(0, limits.maxSelectedItems);
  const selectionOmitted =
    request.selectedItems.length -
    selectionInput.length +
    selectionInput.length -
    canonicalSelection.length +
    orderedSelected.length -
    selectedItems.length;
  const timeContext = normalizeTimeContext(request.timeContext, limits.maxStringLength);
  const validRequestId =
    request.id.trim().length > 0 &&
    request.id.length <= 128 &&
    !containsControlCharacters(request.id);
  const requestId = validRequestId ? request.id : "invalid-request";
  const requestedScopeInput = request.requestedScopes.slice(0, 32);
  const requested = normalizeRequestedScopes(requestedScopeInput);
  const scopeInputTruncated = request.requestedScopes.length > requestedScopeInput.length;
  const selectedTruncatedModules = new Set(
    orderedSelected.slice(limits.maxSelectedItems).map(objectRefModule).filter(isModuleId),
  );
  const timeRange = normalizeTimeRange(request.timeRange, timeContext.localDate);
  const gate = new AiPermissionGate({
    settings,
    requestId,
    selectedItems,
    requestGrants: validRequestId ? request.requestGrants?.slice(0, limits.maxSelectedItems) : [],
  });
  const permissionFilter = gate.filterRequestedPermissions(requested);
  const granted = new Set(permissionFilter.granted);
  const moduleContexts: Partial<
    Record<AiContextModuleId, AiContextBundle["moduleContexts"][AiContextModuleId]>
  > = {};
  const includedScopes: AiContextPermissionId[] = [];
  const omittedScopes: AiContextBundle["permissions"]["omittedScopes"][number][] =
    permissionFilter.denied.map((denial) => ({
      permissionId: denial.permissionId,
      reason: omissionReason(denial.reason),
    }));
  const redactions: AiContextBundle["redactions"][number][] = permissionFilter.denied.map(
    (denial) => ({ scope: denial.permissionId, reason: omissionReason(denial.reason) }),
  );
  if (request.selectedItems.length > 0) {
    redactions.push({ scope: "selectedItems", reason: "privacy" });
  }
  if (scopeInputTruncated) redactions.push({ scope: "permissions", reason: "budget" });
  const providerFailures: AiContextBundle["providerFailures"][number][] = [];
  const includedSelectedItems: ObjectRef[] = [];
  const sourceRequest: AiContextSourceRequest = {
    intent: request.intent,
    timeRange,
    selectedItems: [],
    timeContext,
  };

  const providers = [...workplaceModuleRegistry.aiContextProviders].sort(
    (a, b) => a.priority - b.priority || compareStableText(a.id, b.id),
  );
  for (const provider of providers) {
    if (
      !requested.includes(provider.permissionId) ||
      !granted.has(provider.permissionId as AiContextPermissionId)
    ) {
      continue;
    }
    const moduleId = provider.moduleId as AiContextModuleId;
    const source = sources[moduleId];
    const moduleSelection = getSelectedItemsForModule(selectedItems, moduleId);
    const permittedSelection =
      provider.sensitivity === "sensitive"
        ? moduleSelection.filter((item) =>
            gate.isSensitiveItemGranted(
              provider.permissionId as "diary.body.read" | "inbox.raw.read",
              item,
            ),
          )
        : moduleSelection;
    if (!source) {
      omitSource(provider.permissionId, moduleId, omittedScopes, redactions, providerFailures);
      continue;
    }
    try {
      const snapshot = await source({ ...sourceRequest, selectedItems: permittedSelection });
      moduleContexts[moduleId] = projectAiContextSnapshot(moduleId, snapshot, {
        ...sourceRequest,
        selectedItems: permittedSelection,
      });
      includedScopes.push(provider.permissionId as AiContextPermissionId);
      includedSelectedItems.push(...permittedSelection);
    } catch {
      omitSource(provider.permissionId, moduleId, omittedScopes, redactions, providerFailures);
    }
  }

  const unboundAllowedScopes = permissionFilter.granted.filter(
    (permissionId) => !providers.some((provider) => provider.permissionId === permissionId),
  );
  for (const permissionId of unboundAllowedScopes) {
    omittedScopes.push({ permissionId, reason: "sourceUnavailable" });
    redactions.push({ scope: permissionId, reason: "sourceUnavailable" });
  }

  for (const moduleId of selectedTruncatedModules) {
    const permissionId =
      workplaceModuleRegistry.aiContextProviders.find((provider) => provider.moduleId === moduleId)
        ?.permissionId ?? `${moduleId}.read`;
    redactions.push({ scope: permissionId, reason: "budget" });
  }

  const draft: Omit<AiContextBundle, "budget"> = {
    requestId,
    generatedAt:
      validIsoDateTime(request.generatedAt) && request.generatedAt.length <= 40
        ? request.generatedAt
        : new Date().toISOString(),
    timeContext,
    selectedItems: Object.freeze(uniqueAndSortRefs(includedSelectedItems)),
    moduleContexts: Object.freeze(moduleContexts),
    permissions: Object.freeze({
      includedScopes: Object.freeze(includedScopes),
      omittedScopes: Object.freeze(omittedScopes),
    }),
    redactions: Object.freeze(uniqueRedactions(redactions)),
    providerFailures: Object.freeze(providerFailures),
  };
  return enforceAiContextBudget(
    draft,
    limits,
    selectionOmitted + Math.max(0, request.requestedScopes.length - requestedScopeInput.length),
    [...selectedTruncatedModules],
  );
}

export const aiContextProvider: AiContextProvider = Object.freeze({ buildContext: buildAiContext });

export function serializeAiContext(bundle: AiContextBundle): string {
  return JSON.stringify(bundle);
}

function omitSource(
  permissionId: string,
  moduleId: AiContextModuleId,
  omittedScopes: AiContextBundle["permissions"]["omittedScopes"][number][],
  redactions: AiContextBundle["redactions"][number][],
  providerFailures: AiContextBundle["providerFailures"][number][],
): void {
  omittedScopes.push({ permissionId, reason: "sourceUnavailable" });
  redactions.push({ scope: permissionId, reason: "sourceUnavailable" });
  providerFailures.push({ moduleId, category: "sourceUnavailable" });
}

function omissionReason(reason: string): AiContextOmissionReason {
  switch (reason) {
    case "unknownPermission":
      return "unknownPermission";
    case "inactiveMutation":
      return "inactiveMutation";
    case "requestGrantRequired":
      return "requestConsentRequired";
    default:
      return "permission";
  }
}

function normalizeTimeRange(
  value: AiContextDateRange | undefined,
  localDate: string,
): AiContextDateRange {
  if (
    value &&
    isDate(value.startDate) &&
    isDate(value.endDate) &&
    value.startDate <= value.endDate
  ) {
    return Object.freeze({ ...value });
  }
  return Object.freeze({ startDate: localDate, endDate: addDays(localDate, 7) });
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addDays(localDate: string, days: number): string {
  if (!isDate(localDate)) return localDate;
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validIsoDateTime(value: string | undefined): value is string {
  return Boolean(
    value &&
    value.length <= 40 &&
    /^\d{4}-\d\d-\d\dT/u.test(value) &&
    Number.isFinite(Date.parse(value)),
  );
}

function uniqueAndSortRefs(items: readonly ObjectRef[]): ObjectRef[] {
  const refs = new Map(items.map((item) => [objectRefKey(item), item]));
  return [...refs.entries()]
    .sort(([left], [right]) => compareStableText(left, right))
    .map(([, item]) => item);
}

function normalizeObjectRef(value: unknown): ObjectRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "academicOccurrence") {
    const courseId = safeIdentifier(candidate.courseId);
    const date =
      typeof candidate.date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(candidate.date)
        ? candidate.date
        : null;
    return courseId && date ? Object.freeze({ type: "academicOccurrence", courseId, date }) : null;
  }
  const types = new Set([
    "course",
    "academicTask",
    "exam",
    "semester",
    "courseOverride",
    "personalTask",
    "plannerEvent",
    "timeBlock",
    "diaryEntry",
    "inboxItem",
  ]);
  const id = safeIdentifier(candidate.id);
  return typeof candidate.type === "string" && types.has(candidate.type) && id
    ? Object.freeze({ type: candidate.type, id } as ObjectRef)
    : null;
}

function safeIdentifier(value: unknown): string | null {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 160 &&
    !containsControlCharacters(value)
    ? value
    : null;
}

function containsControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function normalizeRequestedScopes(values: readonly string[]): string[] {
  return [
    ...new Set(
      values
        .filter((value) => typeof value === "string")
        .map((value) => (value.length <= 128 ? value : "__invalid_permission_scope__")),
    ),
  ].sort();
}

function boundedText(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join("");
}

function normalizeTimeContext(value: AiContextTime, maxLength: number): AiContextTime {
  return Object.freeze({
    localDate: boundedText(value.localDate, Math.min(10, maxLength)),
    localTime: boundedText(value.localTime, Math.min(8, maxLength)),
    timeZone: boundedText(value.timeZone, Math.min(64, maxLength)),
  });
}

function isModuleId(value: AiContextModuleId | null): value is AiContextModuleId {
  return value !== null;
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

function compareStableText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
