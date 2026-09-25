import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILT_IN_MODULES } from "../../src/modules/built-in-modules.ts";
import {
  createWorkplaceModuleRegistry,
  workplaceModuleRegistry,
} from "../../src/modules/registry.ts";
import { getRouteRenderer, getShellRouteView } from "../../src/navigation/navigation.ts";

function moduleDefinition(overrides = {}) {
  return {
    id: "workspace",
    metadata: { name: "工作台", description: "测试模块" },
    order: 10,
    available: true,
    enabledByDefault: true,
    ...overrides,
  };
}

test("模块 Registry 拒绝重复 Module ID、Route ID 与同一 typed route", () => {
  const definition = moduleDefinition();
  assert.throws(
    () => createWorkplaceModuleRegistry([definition, definition]),
    /Duplicate module id/u,
  );

  const routes = [
    {
      id: "workspace.one",
      moduleId: "workspace",
      route: { area: "workspace", page: "home" },
      label: "首页",
      order: 1,
      shellView: "workspace-home",
      available: true,
    },
    {
      id: "workspace.two",
      moduleId: "workspace",
      route: { area: "workspace", page: "home" },
      label: "重复首页",
      order: 2,
      shellView: "workspace-home",
      available: true,
    },
  ];
  assert.throws(
    () => createWorkplaceModuleRegistry([moduleDefinition({ routes })]),
    /Duplicate route/u,
  );
});

test("Navigation 只能指向本模块已注册的 typed route", () => {
  const route = {
    id: "workspace.home",
    moduleId: "workspace",
    route: { area: "workspace", page: "home" },
    label: "首页",
    order: 1,
    shellView: "workspace-home",
    available: true,
  };
  const navigation = {
    id: "workspace.home-link",
    moduleId: "workspace",
    placement: "header-action",
    label: "首页",
    route: route.route,
    order: 1,
  };
  assert.doesNotThrow(() =>
    createWorkplaceModuleRegistry([
      moduleDefinition({ routes: [route], navigation: [navigation] }),
    ]),
  );
  assert.throws(
    () => createWorkplaceModuleRegistry([moduleDefinition({ navigation: [navigation] })]),
    /must target a route owned by module workspace/u,
  );
  assert.throws(
    () =>
      createWorkplaceModuleRegistry([
        moduleDefinition({ routes: [route] }),
        moduleDefinition({ id: "academic", navigation: [{ ...navigation, moduleId: "academic" }] }),
      ]),
    /must target a route owned by module academic/u,
  );
});

test("Registry 拒绝重复 route id、permission id 与 capability key", () => {
  const route = {
    id: "workspace.home",
    moduleId: "workspace",
    route: { area: "workspace", page: "home" },
    label: "首页",
    order: 1,
    shellView: "workspace-home",
    available: true,
  };
  assert.throws(
    () =>
      createWorkplaceModuleRegistry([
        moduleDefinition({
          routes: [route, { ...route, route: { area: "workspace", page: "schedule" } }],
        }),
      ]),
    /Duplicate route id/u,
  );
  const permission = {
    id: "workspace.read",
    moduleId: "workspace",
    action: "read",
    label: "读取",
    description: "测试",
  };
  assert.throws(
    () =>
      createWorkplaceModuleRegistry([moduleDefinition({ permissions: [permission, permission] })]),
    /Duplicate permission id/u,
  );
  const provider = { id: "workspace.context", moduleId: "workspace", order: 1 };
  assert.throws(
    () =>
      createWorkplaceModuleRegistry([moduleDefinition({ contextProviders: [provider, provider] })]),
    /Duplicate context provider id/u,
  );
  const searchProvider = { id: "workspace.search", moduleId: "workspace", order: 1 };
  assert.throws(
    () =>
      createWorkplaceModuleRegistry([
        moduleDefinition({ searchProviders: [searchProvider, searchProvider] }),
      ]),
    /Duplicate search provider id/u,
  );
});

