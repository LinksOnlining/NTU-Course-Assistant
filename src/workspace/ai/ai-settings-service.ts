import { DeepSeekProvider } from "../../application/ai/deepseek-provider.ts";
import { normalizeAiDataAccessSettings } from "../../application/ai/permission.ts";
import {
  normalizeAiProviderSettings,
  type AiProviderSettings,
} from "../../application/ai/settings.ts";
import {
  loadAiProviderSettingsRecord,
  saveAiProviderSettingsRecord,
} from "../../services/ai-provider-settings-storage.ts";
import { DeepSeekNativeBridge } from "../../services/deepseek-native-bridge.ts";
import {
  loadAiDataAccessSettingsRecord,
  saveAiDataAccessSettingsRecord,
} from "../../services/ai-data-access-storage.ts";

const loadSettings = () => normalizeAiProviderSettings(loadAiProviderSettingsRecord());
const provider = new DeepSeekProvider(new DeepSeekNativeBridge(), loadSettings);

export const aiSettingsService = {
  loadSettings,
  loadDataAccessSettings: () => normalizeAiDataAccessSettings(loadAiDataAccessSettingsRecord()),
  saveDataAccessSettings(value: unknown): boolean {
    return saveAiDataAccessSettingsRecord(normalizeAiDataAccessSettings(value));
  },
  saveSettings(settings: AiProviderSettings): boolean {
    return saveAiProviderSettingsRecord(normalizeAiProviderSettings(settings));
  },
  getCredentialStatus: () => provider.getCredentialStatus(),
  saveCredential: (secret: string) => provider.saveCredential(secret),
  deleteCredential: () => provider.deleteCredential(),
  testConnection: () => provider.testConnection(),
  refreshModels: () => provider.refreshModels(),
  provider,
};
