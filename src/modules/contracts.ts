import type { ComponentType } from "react";
import type { AppRoute, NavigationTarget } from "../navigation/types.ts";

/** 稳定机器 ID；内置模块通过声明合并扩展，显示名称和用户偏好不能替代 ID。 */
export interface ModuleIdMap {
  readonly workspace: "workspace";
  readonly academic: "academic";
  readonly planner: "planner";
  readonly diary: "diary";
  readonly inbox: "inbox";
  readonly weather: "weather";
  readonly routine: "routine";
  readonly search: "search";
  readonly settings: "settings";
  readonly ai: "ai";
}

export type ModuleId = ModuleIdMap[keyof ModuleIdMap];

export type ShellRouteView =
  | "workspace-home"
  | "workspace-schedule"
  | "workspace-tasks"
  | "workspace-diary"
  | "workspace-inbox"
  | "workspace-search"
  | "academic-schedule"
  | "academic-hub"
  | "unsupported";

export interface ModuleMetadata {
  readonly name: string;
  readonly description: string;
}

export interface RouteContribution {
  readonly id: string;
  readonly moduleId: ModuleId;
  readonly route: AppRoute;
  readonly label: string;
  readonly order: number;
  readonly shellView: ShellRouteView;
  readonly available: boolean;
  /** 新模块可提供通用 renderer；既有 Academic/Workspace 页面继续由宿主组合。 */
  readonly render?: ComponentType<ModuleRouteProps>;
}

export interface ModuleRouteProps {
  readonly onNavigate: (target: NavigationTarget) => void;
  readonly target: NavigationTarget | null;
}

export type NavigationPlacement = "product-mode" | "academic-subnav" | "header-action";

export interface NavigationContribution {
  readonly id: string;
  readonly moduleId: ModuleId;
  readonly placement: NavigationPlacement;
  readonly label: string;
  readonly accessibilityLabel?: string;
  readonly route: AppRoute;
  readonly order: number;
  readonly available: boolean;
  readonly productMode?: "workspace" | "academic";
  readonly action?: "open-settings";
}

export type SettingsSection = "工作台" | "课表" | "通用";

export interface SettingsContribution {
  readonly id: string;
  readonly moduleId: ModuleId;
  readonly section: SettingsSection;
  readonly pageId: string;
  readonly label: string;
  readonly order: number;
  readonly available: boolean;
  /** 新模块可由自身页面组件渲染；既有设置页继续沿用当前宿主 UI。 */
  readonly render?: ComponentType;
}

/** 扩展声明由 Application 层绑定到同 ID 的本机 provider 实现。 */
export interface CapabilityContribution {
  readonly id: string;
  readonly moduleId: ModuleId;
  readonly order: number;
}

export interface PermissionDefinition {
  /** 稳定格式为 module.action，例如 diary.read。 */
  readonly id: string;
  readonly moduleId: ModuleId;
  readonly action: string;
  readonly label: string;
  readonly description: string;
}

/** Provider-neutral JSON values used by module-contributed JSON Schemas. */
export type AIToolJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly AIToolJsonValue[]
  | { readonly [key: string]: AIToolJsonValue };

/** Provider-neutral JSON Schema object contributed by an application module. */
export type AIToolJsonSchema = Readonly<Record<string, AIToolJsonValue>>;

/** AI 模块声明工具能力；执行器由 Application 按稳定 ID 绑定。 */
export interface AIToolContribution {
  readonly id: string;
  readonly name: string;
  readonly moduleId: ModuleId;
  readonly order: number;
  readonly description: string;
  readonly effect: "read" | "proposal" | "mutation" | "write";
  readonly permissionIds: readonly string[];
  readonly inputSchema: AIToolJsonSchema;
  readonly outputSchema: AIToolJsonSchema;
}

/** 仅描述 AI 能力及其所需模块权限；不绑定实现或执行器。 */
export interface AICapabilityContribution extends CapabilityContribution {
  readonly name: string;
  readonly description: string;
  readonly requiredPermissions: readonly string[];
}

/** 只声明 AI 可请求的最小模块快照边界，不绑定查询实现或授权状态。 */
export interface AIContextContribution extends CapabilityContribution {
  readonly permissionId: string;
  readonly sensitivity: "standard" | "sensitive";
  readonly priority: number;
}

export interface WorkplaceModule {
  readonly id: ModuleId;
  readonly metadata: ModuleMetadata;
  readonly order: number;
  readonly available: boolean;
  readonly enabledByDefault: boolean;
  readonly routes?: readonly RouteContribution[];
  readonly navigation?: readonly NavigationContribution[];
  readonly settings?: readonly SettingsContribution[];
  readonly searchProviders?: readonly CapabilityContribution[];
  readonly contextProviders?: readonly CapabilityContribution[];
  readonly permissions?: readonly PermissionDefinition[];
  readonly aiCapabilities?: readonly AICapabilityContribution[];
  readonly aiContextProviders?: readonly AIContextContribution[];
  readonly aiTools?: readonly AIToolContribution[];
}

export interface ModuleState {
  readonly registered: true;
  readonly available: boolean;
  readonly enabled: boolean;
}
