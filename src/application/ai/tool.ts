import type { ModuleId } from "../../modules/contracts.ts";
import type { AiJsonValue } from "./context.ts";
import type { AiPermissionId } from "./permission.ts";

export type AiJsonObject = { readonly [key: string]: AiJsonValue };

/** 不可信结构化 Provider 输出的无依赖校验边界。 */
export interface AiValueSchema<Value> {
  readonly name: string;
  readonly jsonSchema: AiJsonObject;
  parse(input: unknown): Value;
}

export type AiToolKind = "read" | "proposal";
export type AiRiskLevel = "low" | "medium" | "high";

export type AiToolEffect = "read" | "proposal" | "mutation" | "write";

/** Runtime-only binding of a module contribution to an Application read adapter. */
export interface AiToolDefinition<Input = unknown, Output = unknown> {
  readonly id: string;
  readonly name: string;
  readonly moduleId: ModuleId;
  readonly description: string;
  readonly effect: AiToolEffect;
  readonly requiredPermission: AiPermissionId;
  readonly inputSchema: AiJsonObject;
  readonly outputSchema: AiJsonObject;
  parseInput(value: unknown): Input;
  execute(input: Input): Promise<Output> | Output;
}

export type AiToolErrorCode =
  | "UNKNOWN_TOOL"
  | "PERMISSION_DENIED"
  | "INVALID_ARGUMENTS"
  | "OUTPUT_VALIDATION_FAILED"
  | "TOOL_FAILED"
  | "TOOL_LIMIT_EXCEEDED";

export type AiToolResult =
  | {
      readonly success: true;
      readonly data: AiJsonValue;
      readonly truncated: boolean;
      readonly omittedCount: number;
    }
  | {
      readonly success: false;
      readonly error: { readonly code: AiToolErrorCode; readonly message: string };
    };

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
