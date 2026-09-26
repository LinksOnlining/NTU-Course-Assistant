import { useEffect, useRef, useState } from "react";
import type { AiPlannerProposal } from "../../application/ai/proposal.ts";
import type { AiProposalApplyResult } from "../../application/ai/proposal-runtime.ts";
import type {
  AiWorkflowOrchestrator,
  AiWorkflowErrorCategory,
  AiWorkflowResult,
  AiWorkflowRunResult,
} from "../../application/ai/workflow-orchestrator.ts";
import type { AiWorkflowId } from "../../application/ai/today-workflows.ts";
import { AiProposalReview } from "./AiProposalReview.tsx";
import "./today-assistant.css";

interface TodayAssistantPanelProps {
  readonly service: AiWorkflowOrchestrator;
  readonly onOpenSettings: () => void;
  readonly onConfirmProposal: (proposal: AiPlannerProposal) => Promise<AiProposalApplyResult>;
  readonly onCancelProposal: (proposal: AiPlannerProposal) => void;
  readonly onApplied: () => void;
  readonly onClose: () => void;
}

type PanelState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading"; readonly workflowId: AiWorkflowId; readonly instruction: string }
  | { readonly kind: "ready"; readonly result: AiWorkflowResult }
  | { readonly kind: "message"; readonly status: "noPermissions" | "notConfigured" | "noContext" }
  | {
      readonly kind: "failed";
      readonly workflowId: AiWorkflowId;
      readonly instruction: string;
      readonly message: string;
      readonly category: AiWorkflowErrorCategory;
    };

function resultState(
  result: AiWorkflowRunResult,
  workflowId: AiWorkflowId,
  instruction: string,
): PanelState {
  if (result.status === "ready") return { kind: "ready", result: result.result };
  if (
    result.status === "noPermissions" ||
    result.status === "notConfigured" ||
    result.status === "noContext"
  ) {
    return { kind: "message", status: result.status };
  }
  if (result.status === "busy") {
    return {
      kind: "failed",
      workflowId,
      instruction,
      message: "已有 AI 请求正在处理，请稍后重试。",
      category: "provider",
    };
  }
  return {
    kind: "failed",
    workflowId,
    instruction,
    message: result.message,
    category: result.category,
  };
}

