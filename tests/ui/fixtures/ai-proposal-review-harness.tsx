import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createAiPlannerProposalRuntime } from "../../../src/application/ai/proposal-runtime.ts";
import { runAiToolLoop } from "../../../src/application/ai/tool-runtime.ts";
import { createAiToolRegistry } from "../../../src/application/ai/tool-registry.ts";
import { BUILT_IN_MODULES } from "../../../src/modules/built-in-modules.ts";
import { createWorkplaceModuleRegistry } from "../../../src/modules/registry.ts";
import type { AiPlannerProposal } from "../../../src/application/ai/proposal.ts";
import type { AiProposalApplyResult } from "../../../src/application/ai/proposal-runtime.ts";
import { AiProposalReview } from "../../../src/workspace/ai/AiProposalReview.tsx";
import "../../../src/theme/theme.css";
import "../../../src/styles.css";

const now = new Date("2026-09-26T10:00:00.000Z");
let createdCount = 0;
const proposalRuntime = createAiPlannerProposalRuntime({
  ports: {
    now: () => now,
    createId: () => `ui-test-${createdCount}-${Math.random().toString(16).slice(2)}`,
    loadTermConfig: async () => null,
    loadScheduleDay: async (date) => ({
      date,
      events: [],
      timeBlocks: [],
      timelineItems: [],
      tasks: [],
      warnings: [],
    }),
    loadTasks: async () => [],
    createTask: async (draft) => {
      createdCount += 1;
      return { id: `ui-created-${createdCount}`, ...draft };
    },
  },
});

const planner = BUILT_IN_MODULES.find(({ id }) => id === "planner");
const taskTool = planner.aiTools.find(({ id }) => id === "planner.propose-task");
const modules = createWorkplaceModuleRegistry([{ ...planner, aiTools: [taskTool] }]);
const registry = createAiToolRegistry(
  [
    {
      id: taskTool.id,
      parseInput: (value: unknown) => value,
      execute: async (
        value: unknown,
        context?: { providerId?: string; reportProposal?: (proposal: unknown) => void },
      ) => {
        const proposal = await proposalRuntime.proposeTask(
          value as {
            title: string;
            deadlineDate: string | null;
            deadlineTime: string | null;
            priority: "none" | "low" | "medium" | "high";
          },
          context?.providerId === "deepseek" ? "deepseek" : "mock",
        );
        context?.reportProposal?.(proposal);
        return { status: "reviewRequired", proposalId: proposal.id, proposalType: proposal.type };
      },
    },
  ],
  modules,
);

function Harness() {
  const [proposal, setProposal] = useState<AiPlannerProposal | null>(null);
  const [pipeline, setPipeline] = useState("starting");
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    const mockProvider = {
      id: "mock",
      async generateToolTurn() {
        return {
          kind: "functionCalls" as const,
          calls: [
            {
              callId: "mock-proposal-call",
              name: "planner_propose_task",
              arguments: JSON.stringify({
                title: "整理本周课程资料",
                deadlineDate: "2026-09-28",
                deadlineTime: "18:00",
                priority: "high",
              }),
            },
          ],
        };
      },
    };
    void runAiToolLoop({
      request: {
        id: "mock-ai-review-request",
        intent: "plan",
        sourceModule: "planner",
        createdAt: now.toISOString(),
        prompt: "建议安排一项任务",
        context: { selectedItems: [], moduleContexts: {}, permissionScope: [] },
      },
      provider: mockProvider,
      registry,
      permissionSettings: { persistentGrants: [] },
      proposalPolicy: {
        grantedPermissionIds: ["planner.propose"],
        allowedToolIds: ["planner.propose-task"],
      },
    }).then((result) => {
      if (result.status === "proposalCreated") {
        setProposal(result.proposal);
        setPipeline("preview");
      } else {
        setPipeline(`failed:${result.status}`);
      }
    });
  }, []);

  async function confirm(value: AiPlannerProposal): Promise<AiProposalApplyResult> {
    setPipeline("revalidating");
    const result = await proposalRuntime.apply({
      id: value.id,
      confirmed: true,
      expectedPreviewRevision: value.preview.revision,
      permissionIds: ["planner.propose"],
    });
    setPipeline(result.status === "applied" ? "applied" : result.status);
    return result;
  }

  function cancel(value: AiPlannerProposal) {
    proposalRuntime.cancel(value.id);
    setCancelled(true);
    setPipeline("cancelled");
  }

  return (
    <main>
      <p data-testid="pipeline-stage">{pipeline}</p>
      <p data-testid="write-count">{createdCount}</p>
      {cancelled && <p data-testid="cancelled">提案已取消</p>}
      {proposal && <AiProposalReview proposal={proposal} onConfirm={confirm} onCancel={cancel} />}
    </main>
  );
}

const theme = new URLSearchParams(location.search).get("theme");
if (theme === "dark") document.documentElement.dataset.theme = "dark";
const root = document.getElementById("root");
if (!root) throw new Error("Missing test root");
createRoot(root).render(<Harness />);
