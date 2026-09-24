import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Workspace Search uses local application/storage readers without network, persistence, or AI", () => {
  const application = source("src/application/workspace/search.ts");
  const providerRegistry = source("src/modules/search-provider-registry.ts");
  const providers = [
    "src/application/academic/search-provider.ts",
    "src/application/planner/search-provider.ts",
    "src/application/diary/search-provider.ts",
    "src/application/inbox/search-provider.ts",
  ].map(source);
  const page = source("src/workspace/search/WorkspaceSearchPage.tsx");
  for (const contents of [application, providerRegistry, ...providers, page]) {
    assert.doesNotMatch(
      contents,
      /\bfetch\s*\(|XMLHttpRequest|console\.|analytics|updater|weather|AI/u,
    );
  }
  assert.doesNotMatch(application, /localStorage|sessionStorage|searchHistory|historyStorage/u);
  assert.match(application, /workspaceSearchProviders/u);
  assert.match(application, /loadWorkspaceSearchIndex/u);
  assert.match(providers[0], /loadAcademicSearchData/u);
  assert.match(providers[1], /loadPlannerEventsForSearch/u);
  assert.match(providers[2], /loadDiarySearchEntries/u);
  assert.match(providers[3], /loadInboxItems/u);
  assert.doesNotMatch(`${application}\n${providers.join("\n")}`, /TimeBlock|loadTimeBlocks/u);
});

test("Private Diary and Inbox text is read only for local matching and is not returned as raw index fields", () => {
  const academicProvider = source("src/application/academic/search-provider.ts");
  const plannerProvider = source("src/application/planner/search-provider.ts");
  const diaryProvider = source("src/application/diary/search-provider.ts");
  const inboxProvider = source("src/application/inbox/search-provider.ts");
  const diaryService = source("src/services/diary-storage.ts");
  const inboxService = source("src/services/inbox-storage.ts");
  assert.match(diaryProvider, /body: entry\.body/u);
  assert.match(inboxProvider, /body: entry\.rawText/u);
  assert.match(
    source("src/application/workspace/search.ts"),
    /rank === 4 \? searchSnippet\(entry\.bodyText\)/u,
  );
  for (const provider of [academicProvider, plannerProvider, diaryProvider, inboxProvider]) {
    assert.doesNotMatch(provider, /console\.|fetch\s*\(/u);
  }
  assert.doesNotMatch(diaryService, /console\.(?:log|warn|error)/u);
  assert.doesNotMatch(inboxService, /console\.(?:log|warn|error)/u);
});