export function TodayAssistantPanel({
  service,
  onOpenSettings,
  onConfirmProposal,
  onCancelProposal,
  onApplied,
  onClose,
}: TodayAssistantPanelProps) {
  const [instruction, setInstruction] = useState("");
  const [state, setState] = useState<PanelState>({ kind: "idle" });
  const [reviewProposal, setReviewProposal] = useState<AiPlannerProposal | null>(null);
  const [proposalCancelled, setProposalCancelled] = useState(false);
  const runningRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const reviewOpenRef = useRef(reviewProposal !== null);
  closeRef.current = onClose;
  reviewOpenRef.current = reviewProposal !== null;
  const busy = state.kind === "loading";

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (reviewOpenRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  async function run(workflowId: AiWorkflowId, text = instruction) {
    if (runningRef.current) return;
    runningRef.current = true;
    const safeInstruction = text.trim().slice(0, 500);
    setProposalCancelled(false);
    setReviewProposal(null);
    setState({ kind: "loading", workflowId, instruction: safeInstruction });
    try {
      const result = await service.run({ workflowId, instruction: safeInstruction });
      setState(resultState(result, workflowId, safeInstruction));
    } catch {
      setState({
        kind: "failed",
        workflowId,
        instruction: safeInstruction,
        message: "AI 服务暂不可用，请稍后重试。",
        category: "provider",
      });
    } finally {
      runningRef.current = false;
    }
  }

  async function confirmProposal(proposal: AiPlannerProposal): Promise<AiProposalApplyResult> {
    const result = await onConfirmProposal(proposal);
    if (result.status === "applied") onApplied();
    return result;
  }

  function cancelProposal(proposal: AiPlannerProposal) {
    onCancelProposal(proposal);
    setReviewProposal(null);
    setProposalCancelled(true);
  }

  return (
    <>
      <div
        className="today-assistant-backdrop"
        data-testid="today-assistant-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !reviewProposal) onClose();
        }}
      >
        <section
          ref={dialogRef}
          className="today-assistant-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="today-assistant-title"
          tabIndex={-1}
          data-testid="today-assistant-panel"
        >
          <header className="today-assistant-header">
            <div>
              <p className="today-assistant-eyebrow">工作台 · 一次性智能辅助</p>
              <h2 id="today-assistant-title">今日助手</h2>
            </div>
            <button
              type="button"
              className="today-assistant-close"
              aria-label="关闭今日助手"
              onClick={onClose}
              data-initial-focus
            >
              ×
            </button>
          </header>
          <div className="today-assistant-content">
            <label className="today-assistant-input-label" htmlFor="today-assistant-instruction">
              这次想了解什么？（可选）
            </label>
            <textarea
              id="today-assistant-instruction"
              value={instruction}
              onChange={(event) => setInstruction(event.target.value.slice(0, 500))}
              maxLength={500}
              rows={2}
              placeholder="例如：看看今天是否排得太满"
              disabled={busy}
              data-testid="today-assistant-instruction"
            />
            <div className="today-assistant-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void run("today.analyze")}
              >
                分析今天
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => void run("today.plan")}
              >
                帮我安排今天
              </button>
            </div>
            <p className="today-assistant-privacy">
              仅使用你在 AI 设置中允许的数据，并发送至 DeepSeek 处理。
            </p>
            <div className="today-assistant-result" aria-live="polite">
              {state.kind === "idle" && (
                <p>选择一种操作后，助手会按本次授权生成建议；不会保存对话历史。</p>
              )}
              {state.kind === "loading" && (
                <p role="status" data-testid="today-assistant-loading">
                  正在{state.workflowId === "today.plan" ? "整理今天的安排建议" : "分析今天的安排"}…
                </p>
              )}
              {state.kind === "message" && state.status === "noPermissions" && (
                <div role="status">
                  <p>当前没有允许 AI 使用的工作台数据。</p>
                  <button type="button" className="workspace-card-link" onClick={openSettings}>
                    打开 AI 数据访问设置
                  </button>
                </div>
              )}
              {state.kind === "message" && state.status === "notConfigured" && (
                <div role="status">
                  <p>请先在设置中配置 DeepSeek。</p>
                  <button type="button" className="workspace-card-link" onClick={openSettings}>
                    打开 AI 设置
                  </button>
                </div>
              )}
              {state.kind === "message" && state.status === "noContext" && (
                <p role="status">当前没有可用于本次建议的已授权数据。</p>
              )}
              {state.kind === "failed" && (
                <div role="alert">
                  <p>{state.message}</p>
                  {state.category === "credential" ? (
                    <button type="button" className="workspace-card-link" onClick={openSettings}>
                      打开 AI 设置
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="workspace-card-link"
                      onClick={() => void run(state.workflowId, state.instruction)}
                      data-testid="today-assistant-retry"
                    >
                      重试
                    </button>
                  )}
                </div>
              )}
              {state.kind === "ready" && (
                <>
                  <ResultCard result={state.result} proposalCancelled={proposalCancelled} />
                  {state.result.proposal && !proposalCancelled && (
                    <button
                      type="button"
                      className="secondary-button today-assistant-review-trigger"
                      onClick={() => setReviewProposal(state.result.proposal ?? null)}
                      data-testid="today-assistant-review-trigger"
                    >
                      查看并确认时间块提案
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </section>
      </div>
      {reviewProposal && (
        <AiProposalReview
          proposal={reviewProposal}
          onConfirm={confirmProposal}
          onCancel={cancelProposal}
        />
      )}
    </>
  );

  function openSettings() {
    onClose();
    onOpenSettings();
  }
}

function ResultCard({
  result,
  proposalCancelled,
}: {
  readonly result: AiWorkflowResult;
  readonly proposalCancelled: boolean;
}) {
  const analysis = result.analysis;
  return (
    <section className="today-assistant-result-card" data-testid="today-assistant-result">
      <h3>
        {analysis ? "今日概览" : result.workflowId === "today.plan" ? "今日建议" : "分析结果"}
      </h3>
      <p>{analysis?.summary ?? result.answer}</p>
      {analysis?.risks.length ? (
        <div>
          <h4>主要风险</h4>
          <ul>
            {analysis.risks.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {analysis?.suggestions.length ? (
        <div>
          <h4>建议安排</h4>
          <ul>
            {analysis.suggestions.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.proposal && (
        <p className="today-assistant-proposal-note">提案尚未写入数据，需要你检查并确认。</p>
      )}
      {result.workflowId === "today.plan" && !result.proposal && (
        <p className="today-assistant-proposal-note">以上仅为文本建议，尚未修改任何应用数据。</p>
      )}
      {proposalCancelled && (
        <p className="today-assistant-proposal-note">本次提案已取消，应用数据未修改。</p>
      )}
      {result.usedModules.length > 0 && (
        <p className="today-assistant-sources">基于：{result.usedModules.join("、")}</p>
      )}
      {result.limitations.map((item, index) => (
        <p className="today-assistant-limitation" key={`${index}-${item}`}>
          {item}
        </p>
      ))}
    </section>
  );
}
