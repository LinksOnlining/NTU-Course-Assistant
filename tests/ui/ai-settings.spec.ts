import { expect, test, type Page } from "@playwright/test";

async function openAISettings(
  page: Page,
  options: { failFirstDiscovery?: boolean; viewport?: { width: number; height: number } } = {},
) {
  if (options.viewport) await page.setViewportSize(options.viewport);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Links Workplace" })).toBeVisible();
  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await page.evaluate((shouldFail) => {
    let configured = false;
    let failureCode: string | null = shouldFail ? "networkUnavailable" : null;
    let models: unknown[] = [
      { id: "deepseek-flash", name: "DeepSeek Flash", supportedEfforts: ["low", "high", "max"] },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", supportedEfforts: ["low", "high", "max"] },
    ];
    const calls: { command: string; args?: Record<string, unknown> }[] = [];
    Object.defineProperty(window, "__aiSettingsTest", {
      configurable: true,
      value: {
        calls,
        setFailDiscovery(value: boolean) {
          failureCode = value ? "networkUnavailable" : null;
        },
        setFailure(value: string | null) {
          failureCode = value;
        },
        setModels(value: unknown[]) {
          models = value;
        },
      },
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string, args?: Record<string, unknown>) => {
          calls.push({ command, args });
          if (command === "get_deepseek_api_key_status") {
            return { status: "success", value: configured };
          }
          if (command === "set_deepseek_api_key") {
            if (typeof args?.secret !== "string") throw new Error("missing transient secret");
            configured = true;
            return { status: "success", value: true };
          }
          if (command === "delete_deepseek_api_key") {
            configured = false;
            return { status: "success", value: true };
          }
          if (command === "discover_deepseek_models") {
            if (failureCode) {
              const message =
                failureCode === "invalidCredential"
                  ? "DeepSeek API Key 无效或已失效。"
                  : failureCode === "forbidden"
                    ? "当前凭据无权访问 DeepSeek 服务。"
                    : failureCode === "rateLimited"
                      ? "DeepSeek 当前请求受限，请稍后重试。"
                      : failureCode === "timeout"
                        ? "连接 DeepSeek 超时，请稍后重试。"
                        : "无法连接 DeepSeek，请检查网络。";
              return {
                status: "failure",
                error: { code: failureCode, message },
              };
            }
            return {
              status: "success",
              value: {
                requestId: "test-request",
                models,
              },
            };
          }
          throw new Error(`unexpected command: ${command}`);
        },
      },
    });
  }, options.failFirstDiscovery ?? false);
  await settings
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "AI" })
    .click();
  return settings;
}

test("AI 设置打开不联网，密钥保存后输入清空且只以 configured 状态暴露", async ({ page }) => {
  const settings = await openAISettings(page);
  const panel = settings.getByTestId("ai-settings");
  await expect(panel.getByText("未配置", { exact: true })).toBeVisible();
  const initialCalls = await page.evaluate(() =>
    (
      window as Window & { __aiSettingsTest: { calls: { command: string }[] } }
    ).__aiSettingsTest.calls.map(({ command }) => command),
  );
  expect(initialCalls.length).toBeGreaterThan(0);
  expect(initialCalls.every((command) => command === "get_deepseek_api_key_status")).toBe(true);

  const sentinel = "phase41-secret-sentinel";
  const key = panel.getByTestId("deepseek-api-key");
  await key.fill(sentinel);
  await panel.getByRole("button", { name: "保存 API Key" }).click();
  await expect(panel.getByText("API Key 已配置")).toBeVisible();
  await expect(panel.getByTestId("deepseek-api-key")).toHaveCount(0);
  const persistedState = await page.evaluate(() => ({
    calls: (
      window as Window & {
        __aiSettingsTest: { calls: { command: string; args?: Record<string, unknown> }[] };
      }
    ).__aiSettingsTest.calls,
    localStorageValues: Object.values(localStorage),
    text: document.body.innerText,
  }));
  expect(JSON.stringify(persistedState.localStorageValues).includes(sentinel)).toBe(false);
  expect(persistedState.text.includes(sentinel)).toBe(false);
  const saveCall = persistedState.calls.find(({ command }) => command === "set_deepseek_api_key");
  expect(saveCall?.args?.secret).toBe(sentinel);
});

