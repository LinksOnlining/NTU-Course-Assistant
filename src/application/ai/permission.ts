import type { ObjectRef } from "../../navigation/types.ts";
import { workplaceModuleRegistry } from "../../modules/registry.ts";
import type { ModuleId, PermissionDefinition } from "../../modules/contracts.ts";
import { consumeTrustedAiRequestGrant, type AiRequestGrant } from "./request-grant.ts";

export type AiPermissionModuleId = Exclude<ModuleId, "search" | "settings" | "ai">;
export type AiPermissionAction = "read" | "propose" | "apply";
export type AiPermissionId =
  `${AiPermissionModuleId}.${AiPermissionAction}` | "diary.body.read" | "inbox.raw.read";

export const AI_PERSISTENT_READ_PERMISSION_IDS = [
  "workspace.read",
  "academic.read",
  "planner.read",
  "routine.read",
  "weather.read",
] as const satisfies readonly AiPermissionId[];

export type AiPersistentReadPermissionId = (typeof AI_PERSISTENT_READ_PERMISSION_IDS)[number];
export type AiSensitiveRequestPermissionId = "diary.body.read" | "inbox.raw.read";
export type AiContextPermissionId = AiPersistentReadPermissionId | AiSensitiveRequestPermissionId;

export interface AiDataAccessSettings {
  readonly persistentGrants: readonly AiPersistentReadPermissionId[];
}

export const DEFAULT_AI_DATA_ACCESS_SETTINGS: AiDataAccessSettings = Object.freeze({
  persistentGrants: Object.freeze([]),
});

export function normalizeAiDataAccessSettings(value: unknown): AiDataAccessSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_AI_DATA_ACCESS_SETTINGS;
  }
  const raw = (value as Record<string, unknown>).persistentGrants;
  if (!Array.isArray(raw)) return DEFAULT_AI_DATA_ACCESS_SETTINGS;
  const allowed = new Set(
    raw.filter((id): id is AiPersistentReadPermissionId =>
      AI_PERSISTENT_READ_PERMISSION_IDS.includes(id as AiPersistentReadPermissionId),
    ),
  );
  const persistentGrants = AI_PERSISTENT_READ_PERMISSION_IDS.filter((id) => allowed.has(id));
  return Object.freeze({ persistentGrants: Object.freeze(persistentGrants) });
}

export interface AiPermissionState {
  readonly persistentGrants: readonly AiPersistentReadPermissionId[];
  /** 一次性、request-bound grant；不得进入设置存储。 */
  readonly requestGrants: readonly AiRequestGrant[];
}

export interface AiPermissionDecision {
  readonly allowed: boolean;
  readonly requiresConfirmation: boolean;
}

export type AiPermissionDenyReason =
  "unknownPermission" | "notGranted" | "requestGrantRequired" | "inactiveMutation";

export type AiPermissionResult =
  | { readonly allowed: true; readonly permissionId: AiContextPermissionId }
  | {
      readonly allowed: false;
      readonly permissionId: string;
      readonly reason: AiPermissionDenyReason;
    };

export interface AiPermissionFilterResult {
  readonly granted: readonly AiContextPermissionId[];
  readonly denied: readonly Extract<AiPermissionResult, { allowed: false }>[];
}

const registryPermissionById = new Map(
  workplaceModuleRegistry.permissions.map((permission) => [permission.id, permission]),
);
const persistentReadIds = new Set<string>(AI_PERSISTENT_READ_PERMISSION_IDS);
const sensitiveReadIds = new Set<string>(["diary.body.read", "inbox.raw.read"]);

/**
 * Runtime Gate is default-deny. Request grants are accepted only if minted by the
 * application consent boundary and are consumed once for their matching request.
 */
export class AiPermissionGate {
  readonly state: AiPermissionState;
  readonly requestId: string;
  private readonly selectedItems: readonly ObjectRef[];
  private readonly requestGranted = new Map<AiSensitiveRequestPermissionId, Set<string>>();

