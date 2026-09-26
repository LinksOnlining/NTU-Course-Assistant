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
      { label: "任务", value: "准备验收测试" },
      { label: "日期", value: "2026-09-26" },
      { label: "开始", value: "14:00" },
      { label: "结束", value: "15:00" },
      { label: "时长", value: "60 分钟" },
    ],
    warnings: [],
  },
  preconditions: { warningFingerprint: "none" },
};

const mode = new URLSearchParams(location.search).get("mode") ?? "ready";
let requestCount = 0;
let confirmationCount = 0;
const testWindow = window as Window & {
  __todayRequestCount?: number;
  __todayWorkflow?: string;
  __todayInstruction?: string;
};

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
  async run({ workflowId, instruction = "" }: {
    readonly workflowId: "today.analyze" | "today.plan";
    readonly instruction?: string;
  }) {
    requestCount += 1;
    testWindow.__todayRequestCount = (testWindow.__todayRequestCount ?? 0) + 1;
    testWindow.__todayWorkflow = workflowId;
    testWindow.__todayInstruction = instruction;
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
        ...(mode === "markdown"
          ? {
              answer: "## 今日概览 **午后有空**",
              analysis: {
                summary: "## 午后有空\n**可以安排复习。**",
                risks: ["**下午空档较短。**"],
                suggestions: ["- 午后预留复习时间。"],
                limitations: ["**天气信息未授权。**"],
              },
            }
          : {}),
        ...(workflowId === "today.plan" ? { proposal } : {}),
      },
    };
  },
} as AiWorkflowOrchestrator;

function Harness() {
  const [settingsOpened, setSettingsOpened] = useState(false);
  const [applied, setApplied] = useState(false);
  const [cancellationCount, setCancellationCount] = useState(0);

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
      <p data-testid="confirmation-count">{confirmationCount}</p>
      <p data-testid="cancellation-count">{cancellationCount}</p>
      {settingsOpened && <p data-testid="settings-opened">AI 设置已打开</p>}
      {applied && <p data-testid="applied">已刷新工作台</p>}
      <TodayAssistantPanel
        service={service}
        onOpenSettings={() => setSettingsOpened(true)}
        onConfirmProposal={confirm}
        onCancelProposal={() => {
          setCancellationCount((value) => value + 1);
        }}
        onApplied={() => setApplied(true)}
      />
    </main>
  );
}

const theme = new URLSearchParams(location.search).get("theme");
if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
const root = document.getElementById("root");
if (!root) throw new Error("Missing test root");
createRoot(root).render(<Harness />);