test("每日简报默认关闭、最近总结偏好默认开启并保存在本机", async ({ page }) => {
  const settings = await openAISettings(page);
  const panel = settings.getByTestId("ai-settings");
  const enabled = panel.getByTestId("daily-brief-enabled");
  const summaries = panel.getByTestId("daily-brief-recent-summaries");
  await expect(enabled).not.toBeChecked();
  await expect(summaries).toBeChecked();
  await expect(summaries).toBeDisabled();
  await expect(panel.getByText(/仅在每日简报开启时读取此前 1–3 个自然日/u)).toBeVisible();

  await enabled.check();
  await expect(summaries).toBeEnabled();
  await expect(page.getByTestId("daily-brief-dialog")).toHaveCount(0);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("links-workplace.ai.daily-brief") ?? "null"),
  );
  expect(stored).toMatchObject({ enabled: true, includeRecentSummaries: true });
  expect(stored.lastAutoShownDate).toBeNull();
});

test("连接失败可重试，刷新模型只执行显式 /models 并保留已选模型", async ({ page }) => {
  const settings = await openAISettings(page, { failFirstDiscovery: true });
  const panel = settings.getByTestId("ai-settings");
  await panel.getByTestId("deepseek-api-key").fill("test-key");
  await panel.getByRole("button", { name: "保存 API Key" }).click();
  await expect(panel.getByText("API Key 已配置")).toBeVisible();

  await panel.getByRole("button", { name: "测试连接" }).click();
  await expect(panel.getByRole("alert")).toContainText("网络不可用");
  await page.evaluate(() =>
    (
      window as Window & { __aiSettingsTest: { setFailDiscovery(value: boolean): void } }
    ).__aiSettingsTest.setFailDiscovery(false),
  );
  await panel.getByRole("button", { name: "测试连接" }).click();
  await expect(panel.locator(".ai-connection-status")).toContainText("连接正常");
  const modelSelector = panel.getByLabel("DeepSeek 模型");
  await modelSelector.focus();
  await modelSelector.press("ArrowDown");
  await modelSelector.press("Enter");
  await expect(modelSelector).toHaveValue("deepseek-v4-pro");
  await panel.getByRole("button", { name: "刷新模型" }).click();
  await expect(panel.locator(".ai-connection-status")).toContainText("模型列表已刷新");
  await expect(panel.getByLabel("DeepSeek 模型")).toHaveValue("deepseek-v4-pro");

  const calls = await page.evaluate(
    () =>
      (
        window as Window & {
          __aiSettingsTest: { calls: { command: string; args?: Record<string, unknown> }[] };
        }
      ).__aiSettingsTest.calls,
  );
  expect(calls.filter(({ command }) => command === "discover_deepseek_models")).toHaveLength(3);
  expect(calls.some(({ args }) => args && "prompt" in args)).toBe(false);
  expect(calls.some(({ command }) => command.includes("generate"))).toBe(false);
  const settingsRecord = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("links-workplace.ai.provider-settings") ?? "{}"),
  );
  expect(settingsRecord.selectedModel).toBe("deepseek-v4-pro");
  expect(JSON.stringify(settingsRecord)).not.toContain("test-key");
});

test("API Key 可替换并由用户显式删除，401 不会自动删除凭据", async ({ page }) => {
  const settings = await openAISettings(page);
  const panel = settings.getByTestId("ai-settings");
  const key = panel.getByTestId("deepseek-api-key");
  await key.fill("phase41-first-key");
  await panel.getByRole("button", { name: "保存 API Key" }).click();
  await expect(panel.getByText("API Key 已配置")).toBeVisible();

  await panel.getByRole("button", { name: "替换 API Key" }).click();
  await panel.getByTestId("deepseek-api-key").fill("phase41-replacement-key");
  await panel.getByRole("button", { name: "保存新密钥" }).click();
  await expect(panel.getByText("API Key 已配置")).toBeVisible();

  await page.evaluate(() =>
    (
      window as Window & { __aiSettingsTest: { setFailure(code: string | null): void } }
    ).__aiSettingsTest.setFailure("invalidCredential"),
  );
  const connectionButton = panel.getByRole("button", { name: "测试连接" });
  await connectionButton.focus();
  await connectionButton.press("Enter");
  await expect(panel.getByRole("alert")).toContainText("凭据无效");
  await expect(panel.getByText("API Key 已配置")).toBeVisible();
  const afterUnauthorized = await page.evaluate(() =>
    (
      window as Window & { __aiSettingsTest: { calls: { command: string }[] } }
    ).__aiSettingsTest.calls.map(({ command }) => command),
  );
  expect(afterUnauthorized).not.toContain("delete_deepseek_api_key");

  const deleteButton = panel.getByRole("button", { name: "删除 API Key" });
  await deleteButton.focus();
  await deleteButton.press("Enter");
  await expect(panel.getByText("未配置", { exact: true })).toBeVisible();
  const calls = await page.evaluate(
    () =>
      (
        window as Window & {
          __aiSettingsTest: { calls: { command: string; args?: Record<string, unknown> }[] };
        }
      ).__aiSettingsTest.calls,
  );
  expect(
    calls
      .filter(({ command }) => command === "set_deepseek_api_key")
      .map(({ args }) => args?.secret),
  ).toEqual(["phase41-first-key", "phase41-replacement-key"]);
  expect(calls.filter(({ command }) => command === "delete_deepseek_api_key")).toHaveLength(1);
});

