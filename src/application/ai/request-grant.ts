import type { ObjectRef } from "../../navigation/types.ts";
import type { AiSensitiveRequestPermissionId } from "./permission.ts";

const trustedGrantBrand: unique symbol = Symbol("trusted-ai-request-grant");
const issuedGrants = new WeakSet<object>();

export interface AiRequestGrant {
  readonly requestId: string;
  readonly permissionId: AiSensitiveRequestPermissionId;
  readonly selectedItem: ObjectRef;
  readonly [trustedGrantBrand]: true;
}

/**
 * Application orchestration calls this only after the user confirms a specific item.
 * This module is intentionally not re-exported from the public AI barrel.
 */
export function grantSensitiveContextAfterUserConsent(input: {
  readonly requestId: string;
  readonly permissionId: AiSensitiveRequestPermissionId;
  readonly selectedItem: ObjectRef;
}): AiRequestGrant {
  if (
    !input.requestId.trim() ||
    input.requestId.length > 128 ||
    containsControlCharacters(input.requestId) ||
    !matchesSensitiveItem(input.permissionId, input.selectedItem)
  ) {
    throw new Error("Sensitive AI grant requires a request and a matching selected item");
  }
  const grant = Object.freeze({
    requestId: input.requestId,
    permissionId: input.permissionId,
    selectedItem: Object.freeze({ ...input.selectedItem }),
    [trustedGrantBrand]: true as const,
  });
  issuedGrants.add(grant);
  return grant;
}

/** Internal one-shot validation consumed by AiPermissionGate. */
export function consumeTrustedAiRequestGrant(
  grant: AiRequestGrant,
  requestId: string,
  selectedItems: readonly ObjectRef[],
): boolean {
  if (typeof grant !== "object" || grant === null || !issuedGrants.delete(grant)) return false;
  return (
    grant.requestId === requestId &&
    selectedItems.some(
      (item) =>
        matchesSensitiveItem(grant.permissionId, item) && sameObjectRef(item, grant.selectedItem),
    )
  );
}

function matchesSensitiveItem(
  permissionId: AiSensitiveRequestPermissionId,
  item: ObjectRef,
): boolean {
  return permissionId === "diary.body.read"
    ? item.type === "diaryEntry"
    : item.type === "inboxItem";
}

function sameObjectRef(left: ObjectRef, right: ObjectRef): boolean {
  if (left.type !== right.type) return false;
  if ("id" in left && "id" in right) return left.id === right.id;
  return (
    left.type === "academicOccurrence" &&
    right.type === "academicOccurrence" &&
    left.courseId === right.courseId &&
    left.date === right.date
  );
}

function containsControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}
