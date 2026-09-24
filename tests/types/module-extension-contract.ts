import type { ModuleId } from "../../src/modules/contracts.ts";
import type { AppRoute, NavigationTarget, ObjectRef } from "../../src/navigation/types.ts";
import type { WorkspaceSearchCategory } from "../../src/modules/search-contract.ts";
import type {
  WorkspaceContextFragment,
  WorkspaceContextProvider,
  WorkspaceContextProviderInputs,
} from "../../src/application/workspace/context-provider-registry.ts";

declare module "../../src/modules/contracts.ts" {
  interface ModuleIdMap {
    readonly reading: "reading";
  }
}

declare module "../../src/navigation/types.ts" {
  interface AppRouteMap {
    readonly reading: "library" | "reader";
  }

  interface ObjectRefMap {
    readonly book: { readonly type: "book"; readonly id: string };
  }
}

declare module "../../src/modules/search-contract.ts" {
  interface WorkspaceSearchCategoryMap {
    readonly reading: "reading";
  }
}

declare module "../../src/application/workspace/context-provider-registry.ts" {
  interface WorkspaceContextProviderInputMap {
    readonly "reading.context"?: { readonly topic: string };
  }

  interface WorkspaceContextFragmentMap {
    readonly readingSummary?: string;
  }
}

const moduleId: ModuleId = "reading";
const route: AppRoute = { area: "reading", page: "library" };
const object: ObjectRef = { type: "book", id: "book-1" };
const target: NavigationTarget = { route, object };
const category: WorkspaceSearchCategory = "reading";
const inputs: WorkspaceContextProviderInputs = {
  "diary.context": { hasDiaryToday: false },
  "inbox.context": { pendingInboxCount: 0 },
  "weather.context": { weatherSnapshot: null },
  "routine.context": { today: "2026-09-24", now: "10:00", routines: [], timelineItems: [] },
  "reading.context": { topic: "books" },
};
const contextProvider: WorkspaceContextProvider = {
  id: "reading.context",
  moduleId: "reading",
  order: 1,
  provide: ({ topic }) => ({ readingSummary: topic }),
};
const fragment: WorkspaceContextFragment = { readingSummary: "books" };

// @ts-expect-error A module route remains constrained to its declared page literals.
const invalidRoute: AppRoute = { area: "reading", page: "other" };
// @ts-expect-error An object reference remains constrained to its declared discriminants.
const invalidObject: ObjectRef = { type: "book", id: 1 };

void moduleId;
void target;
void category;
void inputs;
void contextProvider;
void fragment;
void invalidRoute;
void invalidObject;
