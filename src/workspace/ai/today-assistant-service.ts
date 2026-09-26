import { aiToolRegistry } from "../../application/ai/tool-runtime-registry.ts";
import { createAiWorkflowOrchestrator } from "../../application/ai/workflow-orchestrator.ts";
import { aiSettingsService } from "./ai-settings-service.ts";
import { todayAssistantContextSources } from "./today-context-sources.ts";

export const todayAssistantService = createAiWorkflowOrchestrator({
  provider: aiSettingsService.provider,
  registry: aiToolRegistry,
  getPermissionSettings: aiSettingsService.loadDataAccessSettings,
  getCredentialStatus: aiSettingsService.getCredentialStatus,
  sources: todayAssistantContextSources,
});