test("内置注册顺序明确且与输入数组顺序无关；返回的注册数据不可变", () => {
  const forward = createWorkplaceModuleRegistry(BUILT_IN_MODULES);
  const reversed = createWorkplaceModuleRegistry([...BUILT_IN_MODULES].reverse());
  assert.deepEqual(
    forward.modules.map(({ id }) => id),
    reversed.modules.map(({ id }) => id),
  );
  assert.deepEqual(
    forward.routes.map(({ id }) => id),
    reversed.routes.map(({ id }) => id),
  );
  assert.deepEqual(
    forward.navigation.map(({ id }) => id),
    reversed.navigation.map(({ id }) => id),
  );
  assert.ok(Object.isFrozen(workplaceModuleRegistry.modules));
  assert.ok(Object.isFrozen(workplaceModuleRegistry.routes));
});

test("创建 Registry 不会冻结或改写调用方的原始定义", () => {
  const route = { area: "workspace", page: "home" };
  const definition = moduleDefinition({
    routes: [
      {
        id: "workspace.home",
        moduleId: "workspace",
        route,
        label: "首页",
        order: 1,
        shellView: "workspace-home",
        available: true,
      },
    ],
  });
  createWorkplaceModuleRegistry([definition]);
  assert.equal(Object.isFrozen(route), false);
  assert.equal(Object.isFrozen(definition.routes[0]), false);
});

test("模块 registered / available / enabled 是独立状态，Weather 默认关闭且 AI 不可用", () => {
  assert.deepEqual(workplaceModuleRegistry.getModuleState("weather"), {
    registered: true,
    available: true,
    enabled: false,
  });
  assert.deepEqual(workplaceModuleRegistry.getModuleState("weather", true), {
    registered: true,
    available: true,
    enabled: true,
  });
  assert.deepEqual(workplaceModuleRegistry.getModuleState("ai", true), {
    registered: true,
    available: false,
    enabled: false,
  });
});

test("内置模块通过统一 registry 贡献 route、navigation、settings、search、context 与权限", () => {
  assert.ok(workplaceModuleRegistry.getRoute({ area: "workspace", page: "diary" }));
  assert.ok(workplaceModuleRegistry.navigation.some(({ id }) => id === "academic.exams-nav"));
  assert.ok(workplaceModuleRegistry.settings.some(({ id }) => id === "weather.settings"));
  assert.deepEqual(
    workplaceModuleRegistry.searchProviders.map(({ id }) => id),
    ["academic.search", "planner.search", "diary.search", "inbox.search"],
  );
  assert.deepEqual(
    workplaceModuleRegistry.contextProviders.map(({ id }) => id),
    ["diary.context", "inbox.context", "weather.context", "routine.context"],
  );
  assert.ok(workplaceModuleRegistry.permissions.some(({ id }) => id === "diary.read"));
  assert.deepEqual(workplaceModuleRegistry.aiTools, []);
});

test("AI capability 权限引用必须存在且注册数据不可变", () => {
  assert.throws(
    () =>
      createWorkplaceModuleRegistry([
        moduleDefinition({
          aiCapabilities: [
            {
              id: "ai.invalid",
              moduleId: "workspace",
              order: 1,
              name: "无效能力",
              description: "引用未注册的权限。",
              requiredPermissions: ["workspace.read"],
            },
          ],
        }),
      ]),
    /AI capability ai\.invalid references unknown permission workspace\.read/u,
  );

  const capabilities = workplaceModuleRegistry.aiCapabilities;
  assert.deepEqual(
    capabilities.map(({ id }) => id),
    ["ai.summary", "ai.planning", "ai.suggestion", "ai.classification"],
  );
  assert.ok(Object.isFrozen(capabilities));
  assert.ok(capabilities.every(({ requiredPermissions }) => Object.isFrozen(requiredPermissions)));
  const knownPermissions = new Set(workplaceModuleRegistry.permissions.map(({ id }) => id));
  assert.ok(
    capabilities.every((capability) =>
      capability.requiredPermissions.every((permissionId) => knownPermissions.has(permissionId)),
    ),
  );
  assert.deepEqual(
    workplaceModuleRegistry.navigation.filter(({ moduleId }) => moduleId === "ai"),
    [],
  );
  assert.equal(workplaceModuleRegistry.getModuleState("ai")?.available, false);
  assert.deepEqual(workplaceModuleRegistry.aiTools, []);
});

test("不可用模块保留 unsupported route 语义，不会执行隐藏 renderer", () => {
  const route = { area: "workspace", page: "ai" };
  assert.equal(getShellRouteView(route), "unsupported");
  assert.equal(getRouteRenderer(route), undefined);
});
