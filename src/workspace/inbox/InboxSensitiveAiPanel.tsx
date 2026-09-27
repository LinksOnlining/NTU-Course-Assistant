import { useEffect, useRef, useState } from "react";
import type { AiPlannerProposal } from "../../application/ai/proposal.ts";
import type { InboxInterpretationResult } from "../../application/ai/sensitive-workflows.ts";
import type { AiProposalApplyResult } from "../../application/ai/proposal-runtime.ts";
import type { InboxItem } from "../../types/inbox.ts";
import { AiProposalReview } from "../ai/AiProposalReview.tsx";
import { AiSensitiveConsent } from "../ai/AiSensitiveConsent.tsx";
import { sensitiveAiService } from "../ai/sensitive-ai-service.ts";
import "./inbox-sensitive-ai.css";

interface InboxSensitiveAiPanelProps {
  readonly item: InboxItem;
  readonly onOpenSettings: () => void;
  readonly onApplied: () => void;
}

export function InboxSensitiveAiPanel({
  item,
  onOpenSettings,
  onApplied,
}: InboxSensitiveAiPanelProps) {
  const [consentOpen, setConsentOpen] = useState(false);
  const [busy, setBusy] = useState<"check" | "interpret" | "proposal" | null>(null);
  const [error, setError] = useState("");
  const [interpretation, setInterpretation] = useState<InboxInterpretationResult | null>(null);
  const [truncatedBytes, setInterpretationTruncated] = useState<number | null>(null);
  const [proposal, setProposal] = useState<AiPlannerProposal | null>(null);
  const operationLock = useRef(false);
  const operationEpoch = useRef(0);
  const currentItem = useRef(item);
  const interpretationRef = useRef<InboxInterpretationResult | null>(null);
  const proposalRef = useRef<AiPlannerProposal | null>(null);

  useEffect(() => {
    if (currentItem.current === item) return;
    currentItem.current = item;
    operationEpoch.current += 1;
    operationLock.current = false;
    if (proposalRef.current) sensitiveAiService.cancelProposal(proposalRef.current);
    proposalRef.current = null;
    interpretationRef.current = null;
    setConsentOpen(false);
    setBusy(null);
    setError("");
    setInterpretation(null);
    setInterpretationTruncated(null);
    setProposal(null);
  }, [item]);

  useEffect(
    () => () => {
      operationEpoch.current += 1;
      if (proposalRef.current) sensitiveAiService.cancelProposal(proposalRef.current);
    },
    [],
  );

  async function requestInterpretation() {
    if (operationLock.current || busy) return;
    operationLock.current = true;
    const epoch = operationEpoch.current;
    setBusy("check");
    setError("");
    try {
      if (!(await sensitiveAiService.isConfigured())) {
        if (epoch === operationEpoch.current)
          setError("请先在设置中配置 DeepSeek，之后再发起本次识别。");
        return;
      }
      if (epoch === operationEpoch.current) setConsentOpen(true);
    } finally {
      if (epoch === operationEpoch.current) {
        setBusy(null);
        operationLock.current = false;
      }
    }
  }

  async function allowOnce() {
    if (operationLock.current || busy) return;
    operationLock.current = true;
    const epoch = operationEpoch.current;
    setConsentOpen(false);
    setBusy("interpret");
    setError("");
    if (proposalRef.current) sensitiveAiService.cancelProposal(proposalRef.current);
    proposalRef.current = null;
    interpretationRef.current = null;
    setInterpretation(null);
    setInterpretationTruncated(null);
    setProposal(null);
    try {
      const outcome = await sensitiveAiService.interpretSelectedInbox(item);
      if (epoch !== operationEpoch.current) return;
      if (outcome.status === "ready") {
        interpretationRef.current = outcome.result;
        setInterpretation(outcome.result);
        setInterpretationTruncated(outcome.truncated ? outcome.omittedBytes : null);
      } else if (outcome.status === "notConfigured") {
        setError("DeepSeek 当前未配置，请前往设置配置后重新发起；上一次授权不会保留。");
      } else if (outcome.status === "busy") {
        setError("当前识别仍在处理中。重新发起时会再次询问授权。");
      } else {
        setError(outcome.message);
      }
    } catch {
      setError("本次识别失败；如需重试，请重新发起并再次确认授权。");
    } finally {
      if (epoch === operationEpoch.current) {
        operationLock.current = false;
        setBusy(null);
      }
    }
  }

  async function requestProposal(kind: "task" | "event") {
    const validatedInterpretation = interpretationRef.current;
    if (!validatedInterpretation || operationLock.current || busy) return;
    operationLock.current = true;
    const epoch = operationEpoch.current;
    setBusy("proposal");
    setError("");
    try {
      const outcome =
        kind === "task"
          ? await sensitiveAiService.proposeInboxTask({ id: item.id }, validatedInterpretation)
          : await sensitiveAiService.proposeInboxEvent({ id: item.id }, validatedInterpretation);
      if (epoch !== operationEpoch.current) return;
      if (outcome.status === "ready") {
        proposalRef.current = outcome.proposal;
        setProposal(outcome.proposal);
      } else if (outcome.status === "unavailable")
        setError("DeepSeek 当前不可用；收件箱内容未更改。");
      else if (outcome.status === "busy") setError("提案请求仍在处理中，请稍后重试。");
      else setError(outcome.message);
    } catch {
      if (epoch === operationEpoch.current)
        setError("提案请求失败；收件箱内容未更改，请重新操作。");
    } finally {
      if (epoch === operationEpoch.current) {
        operationLock.current = false;
        setBusy(null);
      }
    }
  }

  async function confirmProposal(current: AiPlannerProposal): Promise<AiProposalApplyResult> {
    const result = await sensitiveAiService.confirmInboxProposal(item.id, current);
    if (result.status === "applied") onApplied();
    return result;
  }

  function cancelProposal(current: AiPlannerProposal) {
    sensitiveAiService.cancelProposal(current);
    proposalRef.current = null;
    setProposal(null);
  }

  const interpretationLimitations = interpretation
    ? [
        ...(truncatedBytes !== null
          ? [`原文超过本次处理上限，仅处理前 8 KiB，另省略 ${truncatedBytes} 字节。`]
          : []),
        ...interpretation.limitations,
      ].slice(0, 6)
    : [];

  const canCreateEvent = Boolean(
    interpretation?.title &&
    interpretation.date &&
    interpretation.startTime &&
    interpretation.endTime,
  );

  return (
    <section className="inbox-sensitive-ai" aria-label="单条收件箱 AI 识别">
      <div className="inbox-sensitive-ai-actions">
        <button type="button" onClick={() => void requestInterpretation()} disabled={busy !== null}>
          {busy === "check" ? "检查配置…" : busy === "interpret" ? "正在识别…" : "AI 帮我识别"}
        </button>
        {error.includes("设置中配置 DeepSeek") && (
          <button type="button" className="secondary-button" onClick={onOpenSettings}>
            打开设置
          </button>
        )}
      </div>
      {error && (
        <p className="inbox-sensitive-ai-error" role="alert">
          {error}
        </p>
      )}
      {interpretation && (
        <div className="inbox-sensitive-ai-result" data-testid="inbox-ai-result">
          <h4>识别结果</h4>
          <p>{interpretation.summary}</p>
          <dl>
            <div>
              <dt>可能类型</dt>
              <dd>{typeLabel(interpretation.detectedType)}</dd>
            </div>
            <div>
              <dt>标题</dt>
              <dd>{interpretation.title ?? "未识别"}</dd>
            </div>
            <div>
              <dt>日期 / 时间</dt>
              <dd>{formatDateTime(interpretation)}</dd>
            </div>
            <div>
              <dt>截止</dt>
              <dd>{formatDeadline(interpretation)}</dd>
            </div>
          </dl>
          {interpretation.uncertainties.length > 0 && (
            <ResultList title="不确定项" items={interpretation.uncertainties} />
          )}
          {interpretation.missingFields.length > 0 && (
            <ResultList title="还缺少" items={interpretation.missingFields} />
          )}
          {interpretationLimitations.length > 0 && (
            <ResultList title="限制" items={interpretationLimitations} />
          )}
          <div className="inbox-sensitive-ai-actions">
            {interpretation.title && (
              <button
                type="button"
                onClick={() => void requestProposal("task")}
                disabled={busy !== null}
              >
                {busy === "proposal" ? "正在生成建议…" : "生成任务建议"}
              </button>
            )}
            {canCreateEvent && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void requestProposal("event")}
                disabled={busy !== null}
              >
                {busy === "proposal" ? "正在生成建议…" : "生成活动建议"}
              </button>
            )}
          </div>
          <p className="inbox-sensitive-ai-privacy">
            仅展示本次识别；不会自动创建或修改任务、日程或收件箱。
          </p>
        </div>
      )}
      {proposal && (
        <AiProposalReview
          inline
          proposal={proposal}
          onConfirm={confirmProposal}
          onCancel={cancelProposal}
        />
      )}
      <AiSensitiveConsent
        open={consentOpen}
        title="允许 AI 识别这条收件箱内容？"
        selectedDate={new Date(item.createdAt).toLocaleString("zh-CN")}
        contentType="收件箱原文"
        onDismiss={() => setConsentOpen(false)}
        onAllowOnce={() => void allowOnce()}
      />
    </section>
  );
}

function typeLabel(value: InboxInterpretationResult["detectedType"]): string {
  return value === "task" ? "任务" : value === "event" ? "活动 / 日程" : "暂不能确定";
}

function formatDateTime(value: InboxInterpretationResult): string {
  if (!value.date && !value.startTime && !value.endTime) return "未明确识别";
  return [
    value.date,
    value.startTime && value.endTime ? `${value.startTime}–${value.endTime}` : value.startTime,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatDeadline(value: InboxInterpretationResult): string {
  return [value.deadlineDate, value.deadlineTime].filter(Boolean).join(" ") || "未识别";
}

function ResultList({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly string[];
}) {
  return (
    <div className="inbox-sensitive-ai-list">
      <h5>{title}</h5>
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
