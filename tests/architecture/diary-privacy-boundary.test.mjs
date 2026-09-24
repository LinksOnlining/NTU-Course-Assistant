import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Diary frontend stays local and never logs or sends the body to a network layer", () => {
  const service = source("src/services/diary-storage.ts");
  const page = source("src/workspace/diary/WorkspaceDiaryPage.tsx");
  const autosave = source("src/workspace/diary/diary-autosave.ts");
  for (const contents of [service, page, autosave]) {
    assert.doesNotMatch(contents, /\bfetch\s*\(|console\.|analytics|weather|updater|AI/u);
  }
  assert.match(service, /invoke<DiaryEntry>\("save_diary_entry"/u);
  assert.doesNotMatch(service, /console\.(?:log|warn|error)/u);
  assert.doesNotMatch(page, /body\s*\)\s*=>\s*console|console\..*body/u);
});

test("Dashboard Diary projection receives only a boolean status, never entry content", () => {
  const dashboard = source("src/application/workspace/workspace-dashboard.ts");
  const types = source("src/application/workspace/types.ts");
  const component = source("src/workspace/dashboard/WorkspaceDashboard.tsx");
  assert.match(dashboard, /hasDiaryEntry\?\.\(date\)/u);
  assert.match(types, /hasDiaryToday\?: boolean/u);
  assert.doesNotMatch(dashboard, /loadDiaryEntry|diaryBody|diarySnippet/u);
  assert.doesNotMatch(component, /\.body|\.rawText/u);
});

test("Rust Diary model is not debug-formattable and its repository validates dates without logging text", () => {
  const models = source("src-tauri/src/models.rs");
  const database = source("src-tauri/src/db.rs");
  const diaryStart = models.indexOf("pub struct DiaryEntry");
  const diaryModel = models.slice(diaryStart, models.indexOf("}", diaryStart) + 1);
  assert.doesNotMatch(diaryModel, /Debug/u);
  assert.match(database, /pub fn load_diary_entry/u);
  assert.match(database, /parse_date\(date\)/u);
  assert.doesNotMatch(database, /eprintln!\([^\n]*diary[^\n]*body/u);
});
