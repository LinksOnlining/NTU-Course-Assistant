import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AiPlannerProposal } from "../../application/ai/proposal.ts";
import type { AiProposalApplyResult } from "../../application/ai/proposal-runtime.ts";
import type {
  AiWorkflowOrchestrator,
  AiWorkflowErrorCategory,
  AiWorkflowResult,
  AiWorkflowRunResult,
} from "../../application/ai/workflow-orchestrator.ts";
import type { AiWorkflowRequestId } from "../../application/ai/today-workflows.ts";
import { AiProposalReview } from "./AiProposalReview.tsx";
import { plainAssistantText } from "./today-assistant-routing.ts";
import "./today-assistant.css";

interface TodayAssistantPanelProps {
  readonly service: AiWorkflowOrchestrator;
  readonly onOpenSettings: () => void;
  readonly onConfirmProposal: (proposal: AiPlannerProposal) => Promise<AiProposalApplyResult>;
  readonly onCancelProposal: (proposal: AiPlannerProposal) => void;
  readonly onApplied: () => void;
}

type PanelState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "loading";
      readonly workflowId: AiWorkflowRequestId;
      readonly instruction: string;
    }
  | { readonly kind: "ready"; readonly result: AiWorkflowResult }
  | { readonly kind: "message"; readonly status: "noPermissions" | "notConfigured" | "noContext" }
  | { readonly kind: "clarification"; readonly message: string }
  | {
      readonly kind: "failed";
      readonly workflowId: AiWorkflowRequestId;
      readonly instruction: string;
      readonly message: string;
      readonly category: AiWorkflowErrorCategory;
    };

