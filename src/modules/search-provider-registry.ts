import { bindCapabilityImplementations, workplaceModuleRegistry } from "./registry.ts";
import type { CapabilityContribution } from "./contracts.ts";
import type { WorkspaceSearchRecord } from "./search-contract.ts";

export interface SearchProvider extends CapabilityContribution {
  loadIndex(): Promise<readonly WorkspaceSearchRecord[]>;
}

/** 把模块声明绑定到各 Application provider，缺失或错属实现会在启动时失败。 */
export function bindSearchProviders(
  implementations: readonly SearchProvider[],
): readonly SearchProvider[] {
  return bindCapabilityImplementations(
    "Search provider",
    workplaceModuleRegistry.searchProviders,
    implementations,
  );
}
