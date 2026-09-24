import type { AppRoute } from "../navigation/types.ts";
import { BUILT_IN_MODULES } from "./built-in-modules.ts";
import type {
  AIToolContribution,
  CapabilityContribution,
  ModuleId,
  ModuleState,
  NavigationContribution,
  PermissionDefinition,
  RouteContribution,
  SettingsContribution,
  WorkplaceModule,
} from "./contracts.ts";

export interface WorkplaceModuleRegistry {
  readonly modules: readonly WorkplaceModule[];
  readonly routes: readonly RouteContribution[];
  readonly navigation: readonly NavigationContribution[];
  readonly settings: readonly SettingsContribution[];
  readonly searchProviders: readonly CapabilityContribution[];
  readonly contextProviders: readonly CapabilityContribution[];
  readonly permissions: readonly PermissionDefinition[];
  readonly aiTools: readonly AIToolContribution[];
  getModule(id: ModuleId): WorkplaceModule | undefined;
  getRoute(route: AppRoute): RouteContribution | undefined;
  getModuleState(id: ModuleId, enabledOverride?: boolean): ModuleState | undefined;
}

function assertUnique<T>(items: readonly T[], key: (item: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    const value = key(item);
    if (seen.has(value)) throw new Error(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function compareOrdered(left: { order: number; id: string }, right: { order: number; id: string }) {
  return left.order - right.order || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function routeKey(route: AppRoute): string {
  return `${route.area}/${route.page}`;
}

function validateOwnership<T extends { moduleId: ModuleId }>(
  module: WorkplaceModule,
  items: readonly T[] | undefined,
  kind: string,
): void {
  for (const item of items ?? []) {
    if (item.moduleId !== module.id) {
      throw new Error(`${kind} ${item.moduleId} is registered by module ${module.id}`);
    }
  }
}

function freezeItems<T extends object>(items: readonly T[]): readonly T[] {
  return Object.freeze(
    items.map((item) => {
      const copy = { ...item };
      if ("route" in copy && copy.route && typeof copy.route === "object") {
        Object.assign(copy, { route: Object.freeze({ ...copy.route }) });
      }
      if ("permissionIds" in copy && Array.isArray(copy.permissionIds)) {
        Object.assign(copy, { permissionIds: Object.freeze([...copy.permissionIds]) });
      }
      return Object.freeze(copy);
    }),
  );
}

export function createWorkplaceModuleRegistry(
  definitions: readonly WorkplaceModule[],
): WorkplaceModuleRegistry {
  assertUnique(definitions, (module) => module.id, "module id");
  for (const module of definitions) {
    validateOwnership(module, module.routes, "route");
    validateOwnership(module, module.navigation, "navigation");
    validateOwnership(module, module.settings, "setting");
    validateOwnership(module, module.searchProviders, "search provider");
    validateOwnership(module, module.contextProviders, "context provider");
    validateOwnership(module, module.permissions, "permission");
    validateOwnership(module, module.aiTools, "AI tool");
  }

  const modules = [...definitions].sort(compareOrdered).map((module) =>
    Object.freeze({
      ...module,
      metadata: Object.freeze({ ...module.metadata }),
      routes: freezeItems(module.routes ?? []),
      navigation: freezeItems(module.navigation ?? []),
      settings: freezeItems(module.settings ?? []),
      searchProviders: freezeItems(module.searchProviders ?? []),
      contextProviders: freezeItems(module.contextProviders ?? []),
      permissions: freezeItems(module.permissions ?? []),
      aiTools: freezeItems(module.aiTools ?? []),
    }),
  );
  const routes = freezeItems(modules.flatMap((module) => module.routes ?? []).sort(compareOrdered));
  const navigation = freezeItems(
    modules.flatMap((module) => module.navigation ?? []).sort(compareOrdered),
  );
  const settings = freezeItems(
    modules.flatMap((module) => module.settings ?? []).sort(compareOrdered),
  );
  const searchProviders = freezeItems(
    modules.flatMap((module) => module.searchProviders ?? []).sort(compareOrdered),
  );
  const contextProviders = freezeItems(
    modules.flatMap((module) => module.contextProviders ?? []).sort(compareOrdered),
  );
  const permissions = freezeItems(
    modules
      .flatMap((module) => module.permissions ?? [])
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  );
  const aiTools = freezeItems(
    modules.flatMap((module) => module.aiTools ?? []).sort(compareOrdered),
  );

  assertUnique(routes, (route) => route.id, "route id");
  assertUnique(routes, (route) => routeKey(route.route), "route");
  assertUnique(navigation, (entry) => entry.id, "navigation id");
  assertUnique(settings, (entry) => entry.id, "settings id");
  assertUnique(settings, (entry) => entry.pageId, "settings page id");
  assertUnique(searchProviders, (provider) => provider.id, "search provider id");
  assertUnique(contextProviders, (provider) => provider.id, "context provider id");
  assertUnique(permissions, (permission) => permission.id, "permission id");
  assertUnique(aiTools, (tool) => tool.id, "AI tool id");

  const routeOwners = new Map(routes.map((route) => [routeKey(route.route), route.moduleId]));
  for (const entry of navigation) {
    if (routeOwners.get(routeKey(entry.route)) !== entry.moduleId) {
      throw new Error(
        `Navigation ${entry.id} must target a route owned by module ${entry.moduleId}`,
      );
    }
  }

  const permissionIds = new Set(permissions.map((permission) => permission.id));
  for (const permission of permissions) {
    if (permission.id !== `${permission.moduleId}.${permission.action}`) {
      throw new Error(`Invalid permission id: ${permission.id}`);
    }
  }
  for (const tool of aiTools) {
    for (const permissionId of tool.permissionIds) {
      if (!permissionIds.has(permissionId)) {
        throw new Error(`AI tool ${tool.id} references unknown permission ${permissionId}`);
      }
    }
  }

  const byId = new Map(modules.map((module) => [module.id, module]));
  const routesByKey = new Map(routes.map((route) => [routeKey(route.route), route]));
  return Object.freeze({
    modules: Object.freeze(modules),
    routes,
    navigation,
    settings,
    searchProviders,
    contextProviders,
    permissions,
    aiTools,
    getModule: (id: ModuleId) => byId.get(id),
    getRoute: (route: AppRoute) => routesByKey.get(routeKey(route)),
    getModuleState: (id: ModuleId, enabledOverride?: boolean) => {
      const module = byId.get(id);
      if (!module) return undefined;
      return Object.freeze({
        registered: true as const,
        available: module.available,
        enabled: module.available && (enabledOverride ?? module.enabledByDefault),
      });
    },
  });
}

/** 将声明和 Application 实现按稳定 ID 绑定；缺失、额外或错属实现都会失败。 */
export function bindCapabilityImplementations<T extends CapabilityContribution>(
  kind: string,
  declarations: readonly CapabilityContribution[],
  implementations: readonly T[],
): readonly T[] {
  assertUnique(implementations, (item) => item.id, `${kind} implementation id`);
  const declaredById = new Map(declarations.map((item) => [item.id, item]));
  assertUnique(declarations, (item) => item.id, `${kind} declaration id`);
  if (declaredById.size !== implementations.length) {
    throw new Error(`${kind} implementations do not match module declarations`);
  }
  for (const implementation of implementations) {
    const declaration = declaredById.get(implementation.id);
    if (
      !declaration ||
      declaration.moduleId !== implementation.moduleId ||
      declaration.order !== implementation.order
    ) {
      throw new Error(`${kind} implementation does not match declaration: ${implementation.id}`);
    }
  }
  return Object.freeze(
    [...implementations].sort(compareOrdered).map((item) => Object.freeze(item)),
  );
}

export const workplaceModuleRegistry = createWorkplaceModuleRegistry(BUILT_IN_MODULES);
