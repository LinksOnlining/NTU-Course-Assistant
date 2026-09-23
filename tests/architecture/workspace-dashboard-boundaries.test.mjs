import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseSync } from "oxc-parser";

const root = fileURLToPath(new URL("../../src/", import.meta.url));

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(file) : /\.(?:ts|tsx)$/u.test(entry.name) ? [file] : [];
  });
}

function importsFrom(filePath) {
  const source = readFileSync(filePath, "utf8");
  const { program, errors } = parseSync(filePath, source);
  assert.deepEqual(errors, [], path.relative(root, filePath));
  return program.body
    .filter((node) => node.type === "ImportDeclaration")
    .map((node) => node.source.value);
}

test("Timeline and Workspace application layers never reach presentation, storage, or Tauri", () => {
  for (const directory of ["application/timeline", "application/workspace"]) {
    for (const file of filesBelow(path.join(root, directory))) {
      const imports = importsFrom(file).join("\n");
      assert.doesNotMatch(
        imports,
        /(?:components|workspace\/dashboard|course-storage|academic-storage|@tauri-apps|sqlite|db\.rs)/u,
        path.relative(root, file),
      );
    }
  }
});

test("Workspace dashboard presentation consumes application projections only", () => {
  const dashboardRoot = path.join(root, "workspace/dashboard");
  for (const file of filesBelow(dashboardRoot)) {
    const imports = importsFrom(file).join("\n");
    assert.doesNotMatch(
      imports,
      /(?:course-storage|academic-storage|course-occurrence|academic-application|@tauri-apps|sqlite|db\.rs)/u,
      path.relative(root, file),
    );
  }
});

test("Only canonical AcademicCourseOccurrence is adapted to TimelineItem; deadlines stay in Task summary", () => {
  const adapterPath = path.join(root, "application/timeline/academic-timeline.ts");
  const adapterSource = readFileSync(adapterPath, "utf8");
  assert.match(adapterSource, /AcademicCourseOccurrence/u);
  assert.doesNotMatch(adapterSource, /AcademicTask|dueAt|Exam/u);

  const workspaceSource = readFileSync(
    path.join(root, "application/workspace/workspace-dashboard.ts"),
    "utf8",
  );
  assert.match(workspaceSource, /task\.dueAt/u);
  assert.doesNotMatch(workspaceSource, /sourceType:\s*["'](?:academicTask|exam)["']/u);
});

test("Workspace Dashboard combines Planner projections without turning task deadlines into schedule items", () => {
  const workspaceSource = readFileSync(
    path.join(root, "application/workspace/workspace-dashboard.ts"),
    "utf8",
  );
  assert.match(workspaceSource, /projectPlannerEventsToTimelineItems/u);
  assert.match(workspaceSource, /projectTimeBlocksToTimelineItems/u);
  assert.match(workspaceSource, /personalTasks/u);
  assert.match(workspaceSource, /taskDeadline/u);
  assert.doesNotMatch(workspaceSource, /personalTaskDeadline\([^)]*TimelineItem/u);
});

test("workspace/home renders the new Dashboard rather than the legacy AcademicHub Today branch", () => {
  const appSource = readFileSync(path.join(root, "App.tsx"), "utf8");
  assert.match(appSource, /isWorkspaceHome\s*\?\s*\(\s*<WorkspaceDashboard/u);
  assert.match(appSource, /\)\s*:\s*isAcademicHubPage\s*\?\s*\(\s*<AcademicHub/u);
});

test("Time Context is a summary projection, not a second timeline", () => {
  const source = readFileSync(
    path.join(root, "workspace/dashboard/WorkspaceDashboard.tsx"),
    "utf8",
  );
  const context = source.split("function TimeContext(")[1]?.split("function TaskCard(")[0] ?? "";
  assert.match(context, /workspace-time-context/u);
  assert.doesNotMatch(
    context,
    /timeline-tick|timeline-grid|draggable|resizable|hour ticks|<canvas/u,
  );
});

test("Settings and Timeline scrollbars share the small semantic thumb", () => {
  const settings = readFileSync(new URL("../../src/styles.css", import.meta.url), "utf8");
  const timeline = readFileSync(
    new URL("../../src/workspace/dashboard/workspace-dashboard.css", import.meta.url),
    "utf8",
  );
  const tokens = readFileSync(new URL("../../src/theme/theme.css", import.meta.url), "utf8");
  assert.match(tokens, /--scrollbar-width:\s*5px/u);
  assert.match(
    settings,
    /\.settings-domain-sidebar::-webkit-scrollbar[\s\S]*?width:\s*var\(--scrollbar-width\)/u,
  );
  assert.match(
    timeline,
    /\.workspace-timeline-viewport::-webkit-scrollbar[\s\S]*?width:\s*var\(--scrollbar-width\)/u,
  );
});
