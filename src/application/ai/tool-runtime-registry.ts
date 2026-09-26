import { AI_TOOL_ADAPTERS } from "./tool-adapters.ts";
import { createAiToolRegistry } from "./tool-registry.ts";

export const aiToolRegistry = createAiToolRegistry(AI_TOOL_ADAPTERS);
