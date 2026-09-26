import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BUILT_IN_MODULES } from "../../src/modules/built-in-modules.ts";
import {
  createWorkplaceModuleRegistry,
  workplaceModuleRegistry,
} from "../../src/modules/registry.ts";
import { workspaceSearchProviders } from "../../src/application/workspace/search-providers.ts";
import { workspaceContextProviders } from "../../src/application/workspace/context-provider-registry.ts";

const source = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("Compile-time ModuleRegistry rejects duplicate module, route, and permission declarations", () => {
  const base = {
    id: "workspace",
    metadata: { name: "工作台", description: "测试" },
    order: 1,
    available: true,
    enabledByDefault: true,
  };
  assert.throws(() => createWorkplaceModuleRegistry([base, base]), /Duplicate module id/u);

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
        { ...base, routes: [route, { ...route, id: "workspace.home.duplicate" }] },
      ]),
    /Duplicate route/u,
  );
  const permission = {
    id: "workspace.read",
    moduleId: "workspace",
    action: "read",
    label: "读取",
    description: "测试权限",
  };
  assert.throws(
    () => createWorkplaceModuleRegistry([{ ...base, permissions: [permission, permission] }]),
    /Duplicate permission id/u,
  );
});

test("注册与所有 contribution 顺序由显式 metadata 决定，且 Registry immutable", () => {
  const forward = createWorkplaceModuleRegistry(BUILT_IN_MODULES);
  const reverse = createWorkplaceModuleRegistry([...BUILT_IN_MODULES].reverse());
  assert.deepEqual(
    forward.modules.map(({ id }) => id),
    reverse.modules.map(({ id }) => id),
  );
  assert.deepEqual(
    forward.routes.map(({ id }) => id),
    reverse.routes.map(({ id }) => id),
  );
  assert.deepEqual(
    forward.navigation.map(({ id }) => id),
    reverse.navigation.map(({ id }) => id),
  );
  assert.ok(Object.isFrozen(workplaceModuleRegistry));
  assert.ok(Object.isFrozen(workplaceModuleRegistry.modules));
  assert.equal(workplaceModuleRegistry.getModuleState("weather")?.enabled, false);
  assert.equal(workplaceModuleRegistry.getModuleState("ai", true)?.enabled, false);
});

