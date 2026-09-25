import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { workplaceModuleRegistry } from "../../src/modules/registry.ts";

const source = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const aiFiles = [
  "src/application/ai/types.ts",
  "src/application/ai/provider.ts",
  "src/application/ai/capability.ts",
  "src/application/ai/permission.ts",
  "src/application/ai/context.ts",
  "src/application/ai/proposal.ts",
  "src/application/ai/tool.ts",
  "src/application/ai/mock-provider.ts",
  "src/application/ai/index.ts",
];

test("AI Application 不依赖数据库、Repository、Rust、Tauri 或网络 SDK", () => {
  for (const file of aiFiles) {
    const contents = source(file);
    const imports = [...contents.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/gu)].map(
      ([, specifier]) => specifier,
    );
    assert.ok(
      imports.every(
        (specifier) =>
          !/(?:^|[/\\])(?:database|repository|storage|sqlite|db)(?:\.[^/\\]+)?(?:$|[/\\])/iu.test(
            specifier,
          ) &&
          !/(?:^|[/@])(?:openai|anthropic|cohere)(?:[/@]|$)/iu.test(specifier) &&
          !specifier.includes("@tauri-apps"),
      ),
      `${file} imports a persistence, platform, or network provider dependency`,
    );
    assert.doesNotMatch(contents, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u, file);
  }
});

test("Provider 通过可替换接口约束，接口层不绑定 Mock 实现", () => {
  const provider = source("src/application/ai/provider.ts");
  const mock = source("src/application/ai/mock-provider.ts");
  assert.match(provider, /export interface AIProvider/u);
  assert.match(provider, /generateText\(/u);
  assert.match(provider, /generateStructured</u);
  assert.match(provider, /checkAvailability\(/u);
  assert.doesNotMatch(provider, /MockAIProvider/u);
  assert.match(mock, /implements AIProvider/u);
});

test("Context 只接受显式选中的模块、对象与权限 scope", () => {
  const context = source("src/application/ai/context.ts");
  assert.match(context, /selectedItems: readonly ObjectRef\[\]/u);
  assert.match(context, /requestedModules: readonly AiPermissionModuleId\[\]/u);
  assert.match(context, /permissionScope: readonly AiPermissionId\[\]/u);
  assert.match(context, /buildContext\(request: AiContextRequest\)/u);
  assert.doesNotMatch(context, /workspace\.read/u);
});

test("AI Registry 仅有静态能力声明，不启用页面、导航或工具执行", () => {
  const capabilities = workplaceModuleRegistry.aiCapabilities;
  const permissions = new Set(workplaceModuleRegistry.permissions.map(({ id }) => id));
  assert.equal(capabilities.length, 4);
  assert.ok(
    capabilities.every(
      ({ moduleId, requiredPermissions }) =>
        moduleId === "ai" && requiredPermissions.every((id) => permissions.has(id)),
    ),
  );
  assert.deepEqual(workplaceModuleRegistry.aiTools, []);
  assert.deepEqual(
    workplaceModuleRegistry.navigation.filter(({ moduleId }) => moduleId === "ai"),
    [],
  );
  assert.equal(workplaceModuleRegistry.getModuleState("ai")?.available, false);
  assert.match(source("src/application/ai/tool.ts"), /interface AiTool/u);
  assert.doesNotMatch(source("src/application/ai/tool.ts"), /execute\s*\(|handler\s*:/u);
});
