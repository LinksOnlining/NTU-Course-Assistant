import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Inbox capture persists raw before the deterministic local parser and has no network/model path", () => {
  const useCase = source("src/application/inbox/inbox.ts");
  const parser = source("src/application/inbox/inbox-parser.ts");
  const service = source("src/services/inbox-storage.ts");
  assert.ok(
    useCase.indexOf("await repository.createInboxItem") <
      useCase.indexOf("parseInboxText(rawItem.rawText"),
  );
  for (const contents of [parser, service]) {
    assert.doesNotMatch(
      contents,
      /\bfetch\s*\(|console\.|analytics|updater|weather|OpenAI|model/iu,
    );
  }
  assert.match(service, /invoke<InboxItem>\("create_inbox_item"/u);
});

test("Raw Inbox model is not Debug-formattable and dashboard receives only a count", () => {
  const models = source("src-tauri/src/models.rs");
  const dashboard = source("src/application/workspace/workspace-dashboard.ts");
  const types = source("src/application/workspace/types.ts");
  const component = source("src/workspace/dashboard/WorkspaceDashboard.tsx");
  const start = models.indexOf("pub struct InboxItem");
  const declaration = models.slice(
    models.lastIndexOf("#[derive", start),
    models.indexOf("}", start) + 1,
  );
  assert.doesNotMatch(declaration, /Debug/u);
  assert.match(dashboard, /countPendingInboxItems\?\.\(\)/u);
  assert.match(types, /pendingInboxCount\?: number/u);
  assert.doesNotMatch(dashboard, /loadInboxItems|rawText|raw_text/u);
  assert.doesNotMatch(component, /\.rawText|\.raw_text/u);
});

test("Inbox Rust commands and storage do not log raw text", () => {
  const database = source("src-tauri/src/db.rs");
  const commands = source("src-tauri/src/lib.rs");
  assert.match(database, /pub fn create_inbox_item/u);
  assert.match(database, /pub fn confirm_inbox_as_task/u);
  assert.match(database, /pub fn confirm_inbox_as_event/u);
  assert.doesNotMatch(database, /(?:eprintln!|println!|dbg!)\([^\n]*(?:raw_text|rawText)/u);
  assert.doesNotMatch(commands, /(?:eprintln!|println!|dbg!)\([^\n]*(?:raw_text|rawText)/u);
});