test("Shell routes/navigation and settings pages are read from module contributions", () => {
  assert.match(
    source("src/navigation/navigation.ts"),
    /workplaceModuleRegistry\.getRoute\(route\)/u,
  );
  const shell = source("src/shell/AppShell.tsx");
  assert.match(shell, /workplaceModuleRegistry\.navigation\.filter/u);
  assert.doesNotMatch(shell, /const ACADEMIC_LINKS = \[/u);
  assert.ok(
    workplaceModuleRegistry.navigation.some(
      ({ id, action }) => id === "settings.header" && action === "open-settings",
    ),
  );
  assert.match(source("src/components/PeriodSettings.tsx"), /workplaceModuleRegistry\.settings/u);
  assert.match(
    source("src/components/PeriodSettings.tsx"),
    /RegisteredSettingsPage && <RegisteredSettingsPage \/>/u,
  );
  assert.match(source("src/App.tsx"), /RegisteredRouteRenderer \?/u);
});

test("Search Core consumes deterministic module-owned providers through Application APIs", () => {
  assert.deepEqual(
    workspaceSearchProviders.map(({ id }) => id),
    workplaceModuleRegistry.searchProviders.map(({ id }) => id),
  );
  assert.deepEqual(
    workspaceSearchProviders.map(({ order }) => order),
    [10, 20, 30, 40],
  );
  assert.match(source("src/application/workspace/search.ts"), /provider\.loadIndex\(\)/u);
  assert.match(source("src/application/workspace/search.ts"), /Promise\.all/u);
  assert.match(source("src/modules/search-provider-registry.ts"), /bindCapabilityImplementations/u);
  assert.match(source("src/application/diary/search-provider.ts"), /loadDiarySearchEntries/u);
  assert.match(source("src/application/inbox/search-provider.ts"), /loadInboxItems/u);
  assert.match(source("src/application/academic/search-provider.ts"), /loadAcademicSearchData/u);
  assert.match(source("src/application/planner/search-provider.ts"), /loadPersonalTasks/u);
  assert.doesNotMatch(
    source("src/application/workspace/search.ts"),
    /services\/(?:diary|inbox|planner)-storage/u,
  );
});

test("Context providers receive only safe summary inputs and Weather failure is isolated", () => {
  assert.deepEqual(
    workspaceContextProviders.map(({ id }) => id),
    workplaceModuleRegistry.contextProviders.map(({ id }) => id),
  );
  const contract = source("src/application/workspace/context-provider-registry.ts");
  assert.match(contract, /"diary\.context": \{ readonly hasDiaryToday: boolean \}/u);
  assert.match(contract, /"inbox\.context": \{ readonly pendingInboxCount: number \}/u);
  assert.match(contract, /"weather\.context": \{ readonly weatherSnapshot:/u);
  assert.doesNotMatch(contract, /DiaryEntry|InboxItem|rawText|diaryBody|inboxRaw/u);
  assert.match(contract, /catch \{/u);
  assert.match(contract, /continue.*provider|继续.*provider/u);
  assert.match(source("src/modules/built-in-modules.ts"), /id: "diary.read"/u);
  assert.match(source("src/modules/built-in-modules.ts"), /id: "workspace\.read"/u);
});

test("AI Context contributions are owned by modules and separate persistent from sensitive scopes", () => {
  const providers = workplaceModuleRegistry.aiContextProviders;
  const permissions = new Map(
    workplaceModuleRegistry.permissions.map((permission) => [permission.id, permission]),
  );
  assert.deepEqual(
    providers.map(({ moduleId }) => moduleId),
    ["workspace", "academic", "planner", "routine", "weather", "diary", "inbox"],
  );
  for (const provider of providers) {
    const permission = permissions.get(provider.permissionId);
    assert.ok(permission);
    assert.equal(permission.moduleId, provider.moduleId);
    assert.equal(
      provider.sensitivity === "standard"
        ? permission.action === "read"
        : permission.action !== "read",
      true,
    );
  }
  assert.equal(
    providers.find(({ moduleId }) => moduleId === "diary")?.permissionId,
    "diary.body.read",
  );
  assert.equal(
    providers.find(({ moduleId }) => moduleId === "inbox")?.permissionId,
    "inbox.raw.read",
  );
});

test("AI Context registry rejects broad or unrelated sensitive permissions", () => {
  const diaryLegacyGrant = BUILT_IN_MODULES.map((module) =>
    module.id === "diary"
      ? {
          ...module,
          aiContextProviders: module.aiContextProviders.map((provider) => ({
            ...provider,
            permissionId: "diary.read",
          })),
        }
      : module,
  );
  assert.throws(
    () => createWorkplaceModuleRegistry(diaryLegacyGrant),
    /supported item-scoped permission/u,
  );
});

test("内置模块与 Presentation 不启用动态第三方执行，也不绕过新增模块 Application APIs", () => {
  const registry = source("src/modules/registry.ts");
  const builtins = source("src/modules/built-in-modules.ts");
  assert.doesNotMatch(`${registry}\n${builtins}`, /\beval\s*\(|new Function|import\s*\(/u);
  assert.deepEqual(workplaceModuleRegistry.aiTools, []);
  assert.doesNotMatch(source("src/modules/contracts.ts"), /execute\s*\(/u);

  for (const file of [
    "src/workspace/diary/WorkspaceDiaryPage.tsx",
    "src/workspace/inbox/WorkspaceInboxPage.tsx",
    "src/workspace/routine/RoutineSettingsPanel.tsx",
    "src/workspace/weather/use-workspace-weather.ts",
    "src/workspace/search/WorkspaceSearchPage.tsx",
  ]) {
    assert.doesNotMatch(source(file), /from ["'][^"']*services\//u, file);
  }
  const descriptors = source("src/modules/built-in-modules.ts");
  assert.doesNotMatch(descriptors, /from ["'][^"']*(?:application|services)\//u);
  for (const file of [
    "src/application/academic/search-provider.ts",
    "src/application/planner/search-provider.ts",
    "src/application/diary/search-provider.ts",
    "src/application/inbox/search-provider.ts",
  ]) {
    assert.doesNotMatch(source(file), /from ["']\.\.\/(?:academic|planner|diary|inbox)\//u, file);
    assert.doesNotMatch(source(file), /from ["']\.\.\/workspace\//u, file);
  }
  assert.doesNotMatch(
    source("src/modules/registry.ts"),
    /from ["'][^"']*(?:application|services)\//u,
  );
  assert.doesNotMatch(
    source("src/application/workspace/search.ts"),
    /from ["'][^"']*search-provider\.ts["']/u,
  );
});

test("类型扩展保持精确路由/对象引用，模块依赖不反向穿透或形成直接同级环", () => {
  const navigationTypes = source("src/navigation/types.ts");
  assert.match(navigationTypes, /export interface AppRouteMap/u);
  assert.match(navigationTypes, /export interface ObjectRefMap/u);
  assert.match(source("src/modules/contracts.ts"), /export interface ModuleIdMap/u);
  assert.match(navigationTypes, /AppRouteMap\[Area\]/u);
  assert.match(navigationTypes, /ObjectRefMap\[keyof ObjectRefMap\]/u);

  const moduleCore = [
    "src/modules/contracts.ts",
    "src/modules/built-in-modules.ts",
    "src/modules/registry.ts",
    "src/modules/search-provider-registry.ts",
  ].map(source);
  for (const contents of moduleCore) {
    assert.doesNotMatch(contents, /from ["'][^"']*(?:application|services|workspace)\//u);
  }
  for (const file of [
    "src/application/academic/search-provider.ts",
    "src/application/planner/search-provider.ts",
    "src/application/diary/search-provider.ts",
    "src/application/inbox/search-provider.ts",
  ]) {
    const contents = source(file);
    assert.doesNotMatch(contents, /from ["']\.\.\/(?:academic|planner|diary|inbox|workspace)\//u);
  }
});
