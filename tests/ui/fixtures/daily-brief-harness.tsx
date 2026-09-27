import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AiWorkflowOrchestrator, AiWorkflowResult } from "../../../src/application/ai/workflow-orchestrator.ts";
import type { WorkspaceDashboardSources, WorkspaceDashboardViewModel } from "../../../src/application/workspace/index.ts";
import { DailyBriefPanel } from "../../../src/workspace/ai/DailyBriefPanel.tsx";
import type { AiPlannerProposal } from "../../../src/application/ai/proposal.ts";
import type { AiProposalApplyResult } from "../../../src/application/ai/proposal-runtime.ts";
import "../../../src/theme/theme.css";
import "../../../src/styles.css";

const parameters = new URLSearchParams(location.search);
const mode = parameters.get("mode") ?? "success";
const empty = parameters.get("empty") === "1";
const date = "2026-09-23";
const result: AiWorkflowResult = {
  workflowId: "dailyBrief.generate",
  answer: "今天有一项课程安排。",
  dailyBrief: {
    mode: "ai",
    overview: "今天有一项课程安排，建议先完成近期截止事项。",
    scheduleHighlights: ["10:00–11:00 · 数学基础"],
    topPriorities: [{ title: "完成实验报告", reason: "明天截止，今天还有完整空档。", taskId: "task-1" }],
    risks: ["近期截止事项较集中。"],
    freeWindows: [],
    suggestions: [{ title: "先写实验报告提纲", reason: "该事项明天截止。" }],
    canWait: ["额外刷题今天可以先不安排。"],
    limitations: ["没有可用的已授权天气数据。"],
    sources: ["academic", "planner"],
  },
  usedScopes: ["academic.read", "planner.read"],
  usedModules: ["课程与学业", "任务与日程"],
  usedTools: [],
  limitations: [],
};

let calls = 0;
let completeSlowRequest: (() => void) | undefined;
Object.assign(window, {
  __dailyBriefCalls: () => calls,
  __completeDailyBriefRequest: () => completeSlowRequest?.(),
});

const service = {
  async run() {
    calls += 1;
    if (mode === "slow") {
      await new Promise<void>((resolve) => {
        completeSlowRequest = resolve;
      });
      completeSlowRequest = undefined;
    }
    if (mode === "no-permissions") return { status: "noPermissions" as const };
    if (mode === "not-configured") return { status: "notConfigured" as const };
    if (mode === "failure" && calls === 1) {
      return { status: "failed" as const, category: "network" as const, message: "offline" };
    }
    return { status: "ready" as const, result };
  },
} as AiWorkflowOrchestrator;

const model = {
  date,
  todayArrangements: empty ? [] : [{ id: "course-1", title: "数学基础", startTime: "10:00", endTime: "11:00", sourceLabel: "课程", cancelled: false }],
  taskSummary: { items: [], todayItems: [], totalOpenCount: 0, hiddenCount: 0 },
  warnings: [],
  timelineItems: [],
  routineSuggestion: null,
  context: { nextFreeSlot: null, weatherSummary: null },
} as unknown as WorkspaceDashboardViewModel;
const sources = {
  date,
  tasks: [{ id: "no-deadline-task", title: "无截止日期课程任务", status: "TODO", dueAt: "" }],
  personalTasks: [],
} as unknown as WorkspaceDashboardSources;

function Harness() {
  const [settingsOpened, setSettingsOpened] = useState(false);
  const [, setApplied] = useState(false);
  async function confirmProposal(proposal: AiPlannerProposal): Promise<AiProposalApplyResult> {
    return { status: "applied", proposal: { ...proposal, status: "applied" }, entityId: "task-block" };
  }
  return (
    <main>
      {settingsOpened && <p data-testid="settings-opened">AI 设置</p>}
      <DailyBriefPanel
        model={model}
        sources={sources}
        now={new Date("2026-09-23T12:00:00+08:00")}
        service={service}
        onOpenSettings={() => setSettingsOpened(true)}
        onConfirmProposal={confirmProposal}
        onCancelProposal={() => undefined}
        onApplied={() => setApplied(true)}
      />
    </main>
  );
}

const seedKey = `daily-brief-enabled-seeded:${parameters.get("empty") === "1" ? "empty" : "busy"}`;
if (parameters.get("enabled") === "1" && !sessionStorage.getItem(seedKey)) {
  localStorage.setItem(
    "links-workplace.ai.daily-brief",
    JSON.stringify({ enabled: true, lastAutoShownDate: null }),
  );
  sessionStorage.setItem(seedKey, "1");
}
const theme = parameters.get("theme");
if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
const root = document.getElementById("root");
if (!root) throw new Error("Missing test root");
createRoot(root).render(<Harness />);
