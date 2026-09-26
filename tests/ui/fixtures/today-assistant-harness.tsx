import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { AiPlannerProposal } from "../../../src/application/ai/proposal.ts";
import type {
  AiWorkflowOrchestrator,
  AiWorkflowResult,
} from "../../../src/application/ai/workflow-orchestrator.ts";
import type { AiProposalApplyResult } from "../../../src/application/ai/proposal-runtime.ts";
import { TodayAssistantPanel } from "../../../src/workspace/ai/TodayAssistantPanel.tsx";
import "../../../src/theme/theme.css";
import "../../../src/styles.css";

const proposal: AiPlannerProposal = {
  id: "ui-time-block-proposal",
  type: "timeBlock",
  requiredPermission: "planner.propose",
  requiresConfirmation: true,
  status: "reviewRequired",
  title: "建议安排复习时间",
  description: "为今天的任务安排一段复习时间。",
  payload: {
    personalTaskId: "task-1",
    date: "2026-09-26",
    startTime: "14:00",
    endTime: "15:00",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
  },
  createdAt: "2026-09-26T10:00:00.000Z",
  expiresAt: "2026-09-26T10:15:00.000Z",
  source: "deepseek",
  preview: {
    revision: 1,
    fields: [
      { label: "日期", value: "2026-09-26" },
      { label: "时间", value: "14:00–15:00" },
    ],
    warnings: [],
  },
  preconditions: { warningFingerprint: "none" },
};

const mode = new URLSearchParams(location.search).get("mode") ?? "ready";
let requestCount = 0;
let confirmationCount = 0;
let cancellationCount = 0;
const testWindow = window as Window & { __todayRequestCount?: number };

const result: AiWorkflowResult = {
  workflowId: "today.analyze",
  answer: "今天有两项安排，午后适合安排复习。",
  analysis: {
    summary: "今天有两项安排，午后有可用时间。",
    risks: ["截止事项集中在下午。"],
    suggestions: ["午后预留复习时间。"],
    limitations: [],
  },
  usedScopes: ["workspace.read", "planner.read"],
  usedModules: ["工作台", "任务与日程"],
  usedTools: ["workspace_get_overview"],
  limitations: [],
};

const service = {
  async run({ workflowId }: { readonly workflowId: "today.analyze" | "today.plan" }) {
    requestCount += 1;
    testWindow.__todayRequestCount = (testWindow.__todayRequestCount ?? 0) + 1;
    if (mode === "delay") await new Promise((resolve) => window.setTimeout(resolve, 160));
    if (mode === "no-permissions") return { status: "noPermissions" as const };
    if (mode === "not-configured") return { status: "notConfigured" as const };
    if (mode === "credential") {
      return {
        status: "failed" as const,
        category: "credential" as const,
        message: "DeepSeek 凭据无效或暂不可用；请在 AI 设置中检查。",
      };
    }
    if (mode === "error" && requestCount === 1) {
      return {
        status: "failed" as const,
        category: "network" as const,
        message: "网络不可用，请检查连接后重试。",
      };
    }
    if (mode === "hallucinated-success") {
      return {
        status: "ready" as const,
        result: {
          ...result,
          workflowId,
          analysis: undefined,
          answer: "任务已创建",
          proposal: undefined,
        },
      };
    }
    return {
      status: "ready" as const,
      result: {
        ...result,
        workflowId,
        ...(workflowId === "today.plan" ? { proposal } : {}),
      },
    };
  },
} as AiWorkflowOrchestrator;

function Harness() {
  const [open, setOpen] = useState(false);
  const [settingsOpened, setSettingsOpened] = useState(false);
  const [applied, setApplied] = useState(false);

  async function confirm(value: AiPlannerProposal): Promise<AiProposalApplyResult> {
    confirmationCount += 1;
    return {
      status: "applied",
      proposal: { ...value, status: "applied" },
      entityId: "created-ui-test",
    };
  }

  return (
    <main>
      <button type="button" onClick={() => setOpen(true)} data-testid="open-assistant">
        打开今日助手
      </button>
      <p data-testid="confirmation-count">{confirmationCount}</p>
      <p data-testid="cancellation-count">{cancellationCount}</p>
      {settingsOpened && <p data-testid="settings-opened">AI 设置已打开</p>}
      {applied && <p data-testid="applied">已刷新工作台</p>}
      {open && (
        <TodayAssistantPanel
          service={service}
          onOpenSettings={() => setSettingsOpened(true)}
          onConfirmProposal={confirm}
          onCancelProposal={() => {
            cancellationCount += 1;
          }}
          onApplied={() => setApplied(true)}
          onClose={() => setOpen(false)}
        />
      )}
    </main>
  );
}

const theme = new URLSearchParams(location.search).get("theme");
if (theme === "dark") document.documentElement.dataset.theme = "dark";
const root = document.getElementById("root");
if (!root) throw new Error("Missing test root");
createRoot(root).render(<Harness />);
