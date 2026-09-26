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
  "src/application/ai/deepseek-provider.ts",
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

test("DeepSeek WebView 只使用专用 Native commands，不含直连网络或 Authorization", () => {
  const frontendFiles = [
    "src/application/ai/deepseek-provider.ts",
    "src/services/deepseek-native-bridge.ts",
    "src/workspace/ai/AISettingsPanel.tsx",
    "src/workspace/ai/ai-settings-service.ts",
  ];
  for (const file of frontendFiles) {
    const contents = source(file);
    assert.doesNotMatch(
      contents,
      /api\.deepseek\.com|Authorization\s*:\s*Bearer|fetch\s*\(/iu,
      file,
    );
  }
  const bridge = source("src/services/deepseek-native-bridge.ts");
  assert.match(bridge, /get_deepseek_api_key_status/u);
  assert.match(bridge, /set_deepseek_api_key/u);
  assert.match(bridge, /delete_deepseek_api_key/u);
  assert.match(bridge, /discover_deepseek_models/u);
  assert.match(bridge, /generate_deepseek_text/u);
  assert.match(bridge, /generate_deepseek_structured/u);
  assert.doesNotMatch(bridge, /http_request|save_secret|get_secret/u);
});

test("API Key 仅有瞬态输入和专用凭据命令，不进入浏览器持久化", () => {
  const panel = source("src/workspace/ai/AISettingsPanel.tsx");
  const storage = source("src/services/ai-provider-settings-storage.ts");
  const settings = source("src/application/ai/settings.ts");
  const rust = source("src-tauri/src/ai.rs");
  assert.match(panel, /type="password"/u);
  assert.match(panel, /setApiKey\(""\)/u);
  assert.match(panel, /saveCredential\(apiKey\)/u);
  assert.doesNotMatch(storage, /apiKey|secret|credential/iu);
  assert.doesNotMatch(settings, /apiKey|secret|credential/iu);
  assert.match(rust, /SERVICE_NAME: &str = "links-workplace\.ai"/u);
  assert.match(rust, /ACCOUNT_NAME: &str = "deepseek\.default"/u);
  assert.match(rust, /keyring::Entry/u);
  assert.doesNotMatch(rust, /sqlite|rusqlite|courses\.sqlite/u);
  assert.doesNotMatch(rust, /println!|dbg!|tracing::/u);
});

test("Endpoint、TLS 与 redirect 策略固定在 Native 边界，CSP 不开放 DeepSeek", () => {
  const rust = source("src-tauri/src/ai.rs");
  const csp = source("src-tauri/tauri.conf.json");
  assert.match(rust, /BASE_URL: &str = "https:\/\/api\.deepseek\.com"/u);
  assert.match(rust, /Policy::none\(\)/u);
  assert.match(rust, /\.bearer_auth\(secret\)/u);
  assert.match(rust, /MAX_RESPONSE_BYTES: usize = 2 \* 1024 \* 1024/u);
  assert.doesNotMatch(csp, /api\.deepseek\.com/u);
  assert.doesNotMatch(csp, /connect-src\s+\*/u);
});

test("AI Settings 注册在通用 Settings 模块，不启用 AI 独立模块", () => {
  const contribution = workplaceModuleRegistry.settings.find(
    ({ id }) => id === "settings.ai-provider",
  );
  assert.equal(contribution?.moduleId, "settings");
  assert.equal(contribution?.pageId, "AI");
  assert.equal(workplaceModuleRegistry.getModuleState("ai")?.available, false);
  assert.match(source("src/components/PeriodSettings.tsx"), /AISettingsPanel/u);
});
