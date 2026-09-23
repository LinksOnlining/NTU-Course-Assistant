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

test("Workspace Schedule presentation uses the Application read pipeline", () => {
  const page = source("src/workspace/schedule/WorkspaceSchedulePage.tsx");
  assert.match(page, /application\/workspace\/index\.ts/u);
  assert.match(page, /application\/planner\/planner-schedule\.ts/u);
  assert.doesNotMatch(page, /services\/|@tauri-apps|\bSELECT\b|\bINSERT\b/u);
  const application = source("src/application/workspace/workspace-schedule.ts");
  assert.match(application, /resolveAcademicOccurrences/u);
  assert.match(application, /loadPlannerEvents/u);
  assert.match(application, /loadTimeBlocks/u);
});

test("PersonalTask deadlines remain outside the Timeline source adapter", () => {
  const adapter = source("src/application/timeline/academic-timeline.ts");
  assert.doesNotMatch(adapter, /PersonalTask|personal_tasks|deadlineDate/u);
});

test("PlannerEvent and TimeBlock timeline adapters preserve source identity and real intervals", () => {
  const adapter = source("src/application/timeline/planner-timeline.ts");
  assert.match(adapter, /sourceType: "plannerEvent"/u);
  assert.match(adapter, /sourceRef: \{ type: "plannerEvent", id: event\.id \}/u);
  assert.match(adapter, /sourceType: "timeBlock"/u);
  assert.match(adapter, /sourceRef: \{ type: "timeBlock", id: block\.id \}/u);
  assert.match(adapter, /startTime: block\.startTime/u);
  assert.match(adapter, /endTime: block\.endTime/u);
  assert.doesNotMatch(adapter, /bufferBeforeMinutes|bufferAfterMinutes/u);
  assert.doesNotMatch(adapter, /deadlineDate/u);
});

test("Planner editors use Application validation and do not reach storage directly", () => {
  for (const file of [
    "src/workspace/schedule/PlannerEventEditor.tsx",
    "src/workspace/schedule/TimeBlockEditor.tsx",
  ]) {
    const editor = source(file);
    assert.match(editor, /application\/planner\/planner-schedule\.ts/u);
    assert.doesNotMatch(editor, /services\/planner-storage|@tauri-apps|\bSELECT\b|\bINSERT\b/u);
  }
});
