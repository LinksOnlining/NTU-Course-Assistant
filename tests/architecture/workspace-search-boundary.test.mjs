import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Workspace Search uses local application/storage readers without network, persistence, or AI", () => {
  const application = source("src/application/workspace/search.ts");
  const page = source("src/workspace/search/WorkspaceSearchPage.tsx");
  for (const contents of [application, page]) {
    assert.doesNotMatch(
      contents,
      /\bfetch\s*\(|XMLHttpRequest|console\.|analytics|updater|weather|AI/u,
    );
  }
  assert.doesNotMatch(application, /localStorage|sessionStorage|searchHistory|historyStorage/u);
  assert.match(application, /loadAcademicSearchData/u);
  assert.match(application, /loadDiaryEntriesForSearch/u);
  assert.match(application, /loadAllPlannerEventsForSearch/u);
  assert.doesNotMatch(application, /TimeBlock|loadTimeBlocks/u);
});

test("Private Diary and Inbox text is read only for local matching and is not returned as raw index fields", () => {
  const application = source("src/application/workspace/search.ts");
  const diaryService = source("src/services/diary-storage.ts");
  const inboxService = source("src/services/inbox-storage.ts");
  assert.match(application, /bodyText: value\.body \?\? ""/u);
  assert.match(application, /body: entry\.body/u);
  assert.match(application, /body: entry\.rawText/u);
  assert.match(application, /summary: rank === 4 \? snippet\(entry\.bodyText\)/u);
  assert.doesNotMatch(application, /console\.|fetch\s*\(/u);
  assert.doesNotMatch(diaryService, /console\.(?:log|warn|error)/u);
  assert.doesNotMatch(inboxService, /console\.(?:log|warn|error)/u);
});
