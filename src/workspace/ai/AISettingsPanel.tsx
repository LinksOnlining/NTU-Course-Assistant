import { useEffect, useState } from "react";
import {
  AiProviderError,
  type AiProviderErrorCode,
  type DeepSeekModel,
} from "../../application/ai/deepseek-provider.ts";
import {
  AI_MODEL_IDS,
  AI_REASONING_EFFORTS,
  normalizeAiProviderSettings,
  type AiProviderSettings,
  type AiReasoningEffort,
} from "../../application/ai/settings.ts";
import { aiSettingsService } from "./ai-settings-service.ts";

const MODEL_LABELS: Record<(typeof AI_MODEL_IDS)[number], string> = {
  "deepseek-flash": "DeepSeek Flash",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
};

function safeMessage(caught: unknown): string {
  return caught instanceof AiProviderError ? caught.message : "AI 设置操作失败，请稍后重试。";
}

function connectionLabel(code: AiProviderErrorCode): string {
  switch (code) {
    case "notConfigured":
      return "未配置";
    case "invalidCredential":
      return "凭据无效";
    case "forbidden":
      return "服务受限";
    case "rateLimited":
      return "服务受限，请稍后再试";
    case "networkUnavailable":
      return "网络不可用";
    case "timeout":
      return "连接超时";
    case "providerUnavailable":
      return "服务暂不可用";
    default:
      return "连接失败";
  }
}

