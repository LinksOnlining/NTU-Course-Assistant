import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { TODAY_AI_WORKFLOWS } from "../../src/application/ai/today-workflows.ts";

const source = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");

test("Daily Brief and Today Assistant workflows keep stable one-shot IDs and explicit capabilities", () => {
  assert.deepEqual(Object.keys(TODAY_AI_WORKFLOWS).sort(), [
    "dailyBrief.generate",
    "today.analyze",
    "today.plan",
  ]);
  assert.deepEqual(TODAY_AI_WORKFLOWS["today.analyze"].allowedProposalToolIds, []);
  assert.deepEqual(TODAY_AI_WORKFLOWS["today.plan"].allowedProposalToolIds, [
    "planner.propose-time-block",
  ]);
  assert.deepEqual(TODAY_AI_WORKFLOWS["dailyBrief.generate"].allowedProposalToolIds, []);
  assert.deepEqual(TODAY_AI_WORKFLOWS["dailyBrief.generate"].allowedReadToolIds, []);
  assert.equal(TODAY_AI_WORKFLOWS["dailyBrief.generate"].responseMode, "daily-brief");
  assert.ok(TODAY_AI_WORKFLOWS["today.analyze"].allowedReadToolIds.includes("workspace.overview"));
});

test("AI workflow orchestration uses Context Engine and AIToolRegistry without persistence or direct network", () => {
  const orchestrator = source("src/application/ai/workflow-orchestrator.ts");
  const service = source("src/workspace/ai/today-assistant-service.ts");
  const sources = source("src/workspace/ai/today-context-sources.ts");
  const plannerAssistant = source("src/application/ai/planner-assistant.ts");
  assert.match(orchestrator, /contextProvider\.buildContext/u);
  assert.match(orchestrator, /runAiToolLoop/u);
  assert.match(orchestrator, /allowedReadToolIds/u);
  assert.match(orchestrator, /allowedToolIds: \[\.\.\.workflow\.allowedProposalToolIds\]/u);
  assert.match(service, /aiToolRegistry/u);
  assert.doesNotMatch(orchestrator, /(?:^|[/\\])(?:repository|database|sqlite|db)\//imu);
  assert.doesNotMatch(orchestrator, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u);
  assert.match(plannerAssistant, /computeFreeTimeIntervals/u);
  assert.doesNotMatch(plannerAssistant, /Repository|SQLite|database|fetch\s*\(/iu);
  assert.doesNotMatch(sources, /(?:diary\.body|inbox\.raw|loadDiary|loadInbox|rawText|\.body\b)/iu);
});

test("Daily Summary runtime is removed while schema 8 remains migration-compatible", () => {
  const runtimeFiles = [
    "src/workspace/dashboard/WorkspaceDashboard.tsx",
    "src/workspace/ai/DailyBriefPanel.tsx",
    "src/workspace/ai/AISettingsPanel.tsx",
    "src/application/ai/today-workflows.ts",
    "src/application/ai/workflow-orchestrator.ts",
    "src/application/ai/context-projector.ts",
    "src/workspace/ai/today-context-sources.ts",
    "src-tauri/src/lib.rs",
  ];
  for (const file of runtimeFiles) {
    assert.doesNotMatch(
      source(file),
      /dailySummary|DailySummary|daily_summaries|今日总结|每日总结/u,
      file,
    );
  }
  const database = source("src-tauri/src/db.rs");
  assert.match(database, /CREATE TABLE daily_summaries/u);
  assert.doesNotMatch(
    database,
    /pub fn (?:load|save)_daily_summary|load_daily_summaries_in_range/u,
  );
});

test("AI only starts from explicit user action and Planner writes remain behind proposal review", () => {
  const panel = source("src/workspace/ai/TodayAssistantPanel.tsx");
  const dashboard = source("src/workspace/dashboard/WorkspaceDashboard.tsx");
  const review = source("src/workspace/ai/AiProposalReview.tsx");
  const app = source("src/App.tsx");
  assert.match(dashboard, /<TodayAssistantPanel/u);
  assert.match(panel, /onClick=\{\(\) => void run\("today\.analyze", ""\)\}/u);
  assert.match(panel, /run\("planner\.route"\)/u);
  assert.match(panel, /run\("planner\.route", "请帮我安排今天的时间。"\)/u);
  assert.doesNotMatch(panel, /resolveTodayAssistantWorkflow/u);
  assert.match(panel, /data-testid="today-assistant-send"/u);
  assert.doesNotMatch(
    source("src/workspace/ai/today-assistant-routing.ts"),
    /resolveTodayAssistantWorkflow/u,
  );
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
