import { academicSearchProvider } from "../academic/search-provider.ts";
import { diarySearchProvider } from "../diary/search-provider.ts";
import { inboxSearchProvider } from "../inbox/search-provider.ts";
import { plannerSearchProvider } from "../planner/search-provider.ts";
import { bindSearchProviders } from "../../modules/search-provider-registry.ts";

/** 内置模块编译期 provider 清单；顺序由 ModuleRegistry 的 order/id 决定。 */
export const workspaceSearchProviders = bindSearchProviders([
  academicSearchProvider,
  plannerSearchProvider,
  diarySearchProvider,
  inboxSearchProvider,
]);
