import type { ModuleId, PermissionDefinition } from "../../modules/contracts.ts";

export type AiPermissionModuleId = Exclude<ModuleId, "workspace" | "search" | "settings" | "ai">;

export type AiPermissionAction = "read" | "propose" | "apply";
export type AiPermissionId = `${AiPermissionModuleId}.${AiPermissionAction}`;

export interface AiPermissionDecision {
  /** 仅表示存在明确授权；写操作仍必须通过独立的用户确认。 */
  readonly allowed: boolean;
  readonly requiresConfirmation: boolean;
}

/** 无授权记录时默认拒绝；所有非 read 权限始终要求额外确认。 */
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
