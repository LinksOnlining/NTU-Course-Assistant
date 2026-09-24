import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../../src/application/workspace/", import.meta.url));
const contextSource = readFileSync(`${root}workspace-context.ts`, "utf8");

test("WorkspaceContext exposes summaries and status, never Diary/Inbox body or task descriptions", () => {
  const contract =
    contextSource.split("export interface WorkspaceContext {")[1]?.split("}\n")[0] ?? "";
  assert.match(contract, /currentItem/u);
  assert.match(contract, /nextItem/u);
  assert.match(contract, /nextFreeSlot/u);
  assert.match(contract, /overdueTaskCount/u);
  assert.match(contract, /todayTaskCount/u);
  assert.match(contract, /hasDiaryToday/u);
  assert.match(contract, /pendingInboxCount/u);
  assert.doesNotMatch(contract, /description|diaryBody|diaryText|inboxRaw|inboxText/u);
});

test("WorkspaceContext is a pure projection without storage, Tauri, or network access", () => {
  const projection = contextSource.split("export function buildWorkspaceContext(")[1] ?? "";
  assert.doesNotMatch(projection, /fetch\s*\(|invoke\s*\(|localStorage|sqlite|readFile/u);
  assert.match(projection, /weatherSummary\(input\.weatherSnapshot\)/u);
});