function resultState(
  result: AiWorkflowRunResult,
  workflowId: AiWorkflowRequestId,
  instruction: string,
): PanelState {
  if (result.status === "ready") return { kind: "ready", result: result.result };
  if (result.status === "clarification") return { kind: "clarification", message: result.message };
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
      message: "我正在处理上一条请求，请稍等片刻。",
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
}: TodayAssistantPanelProps) {
  const [instruction, setInstruction] = useState("");
  const [state, setState] = useState<PanelState>({ kind: "idle" });
  const [proposalCancelled, setProposalCancelled] = useState(false);
  const [proposalApplying, setProposalApplying] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [modalTitle, setModalTitle] = useState("AI 助手回复");
  const runningRef = useRef(false);
  const requestGeneration = useRef(0);
  const proposalAppliedRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const busy = isRunning;
  const modalOpen = state.kind !== "idle";

  function dismissModal() {
    if (proposalApplying) return;
    // Closing a pending request hides its eventual response without triggering a new request.
    requestGeneration.current += 1;
    if (
      state.kind === "ready" &&
      state.result.proposal &&
      !proposalCancelled &&
      !proposalAppliedRef.current
    ) {
      onCancelProposal(state.result.proposal);
    }
    setState({ kind: "idle" });
    setProposalCancelled(false);
  }

  useEffect(() => {
    if (!modalOpen) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    restoreFocusRef.current = previousFocus;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      // A request may still be running, leaving its trigger disabled.
      // Restore focus as soon as it becomes enabled again.
      if (previousFocus && !previousFocus.matches(":disabled")) {
        previousFocus.focus();
        restoreFocusRef.current = null;
      }
    };
  }, [modalOpen]);

  useEffect(() => {
    if (modalOpen || isRunning || !restoreFocusRef.current) return;
    restoreFocusRef.current.focus();
    restoreFocusRef.current = null;
  }, [modalOpen, isRunning]);

  useEffect(() => {
    if (!modalOpen) return;
    function onDialogKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismissModal();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (!focusable.length) {
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
    document.addEventListener("keydown", onDialogKeyDown, true);
    return () => document.removeEventListener("keydown", onDialogKeyDown, true);
  }, [modalOpen, state, proposalCancelled, proposalApplying]);

  async function run(workflowId: AiWorkflowRequestId, text = instruction) {
    if (runningRef.current) return;
    runningRef.current = true;
    const generation = ++requestGeneration.current;
    const safeInstruction = text.trim().slice(0, 500);
    setModalTitle(
      workflowId === "today.analyze"
        ? "分析今天"
        : safeInstruction === "请帮我安排今天的时间。"
          ? "安排今天"
          : "AI 助手回复",
    );
    setProposalCancelled(false);
    proposalAppliedRef.current = false;
    setIsRunning(true);
    setState({ kind: "loading", workflowId, instruction: safeInstruction });
    try {
      const result = await service.run({ workflowId, instruction: safeInstruction });
      if (requestGeneration.current === generation) {
        setState(resultState(result, workflowId, safeInstruction));
      }
    } catch {
      if (requestGeneration.current === generation)
        setState({
          kind: "failed",
          workflowId,
          instruction: safeInstruction,
          message: "AI 服务暂不可用，请稍后重试。",
          category: "provider",
        });
    } finally {
      runningRef.current = false;
      setIsRunning(false);
    }
  }

  function send() {
    if (busy || !instruction.trim()) return;
    void run("planner.route");
  }

  function openSettingsFromDialog() {
    dismissModal();
    onOpenSettings();
  }

  async function confirmProposal(proposal: AiPlannerProposal): Promise<AiProposalApplyResult> {
    setProposalApplying(true);
    try {
      const result = await onConfirmProposal(proposal);
      if (result.status === "applied") {
        proposalAppliedRef.current = true;
        onApplied();
      }
      return result;
    } finally {
      setProposalApplying(false);
    }
  }

  function cancelProposal(proposal: AiPlannerProposal) {
    if (proposalAppliedRef.current) {
      dismissModal();
      return;
    }
    onCancelProposal(proposal);
    setProposalCancelled(true);
  }

  return (
    <>
      <section
        className="today-assistant"
        role="region"
        aria-labelledby="today-assistant-title"
        data-testid="today-assistant-panel"
      >
        <header className="today-assistant-header">
          <h2 id="today-assistant-title">AI 助手</h2>
          <button
            type="button"
            className="today-assistant-settings"
            aria-label="打开 AI 配置"
            onClick={onOpenSettings}
          >
            AI 设置
          </button>
        </header>
        <label className="today-assistant-input-label" htmlFor="today-assistant-instruction">
          想让我帮你看看什么？
        </label>
        <div className="today-assistant-composer">
          <textarea
            id="today-assistant-instruction"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value.slice(0, 500))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                send();
              }
            }}
            maxLength={500}
            rows={2}
            placeholder="例如：看看今天是否排得太满"
            disabled={busy}
            data-testid="today-assistant-instruction"
            aria-describedby="today-assistant-privacy"
          />
          <button
            type="button"
            className="primary-button today-assistant-send"
            onClick={send}
            disabled={busy || !instruction.trim()}
            data-testid="today-assistant-send"
            aria-haspopup="dialog"
          >
            {busy ? "处理中…" : "发送"}
          </button>
        </div>
        <div className="today-assistant-actions" aria-label="快捷操作">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void run("today.analyze", "")}
            aria-haspopup="dialog"
          >
            分析今天
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => void run("planner.route", "请帮我安排今天的时间。")}
            aria-haspopup="dialog"
          >
            安排今天
          </button>
        </div>
        <p className="today-assistant-privacy" id="today-assistant-privacy">
          其他 AI 请求由你主动发起；每日 AI
          简报仅在设置开启后于每天首次启动时异步生成。每次只使用当前请求所需且已授权的数据，日记正文与
          Inbox 原文不会自动读取。
        </p>
      </section>
      {modalOpen &&
        createPortal(
          <div
            className="today-assistant-backdrop"
            data-testid="today-assistant-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) dismissModal();
            }}
          >
            <section
              ref={dialogRef}
              className="today-assistant-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="today-assistant-dialog-heading"
              tabIndex={-1}
              data-testid="today-assistant-dialog"
            >
              <header className="today-assistant-dialog-header">
                <div>
                  <p className="today-assistant-dialog-eyebrow">AI 助手 · 仅按授权使用数据</p>
                  <h2 id="today-assistant-dialog-heading">{modalTitle}</h2>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  className="today-assistant-dialog-close"
                  aria-label="关闭 AI 结果"
                  onClick={dismissModal}
                  disabled={proposalApplying}
                >
                  ×
                </button>
              </header>
              <div className="today-assistant-dialog-body">
                <div className="today-assistant-result" aria-live="polite">
                  {state.kind === "loading" && (
                    <p role="status" data-testid="today-assistant-loading">
                      {state.workflowId === "planner.route"
                        ? "正在理解日期和安排…"
                        : state.workflowId === "today.plan"
                          ? "正在看看合适的安排…"
                          : "正在整理今天的重点…"}
                    </p>
                  )}
                  {state.kind === "clarification" && <p role="status">{state.message}</p>}
                  {state.kind === "message" && state.status === "noPermissions" && (
                    <div role="status">
                      <p>还没有允许 AI 使用的工作台数据。</p>
                      <button
                        type="button"
                        className="workspace-card-link"
                        onClick={openSettingsFromDialog}
                      >
                        打开 AI 数据访问设置
                      </button>
                    </div>
                  )}
                  {state.kind === "message" && state.status === "notConfigured" && (
                    <div role="status">
                      <p>请先在设置中配置 DeepSeek。</p>
                      <button
                        type="button"
                        className="workspace-card-link"
                        onClick={openSettingsFromDialog}
                      >
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
                        <button
                          type="button"
                          className="workspace-card-link"
                          onClick={openSettingsFromDialog}
                        >
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
                        <AiProposalReview
                          inline
                          proposal={state.result.proposal}
                          onConfirm={confirmProposal}
                          onCancel={cancelProposal}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}

function ResultCard({
  result,
  proposalCancelled,
}: {
  readonly result: AiWorkflowResult;
  readonly proposalCancelled: boolean;
}) {
  const analysis = result.analysis;
  const limitations = [...new Set([...(analysis?.limitations ?? []), ...result.limitations])];
  return (
    <section className="today-assistant-result-card" data-testid="today-assistant-result">
      <div className="today-assistant-result-section">
        <h3>{analysis ? `🌙 ${result.analysisTitle ?? "今日概览"}` : "✨ 规划建议"}</h3>
        <p className="today-assistant-answer">
          {plainAssistantText(analysis?.summary ?? result.answer)}
        </p>
      </div>
      {analysis?.risks.length ? (
        <div className="today-assistant-result-section">
          <h4>⏰ 需要注意</h4>
          <ul>
            {analysis.risks.map((item, index) => (
              <li key={`${index}-${item}`}>{plainAssistantText(item)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {analysis?.suggestions.length ? (
        <div className="today-assistant-result-section">
          <h4>✨ 建议安排</h4>
          <ul>
            {analysis.suggestions.map((item, index) => (
              <li key={`${index}-${item}`}>{plainAssistantText(item)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {limitations.length ? (
        <div className="today-assistant-result-section">
          <h4>信息限制</h4>
          <ul>
            {limitations.map((item, index) => (
              <li key={`${index}-${item}`}>{plainAssistantText(item)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.proposal && (
        <p className="today-assistant-proposal-note">提案尚未写入数据，请在下方检查后决定。</p>
      )}
      {result.workflowId === "today.plan" && !result.proposal && (
        <p className="today-assistant-proposal-note">这是一条文字建议，尚未修改任何应用数据。</p>
      )}
      {proposalCancelled && (
        <p className="today-assistant-proposal-note">本次提案已取消，应用数据未修改。</p>
      )}
      {result.usedModules.length > 0 && (
        <p className="today-assistant-sources">参考：{result.usedModules.join("、")}</p>
      )}
    </section>
  );
}
