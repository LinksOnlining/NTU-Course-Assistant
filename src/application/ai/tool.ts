import type { ModuleId } from "../../modules/contracts.ts";
import type { AiJsonValue } from "./context.ts";
import type { AiPermissionId } from "./permission.ts";

export type AiJsonObject = { readonly [key: string]: AiJsonValue };

/** 不可信结构化 Provider 输出的无依赖校验边界。 */
export interface AiValueSchema<Value> {
  parse(input: unknown): Value;
}

export type AiToolKind = "read" | "proposal";
export type AiRiskLevel = "low" | "medium" | "high";

/** 描述未来 allow-listed 工具；不含 execute/handler，Phase 4.0 不执行工具。 */
export interface AiTool<Input = unknown, Output = unknown> {
  readonly id: string;
  readonly moduleId: ModuleId;
  readonly description: string;
  readonly kind: AiToolKind;
  readonly requiredPermission: AiPermissionId;
  readonly inputSchema: AiValueSchema<Input>;
  readonly outputSchema: AiValueSchema<Output>;
  readonly riskLevel: AiRiskLevel;
}
