import { aiToolRegistry } from "../../application/ai/tool-runtime-registry.ts";
import { createSensitiveAiService } from "../../application/ai/sensitive-workflows.ts";
import { aiSettingsService } from "./ai-settings-service.ts";

export const sensitiveAiService = createSensitiveAiService({
  provider: aiSettingsService.provider,
  registry: aiToolRegistry,
  getPermissionSettings: aiSettingsService.loadDataAccessSettings,
  getCredentialStatus: aiSettingsService.getCredentialStatus,
});