test("错误分类、不可用已存模型、高级设置及小窗口可用性", async ({ page }) => {
  const settings = await openAISettings(page, { viewport: { width: 720, height: 520 } });
  const panel = settings.getByTestId("ai-settings");
  await panel.getByTestId("deepseek-api-key").fill("temporary-test-key");
  await panel.getByRole("button", { name: "保存 API Key" }).click();
  await expect(panel.getByText("API Key 已配置")).toBeVisible();

  const failureCases = [
    ["forbidden", "服务受限"],
    ["rateLimited", "服务受限，请稍后再试"],
    ["timeout", "连接超时"],
    ["networkUnavailable", "网络不可用"],
  ] as const;
  for (const [code, label] of failureCases) {
    await page.evaluate(
      (failureCode) =>
        (
          window as Window & { __aiSettingsTest: { setFailure(code: string | null): void } }
        ).__aiSettingsTest.setFailure(failureCode),
      code,
    );
    await panel.getByRole("button", { name: "测试连接" }).click();
    await expect(panel.getByRole("alert")).toContainText(label);
    await expect(panel.getByRole("button", { name: "测试连接" })).toBeEnabled();
  }

  await page.evaluate(() =>
    (
      window as Window & {
        __aiSettingsTest: {
          setFailure(code: string | null): void;
          setModels(models: unknown[]): void;
        };
      }
    ).__aiSettingsTest.setFailure(null),
  );
  await panel.getByRole("button", { name: "测试连接" }).click();
  await expect(panel.locator(".ai-connection-status")).toContainText("连接正常");
  await panel.getByLabel("DeepSeek 模型").selectOption("deepseek-v4-pro");
  await panel.locator(".ai-settings-advanced > summary").click();
  await panel.getByLabel("推理模式").selectOption("high");
  await panel.getByLabel("请求超时（秒）").fill("45");
  await panel.getByRole("button", { name: "保存高级设置" }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("links-workplace.ai.provider-settings") ?? "{}"),
  );
  expect(saved).toMatchObject({
    selectedModel: "deepseek-v4-pro",
    reasoningEffort: "high",
    requestTimeoutSeconds: 45,
  });

  await page.evaluate(() =>
    (
      window as Window & { __aiSettingsTest: { setModels(models: unknown[]): void } }
    ).__aiSettingsTest.setModels([
      { id: "deepseek-flash", name: "DeepSeek Flash", supportedEfforts: ["low", "high", "max"] },
    ]),
  );
  await panel.getByRole("button", { name: "刷新模型" }).click();
  await expect(panel.locator(".ai-settings-warning").first()).toContainText("当前模型不可用");
  await expect(panel.getByLabel("DeepSeek 模型")).toHaveValue("deepseek-v4-pro");
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);

  const nav = settings.getByRole("navigation", { name: "设置分类" });
  await nav.getByRole("button", { name: "外观" }).click();
  await settings.getByLabel("主题").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await nav.getByRole("button", { name: "AI" }).click();
  await expect(settings.getByTestId("ai-settings")).toBeVisible();
  await nav.getByRole("button", { name: "外观" }).click();
  await settings.getByLabel("主题").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("数据访问默认关闭、敏感权限不提供长期开关且设置只写本地", async ({ page }) => {
  const settings = await openAISettings(page, { viewport: { width: 720, height: 520 } });
  const panel = settings.getByTestId("ai-settings");
  const access = panel.getByTestId("ai-data-access");

  for (const permission of [
    "workspace.read",
    "academic.read",
    "planner.read",
    "routine.read",
    "weather.read",
  ]) {
    await expect(access.getByTestId(`ai-access-${permission}`)).not.toBeChecked();
  }
  await expect(access.getByText("Links 只会将你明确允许的数据加入 AI 请求。")).toBeVisible();
  await expect(access.getByText(/配置 DeepSeek API Key 不会自动授予数据权限/u)).toBeVisible();
  await expect(access.getByText("日记内容：仅在具体操作中单次授权")).toBeVisible();
  await expect(access.getByText("Inbox 原文：仅在具体操作中单次授权")).toBeVisible();
  await expect(access.getByText(/不会长期授权。只有在你明确选择一篇日记并同意后/u)).toBeVisible();
  await expect(
    access.getByText(/不会长期授权。只有在你明确选择一条收件箱内容并同意后/u),
  ).toBeVisible();
  await expect(access.getByRole("checkbox", { name: /日记|收件箱/u })).toHaveCount(0);

  const commandCountBefore = await page.evaluate(
    () =>
      (window as Window & { __aiSettingsTest: { calls: { command: string }[] } }).__aiSettingsTest
        .calls.length,
  );
  const plannerPermission = access.getByTestId("ai-access-planner.read");
  await expect(plannerPermission).toHaveAttribute(
    "aria-describedby",
    "ai-access-description-planner.ai-context",
  );
  await plannerPermission.check();
  await expect(plannerPermission).toBeChecked();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("links-workplace.ai.data-access") ?? "{}"),
    ),
  ).toEqual({ persistentGrants: ["planner.read"] });

  const commandCountAfter = await page.evaluate(
    () =>
      (window as Window & { __aiSettingsTest: { calls: { command: string }[] } }).__aiSettingsTest
        .calls.length,
  );
  expect(commandCountAfter).toBe(commandCountBefore);

  const nav = settings.getByRole("navigation", { name: "设置分类" });
  await nav.getByRole("button", { name: "外观" }).click();
  await nav.getByRole("button", { name: "AI" }).click();
  const remounted = settings.getByTestId("ai-data-access");
  await expect(remounted.getByTestId("ai-access-planner.read")).toBeChecked();

  const key = panel.getByTestId("deepseek-api-key");
  await key.fill("provider-key-test-only");
  await panel.getByRole("button", { name: "保存 API Key" }).click();
  await panel.getByRole("button", { name: "删除 API Key" }).click();
  await expect(panel.getByText("未配置", { exact: true })).toBeVisible();
  await expect(remounted.getByTestId("ai-access-planner.read")).toBeChecked();
  const storedDataAccess = await page.evaluate(() =>
    localStorage.getItem("links-workplace.ai.data-access"),
  );
  expect(storedDataAccess).not.toContain("provider-key-test-only");
  const storedToggle = remounted.getByTestId("ai-access-planner.read");
  await storedToggle.uncheck();
  await expect(storedToggle).not.toBeChecked();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("links-workplace.ai.data-access") ?? "{}"),
    ),
  ).toEqual({ persistentGrants: [] });
  expect(
    await remounted.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);

  await settings
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "外观" })
    .click();
  await settings.getByLabel("主题").selectOption("dark");
  await settings
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "AI" })
    .click();
  await expect(settings.getByText("日记内容：仅在具体操作中单次授权")).toBeVisible();
  await settings
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "外观" })
    .click();
  await settings.getByLabel("主题").selectOption("light");
});

test("损坏或篡改的权限记录仅保留允许的持久读取项", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "links-workplace.ai.data-access",
      JSON.stringify({
        persistentGrants: ["workspace.read", "diary.body.read", "inbox.raw.read", "planner.write"],
      }),
    );
  });
  const settings = await openAISettings(page);
  const access = settings.getByTestId("ai-settings").getByTestId("ai-data-access");
  await expect(access.getByTestId("ai-access-workspace.read")).toBeChecked();
  await expect(access.getByTestId("ai-access-planner.read")).not.toBeChecked();
  await expect(access.getByRole("checkbox", { name: /日记|收件箱/u })).toHaveCount(0);
});
