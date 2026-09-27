import { createRoot } from "react-dom/client";
import type {
  AiPlannerProposal,
  EventProposalPayload,
  TaskProposalPayload,
} from "../../../src/application/ai/proposal.ts";
import type {
  InboxInterpretationResult,
  InboxRecognitionDraft,
  SensitiveAiService,
} from "../../../src/application/ai/sensitive-workflows.ts";
import type { InboxItem } from "../../../src/types/inbox.ts";
import { InboxSensitiveAiPanel } from "../../../src/workspace/inbox/InboxSensitiveAiPanel.tsx";
import "../../../src/theme/theme.css";
import "../../../src/styles.css";

const item: InboxItem = {
  id: "inbox-ui-editable-test",
  rawText: "原始收件箱内容只读哨兵",
  status: "pending",
  parseKind: null,
  parsePayloadJson: null,
  parserVersion: null,
  confirmedTargetType: null,
  confirmedTargetId: null,
  createdAt: "2026-09-23T04:00:00.000Z",
  updatedAt: "2026-09-23T04:00:00.000Z",
};

const interpretation: InboxInterpretationResult = {
  summary: "识别到一条尚待整理的内容。",
  detectedType: "unknown",
  title: "AI 识别标题",
  description: "AI 识别说明",
  date: null,
  startTime: null,
  endTime: null,
  deadlineDate: null,
  deadlineTime: null,
  location: null,
  uncertainties: [],
  missingFields: [],
  limitations: [],
};

function proposal(type: "task" | "event", payload: TaskProposalPayload | EventProposalPayload) {
  return {
    id: `editable-${type}-proposal`,
    type,
    source: "deepseek",
    createdAt: "2026-09-23T04:00:00.000Z",
    expiresAt: "2026-09-23T04:15:00.000Z",
    status: "reviewRequired",
    requiredPermission: "planner.propose",
    requiresConfirmation: true,
    title: type === "task" ? "建议创建任务" : "建议创建活动",
    description: "待确认提案",
    payload,
    preview: {
      title: type === "task" ? "建议创建任务" : "建议创建活动",
      fields: [{ label: "标题", value: payload.title }],
      warnings: [],
      revision: 1,
    },
    preconditions: { warningFingerprint: "test" },
  } as AiPlannerProposal;
}

declare global {
  interface Window {
    __inboxAiPanelTest: { draft: InboxRecognitionDraft | null; rawText: string };
  }
}

window.__inboxAiPanelTest = { draft: null, rawText: item.rawText };

const aiService = {
  async isConfigured() {
    return true;
  },
  async interpretSelectedInbox() {
    return { status: "ready", result: interpretation, truncated: false, omittedBytes: 0 } as const;
  },
  async proposeInboxTask(_selected: unknown, _result: unknown, draft?: InboxRecognitionDraft) {
    window.__inboxAiPanelTest.draft = draft ?? null;
    const task: TaskProposalPayload = {
      title: draft?.title ?? "",
      description: draft?.description,
      deadlineDate: draft?.deadlineDate || null,
      deadlineTime: draft?.deadlineTime || null,
      priority: draft?.priority ?? "none",
    };
    return { status: "ready", proposal: proposal("task", task) } as const;
  },
  async proposeInboxEvent(_selected: unknown, _result: unknown, draft?: InboxRecognitionDraft) {
    window.__inboxAiPanelTest.draft = draft ?? null;
    const event: EventProposalPayload = {
      title: draft?.title ?? "",
      description: draft?.description,
      date: draft?.date ?? "",
      startTime: draft?.startTime ?? "",
      endTime: draft?.endTime ?? "",
      location: draft?.location || null,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
    };
    return { status: "ready", proposal: proposal("event", event) } as const;
  },
  async confirmInboxProposal() {
    return {
      status: "applied",
      proposal: proposal("task", {
        title: "test",
        deadlineDate: null,
        deadlineTime: null,
        priority: "none",
      }),
      entityId: "test",
    } as const;
  },
  cancelProposal() {},
  async reflectSelectedDiary() {
    throw new Error("not used");
  },
} as unknown as SensitiveAiService;

function Harness() {
  return (
    <main style={{ maxWidth: 760, margin: "24px auto", padding: 16 }}>
      <p data-testid="raw-source">{item.rawText}</p>
      <InboxSensitiveAiPanel
        item={item}
        onOpenSettings={() => {}}
        onApplied={() => {}}
        aiService={aiService}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
