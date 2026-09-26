import { useRef, useState } from "react";
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
import { plainAssistantText, resolveTodayAssistantWorkflow } from "./today-assistant-routing.ts";
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
  const runningRef = useRef(false);
  const busy = state.kind === "loading";

  async function run(workflowId: AiWorkflowId, text = instruction) {
    if (runningRef.current) return;
    runningRef.current = true;
    const safeInstruction = text.trim().slice(0, 500);
    setProposalCancelled(false);
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

  function send() {
    if (busy || !instruction.trim()) return;
    void run(resolveTodayAssistantWorkflow(instruction));
  }

  async function confirmProposal(proposal: AiPlannerProposal): Promise<AiProposalApplyResult> {
    const result = await onConfirmProposal(proposal);
    if (result.status === "applied") onApplied();
    return result;
  }

  function cancelProposal(proposal: AiPlannerProposal) {
    onCancelProposal(proposal);
    setProposalCancelled(true);
  }

  return (
    <section
      className="today-assistant"
      role="region"
      aria-labelledby="today-assistant-title"
      data-testid="today-assistant-panel"
    >
      <header className="today-assistant-header">
        <h2 id="today-assistant-title">AI 助手 ✨</h2>
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
        >
          分析今天
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={busy}
          onClick={() => void run("today.plan", "请帮我安排今天的时间。")}
        >
          安排今天
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void run("today.analyze", "重点看看今天安排中需要留意的风险。")}
        >
          看看风险
        </button>
      </div>
      <p className="today-assistant-privacy" id="today-assistant-privacy">
        仅使用你在 AI 设置中允许的数据，并发送至 DeepSeek 处理。
      </p>
      <div className="today-assistant-result" aria-live="polite">
        {state.kind === "idle" && <p>有需要时再问我；不会保存对话记录。</p>}
        {state.kind === "loading" && (
          <p role="status" data-testid="today-assistant-loading">
            {state.workflowId === "today.plan" ? "正在看看合适的安排…" : "正在整理今天的重点…"}
          </p>
        )}
        {state.kind === "message" && state.status === "noPermissions" && (
          <div role="status">
            <p>还没有允许 AI 使用的工作台数据。</p>
            <button type="button" className="workspace-card-link" onClick={onOpenSettings}>
              打开 AI 数据访问设置
            </button>
          </div>
        )}
        {state.kind === "message" && state.status === "notConfigured" && (
          <div role="status">
            <p>请先在设置中配置 DeepSeek。</p>
            <button type="button" className="workspace-card-link" onClick={onOpenSettings}>
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
              <button type="button" className="workspace-card-link" onClick={onOpenSettings}>
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
    </section>
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
        <h3>{analysis ? "🌙 今日概览" : "✨ 今日建议"}</h3>
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
