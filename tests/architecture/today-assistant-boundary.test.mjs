import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { TODAY_AI_WORKFLOWS } from "../../src/application/ai/today-workflows.ts";

const source = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("Today Assistant workflows keep stable one-shot IDs and explicit capabilities", () => {
  assert.deepEqual(Object.keys(TODAY_AI_WORKFLOWS).sort(), ["today.analyze", "today.plan"]);
  assert.deepEqual(TODAY_AI_WORKFLOWS["today.analyze"].allowedProposalToolIds, []);
  assert.deepEqual(TODAY_AI_WORKFLOWS["today.plan"].allowedProposalToolIds, [
    "planner.propose-time-block",
  ]);
  assert.ok(TODAY_AI_WORKFLOWS["today.analyze"].allowedReadToolIds.includes("workspace.overview"));
});

test("AI workflow orchestration uses Context Engine and AIToolRegistry without persistence or direct network", () => {
  const orchestrator = source("src/application/ai/workflow-orchestrator.ts");
  const service = source("src/workspace/ai/today-assistant-service.ts");
  const sources = source("src/workspace/ai/today-context-sources.ts");
  assert.match(orchestrator, /contextProvider\.buildContext/u);
  assert.match(orchestrator, /runAiToolLoop/u);
  assert.match(orchestrator, /allowedReadToolIds/u);
  assert.match(orchestrator, /allowedToolIds: \[\.\.\.workflow\.allowedProposalToolIds\]/u);
  assert.match(service, /aiToolRegistry/u);
  assert.doesNotMatch(orchestrator, /(?:^|[/\\])(?:repository|database|sqlite|db)\//imu);
  assert.doesNotMatch(orchestrator, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u);
  assert.doesNotMatch(sources, /(?:diary\.body|inbox\.raw|loadDiary|loadInbox|rawText|\.body\b)/iu);
});

test("AI only starts from explicit user action and Planner writes remain behind proposal review", () => {
  const panel = source("src/workspace/ai/TodayAssistantPanel.tsx");
  const dashboard = source("src/workspace/dashboard/WorkspaceDashboard.tsx");
  const review = source("src/workspace/ai/AiProposalReview.tsx");
  const app = source("src/App.tsx");
  assert.match(dashboard, /<TodayAssistantPanel/u);
  assert.match(panel, /onClick=\{\(\) => void run\("today\.analyze", ""\)\}/u);
  assert.match(panel, /onClick=\{\(\) => void run\("today\.plan",/u);
  assert.match(panel, /data-testid="today-assistant-send"/u);
  assert.match(panel, /resolveTodayAssistantWorkflow\(instruction\)/u);
  assert.doesNotMatch(panel, /aria-modal|today-assistant-backdrop|onClose/u);
  assert.match(panel, /<AiProposalReview/u);
  assert.match(panel, /inline\s*$/mu);
  assert.match(review, /inline \? "ai-proposal-inline"/u);
  assert.match(dashboard, /aiPlannerProposalRuntime\.apply/u);
  assert.match(dashboard, /confirmed: true/u);
  assert.match(dashboard, /permissionIds: \["planner\.propose"\]/u);
  assert.match(app, /openSettings\("AI"\)/u);
  assert.doesNotMatch(panel, /conversation|chat history|新建会话|消息历史/iu);
});
