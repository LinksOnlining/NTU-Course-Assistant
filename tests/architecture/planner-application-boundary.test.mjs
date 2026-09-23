import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const source = (pathFromRoot) =>
  readFileSync(new URL("../../" + pathFromRoot, import.meta.url), "utf8");

test("Planner Application owns PersonalTask orchestration and stays outside presentation and SQL", () => {
  const files = readdirSync(new URL("../../src/application/planner/", import.meta.url)).filter(
    (name) => name.endsWith(".ts"),
  );
  assert.ok(files.length > 0);
  for (const name of files) {
    const contents = source("src/application/planner/" + name);
    assert.doesNotMatch(
      contents,
      /(?:components|workspace\/tasks|@tauri-apps|\bSELECT\b|\bINSERT\b)/i,
    );
  }
});

test("Workspace Tasks presentation calls Application use cases rather than Tauri/storage directly", () => {
  const page = source("src/workspace/tasks/WorkspaceTasksPage.tsx");
  assert.match(page, /application\/planner\/personal-tasks\.ts/);
  assert.doesNotMatch(
    page,
    /services\/planner-storage|@tauri-apps|\bSELECT\s+.+\s+FROM\b|\bINSERT\s+INTO\b/i,
  );
});

test("PersonalTask deadlines remain outside the Timeline source adapter", () => {
  const adapter = source("src/application/timeline/academic-timeline.ts");
  assert.doesNotMatch(adapter, /PersonalTask|personal_tasks|deadlineDate/u);
});