export function AISettingsPanel() {
  const [settings, setSettings] = useState<AiProviderSettings>(() =>
    aiSettingsService.loadSettings(),
  );
  const [timeoutDraft, setTimeoutDraft] = useState(String(settings.requestTimeoutSeconds));
  const [credentialConfigured, setCredentialConfigured] = useState<boolean | null>(null);
  const [credentialUnavailable, setCredentialUnavailable] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [credentialError, setCredentialError] = useState("");
  const [connectionState, setConnectionState] = useState<
    "notTested" | "testing" | "connected" | "error"
  >("notTested");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [activeDiscovery, setActiveDiscovery] = useState<"test" | "refresh" | null>(null);
  const [models, setModels] = useState<readonly DeepSeekModel[] | null>(null);
  const [settingsMessage, setSettingsMessage] = useState("");

  useEffect(() => {
    let active = true;
    void aiSettingsService
      .getCredentialStatus()
      .then((configured) => {
        if (!active) return;
        setCredentialConfigured(configured);
        setShowKeyInput(!configured);
      })
      .catch(() => {
        if (!active) return;
        setCredentialUnavailable(true);
        setCredentialConfigured(null);
        setCredentialError("安全凭据服务不可用；为保护密钥，本机不会改用明文存储。 ");
      });
    return () => {
      active = false;
    };
  }, []);

  function saveSettings(patch: Partial<AiProviderSettings>) {
    const next = normalizeAiProviderSettings({ ...settings, ...patch });
    if (!aiSettingsService.saveSettings(next)) {
      setSettingsMessage("此设备的本地存储不可用，设置未保存。");
      return false;
    }
    setSettings(next);
    setTimeoutDraft(String(next.requestTimeoutSeconds));
    setSettingsMessage("设置已保存到此设备。");
    return true;
  }

  async function saveKey() {
    if (!apiKey.trim() || savingKey || credentialUnavailable) return;
    setSavingKey(true);
    setCredentialError("");
    try {
      const configured = await aiSettingsService.saveCredential(apiKey);
      setCredentialConfigured(configured);
      setShowKeyInput(false);
      setConnectionState("notTested");
      setConnectionMessage("");
    } catch (caught: unknown) {
      setCredentialError(safeMessage(caught));
    } finally {
      setApiKey("");
      setSavingKey(false);
    }
  }

  async function deleteKey() {
    if (credentialConfigured !== true) return;
    setCredentialError("");
    try {
      await aiSettingsService.deleteCredential();
      setCredentialConfigured(false);
      setShowKeyInput(true);
      setConnectionState("notTested");
      setConnectionMessage("");
    } catch (caught: unknown) {
      setCredentialError(safeMessage(caught));
    }
  }

  async function discoverModels(kind: "test" | "refresh") {
    if (credentialConfigured !== true || activeDiscovery !== null) return;
    setConnectionState("testing");
    setActiveDiscovery(kind);
    setConnectionMessage(kind === "test" ? "正在测试 DeepSeek 连接…" : "正在刷新模型列表…");
    setCredentialError("");
    try {
      const result =
        kind === "test"
          ? await aiSettingsService.testConnection()
          : await aiSettingsService.refreshModels();
      setModels(result);
      setConnectionState("connected");
      setConnectionMessage(
        kind === "test"
          ? `连接正常，已读取 ${result.length} 个模型。`
          : `模型列表已刷新，共 ${result.length} 个。`,
      );
    } catch (caught: unknown) {
      const message = safeMessage(caught);
      const code = caught instanceof AiProviderError ? caught.code : "unknown";
      setConnectionState("error");
      setConnectionMessage(`${connectionLabel(code)}：${message}`);
      // Keep the last successful model list and current selection on refresh failure.
    } finally {
      setActiveDiscovery(null);
    }
  }

  const supportedModels = models
    ? models.filter((model) => AI_MODEL_IDS.includes(model.id as (typeof AI_MODEL_IDS)[number]))
    : AI_MODEL_IDS.map((id) => ({ id }));
  const selectedIsAvailable = supportedModels.some((model) => model.id === settings.selectedModel);
  const selectedModelInfo = models?.find((model) => model.id === settings.selectedModel);
  const supportedEfforts = selectedModelInfo?.supportedEfforts ?? [];
  const currentEffortUnavailable =
    settings.reasoningEffort !== "none" && !supportedEfforts.includes(settings.reasoningEffort);

  return (
    <section className="ai-settings" aria-label="DeepSeek AI 设置" data-testid="ai-settings">
      <section className="settings-section ai-settings-section" aria-labelledby="ai-provider-title">
        <div>
          <h3 id="ai-provider-title">AI 服务</h3>
          <p>当前使用 DeepSeek。只有你主动发起 AI 请求时，相关请求文本才会发送给 DeepSeek API。</p>
        </div>
        <dl className="ai-settings-summary">
          <div>
            <dt>服务商</dt>
            <dd>DeepSeek</dd>
          </div>
          <div>
            <dt>API Key</dt>
            <dd aria-live="polite">
              {credentialUnavailable
                ? "安全凭据服务不可用"
                : credentialConfigured === null
                  ? "正在读取配置状态…"
                  : credentialConfigured
                    ? "API Key 已配置"
                    : "未配置"}
            </dd>
          </div>
        </dl>
        {credentialUnavailable && (
          <p className="form-error" role="alert">
            {credentialError}
          </p>
        )}
        {!credentialUnavailable && credentialConfigured === true && !showKeyInput && (
          <div className="ai-settings-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setShowKeyInput(true)}
            >
              替换 API Key
            </button>
            <button type="button" className="danger-button" onClick={() => void deleteKey()}>
              删除 API Key
            </button>
          </div>
        )}
        {!credentialUnavailable && showKeyInput && (
          <div className="ai-key-editor">
            <label htmlFor="deepseek-api-key">
              {credentialConfigured ? "输入新的 DeepSeek API Key" : "DeepSeek API Key"}
            </label>
            <input
              id="deepseek-api-key"
              type="password"
              autoComplete="new-password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              aria-describedby="deepseek-key-note"
              disabled={savingKey}
              data-testid="deepseek-api-key"
            />
            <p id="deepseek-key-note" className="settings-domain-note">
              密钥仅保存在 Windows 安全凭据管理器，不会写入应用设置或浏览器存储。
            </p>
            <div className="ai-settings-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => void saveKey()}
                disabled={!apiKey.trim() || savingKey}
              >
                {savingKey ? "正在安全保存…" : credentialConfigured ? "保存新密钥" : "保存 API Key"}
              </button>
              {credentialConfigured && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setApiKey("");
                    setShowKeyInput(false);
                    setCredentialError("");
                  }}
                  disabled={savingKey}
                >
                  取消
                </button>
              )}
            </div>
          </div>
        )}
        {credentialError && !credentialUnavailable && (
          <p className="form-error" role="alert">
            {credentialError}
          </p>
        )}
      </section>

      <section className="settings-section ai-settings-section" aria-labelledby="ai-model-title">
        <div>
          <h3 id="ai-model-title">模型</h3>
          <p>连接测试不会生成内容，也不会发送课程、任务、日记或其他工作台数据。</p>
        </div>
        <label className="ai-settings-field" htmlFor="deepseek-model">
          <span>DeepSeek 模型</span>
          <select
            id="deepseek-model"
            value={settings.selectedModel}
            onChange={(event) =>
              saveSettings({
                selectedModel: event.target.value as AiProviderSettings["selectedModel"],
              })
            }
          >
            {!selectedIsAvailable && (
              <option value={settings.selectedModel} disabled>
                {MODEL_LABELS[settings.selectedModel]}（当前不可用，请重新选择）
              </option>
            )}
            {supportedModels.map((model) => (
              <option key={model.id} value={model.id}>
                {MODEL_LABELS[model.id as (typeof AI_MODEL_IDS)[number]]}
              </option>
            ))}
          </select>
        </label>
        {models && !selectedIsAvailable && (
          <p className="ai-settings-warning" role="status">
            当前模型不可用，请重新选择。已保留原选择，未自动切换。
          </p>
        )}
        <div className="ai-settings-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void discoverModels("test")}
            disabled={credentialConfigured !== true || activeDiscovery !== null}
          >
            {activeDiscovery === "test" ? "正在测试…" : "测试连接"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void discoverModels("refresh")}
            disabled={credentialConfigured !== true || activeDiscovery !== null}
          >
            {activeDiscovery === "refresh" ? "正在刷新…" : "刷新模型"}
          </button>
        </div>
        {connectionMessage && (
          <p
            className={
              connectionState === "error"
                ? "form-error ai-connection-status"
                : "form-message ai-connection-status"
            }
            role={connectionState === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {connectionMessage}
          </p>
        )}
      </section>

      <details className="ai-settings-advanced">
        <summary>高级设置</summary>
        <div className="settings-fields ai-settings-advanced-fields">
          <label className="ai-settings-field" htmlFor="ai-reasoning-effort">
            <span>推理模式</span>
            <select
              id="ai-reasoning-effort"
              value={settings.reasoningEffort}
              onChange={(event) => {
                const next = event.target.value as AiReasoningEffort;
                if (next !== "none" && !supportedEfforts.includes(next)) return;
                saveSettings({ reasoningEffort: next });
              }}
            >
              <option value="none">关闭（默认）</option>
              {AI_REASONING_EFFORTS.filter((effort) => effort !== "none").map((effort) => (
                <option key={effort} value={effort} disabled={!supportedEfforts.includes(effort)}>
                  {effort === "low" ? "低" : effort === "high" ? "高" : "最高"}
                </option>
              ))}
            </select>
          </label>
          <label className="ai-settings-field" htmlFor="ai-request-timeout">
            <span>请求超时（秒）</span>
            <input
              id="ai-request-timeout"
              type="number"
              min="5"
              max="120"
              step="1"
              value={timeoutDraft}
              onChange={(event) => setTimeoutDraft(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary-button ai-settings-save-timeout"
            onClick={() => {
              const value = Number(timeoutDraft);
              if (!Number.isInteger(value) || value < 5 || value > 120) {
                setSettingsMessage("请求超时必须设置为 5–120 秒。");
                setTimeoutDraft(String(settings.requestTimeoutSeconds));
                return;
              }
              saveSettings({ requestTimeoutSeconds: value });
            }}
          >
            保存高级设置
          </button>
        </div>
        {currentEffortUnavailable && (
          <p className="ai-settings-warning" role="status">
            当前推理模式未被模型能力确认；请测试连接后选择受支持的级别。原设置已保留。
          </p>
        )}
      </details>
      {settingsMessage && (
        <p className="settings-domain-note" role="status">
          {settingsMessage}
        </p>
      )}
    </section>
  );
}