  constructor(input: {
    readonly settings?: unknown;
    readonly requestId: string;
    readonly selectedItems?: readonly ObjectRef[];
    readonly requestGrants?: readonly AiRequestGrant[];
  }) {
    const settings = normalizeAiDataAccessSettings(input.settings);
    const selectedItems = input.selectedItems ?? [];
    const requestGrants = (input.requestGrants ?? []).filter((grant) =>
      consumeTrustedAiRequestGrant(grant, input.requestId, selectedItems),
    );
    this.requestId = input.requestId;
    this.selectedItems = selectedItems;
    this.state = Object.freeze({
      persistentGrants: settings.persistentGrants,
      requestGrants: Object.freeze(requestGrants),
    });
    for (const grant of requestGrants) {
      const identities = this.requestGranted.get(grant.permissionId) ?? new Set<string>();
      identities.add(objectRefIdentity(grant.selectedItem));
      this.requestGranted.set(grant.permissionId, identities);
    }
  }

  isGranted(permissionId: string): boolean {
    return this.require(permissionId).allowed;
  }

  isSensitiveItemGranted(permissionId: AiSensitiveRequestPermissionId, item: ObjectRef): boolean {
    return (
      isObjectRefForSensitiveScope(item, permissionId) &&
      this.requestGranted.get(permissionId)?.has(objectRefIdentity(item)) === true
    );
  }

  require(permissionId: string): AiPermissionResult {
    const permission = registryPermissionById.get(permissionId);
    if (!permission) {
      return { allowed: false, permissionId, reason: "unknownPermission" };
    }
    if (
      permission.action !== "read" &&
      permission.action !== "body.read" &&
      permission.action !== "raw.read"
    ) {
      return { allowed: false, permissionId, reason: "inactiveMutation" };
    }
    if (sensitiveReadIds.has(permissionId)) {
      return this.selectedItems.some((item) =>
        this.isSensitiveItemGranted(permissionId as AiSensitiveRequestPermissionId, item),
      )
        ? { allowed: true, permissionId: permissionId as AiContextPermissionId }
        : { allowed: false, permissionId, reason: "requestGrantRequired" };
    }
    if (persistentReadIds.has(permissionId)) {
      return this.state.persistentGrants.includes(permissionId as AiPersistentReadPermissionId)
        ? { allowed: true, permissionId: permissionId as AiContextPermissionId }
        : { allowed: false, permissionId, reason: "notGranted" };
    }
    // Legacy broad diary.read / inbox.read contracts remain registered but cannot grant body/raw.
    return { allowed: false, permissionId, reason: "requestGrantRequired" };
  }

  filterRequestedPermissions(requested: readonly string[]): AiPermissionFilterResult {
    const granted: AiContextPermissionId[] = [];
    const denied: Extract<AiPermissionResult, { allowed: false }>[] = [];
    for (const permissionId of new Set(requested)) {
      const decision = this.require(permissionId);
      if (decision.allowed) granted.push(decision.permissionId);
      else denied.push(decision);
    }
    return Object.freeze({ granted: Object.freeze(granted), denied: Object.freeze(denied) });
  }
}

/** Phase 4.0 static permission contract; Phase 4.2 runtime mutations stay inactive. */
export function evaluateAiPermission(
  permission: PermissionDefinition | undefined,
  grantedPermissionIds: readonly string[] = [],
): AiPermissionDecision {
  if (!permission || permission.id !== `${permission.moduleId}.${permission.action}`) {
    return Object.freeze({ allowed: false, requiresConfirmation: false });
  }
  return Object.freeze({
    allowed: grantedPermissionIds.includes(permission.id),
    requiresConfirmation: permission.action !== "read",
  });
}

function isObjectRefForSensitiveScope(
  item: ObjectRef,
  permissionId: AiSensitiveRequestPermissionId,
): boolean {
  return permissionId === "diary.body.read"
    ? item.type === "diaryEntry"
    : item.type === "inboxItem";
}

function objectRefIdentity(item: ObjectRef): string {
  return item.type === "academicOccurrence"
    ? `${item.type}:${item.courseId}:${item.date}`
    : `${item.type}:${"id" in item ? item.id : ""}`;
}
