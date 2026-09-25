import type { ObjectRef } from "../../navigation/types.ts";
import type { AiPermissionId, AiPermissionModuleId } from "./permission.ts";

export type AiJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly AiJsonValue[]
  | { readonly [key: string]: AiJsonValue };

/** 只允许调用方显式选择模块和对象；不表达数据库或存储访问能力。 */
export interface AiContextRequest {
  readonly selectedItems: readonly ObjectRef[];
  readonly requestedModules: readonly AiPermissionModuleId[];
  readonly permissionScope: readonly AiPermissionId[];
  readonly timeContext?: {
    readonly localDate: string;
    readonly localTime: string;
    readonly timeZone: string;
  };
}

export interface AiContextBundle {
  readonly workspaceSummary?: string;
  readonly selectedItems: readonly ObjectRef[];
  readonly moduleContexts: Readonly<Partial<Record<AiPermissionModuleId, AiJsonValue>>>;
  readonly timeContext?: AiContextRequest["timeContext"];
  readonly permissionScope: readonly AiPermissionId[];
}

/** 实现只能依据请求中显式选择的对象、模块和已授权 scope 组装上下文。 */
export interface AiContextProvider {
  buildContext(request: AiContextRequest): Promise<AiContextBundle>;
}
