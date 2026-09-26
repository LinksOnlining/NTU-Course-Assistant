import { useEffect, useRef, useState } from "react";
import type { AiPlannerProposal } from "../../application/ai/proposal.ts";
import type { AiProposalApplyResult } from "../../application/ai/proposal-runtime.ts";
import "./ai-proposal-review.css";

interface AiProposalReviewProps {
  readonly proposal: AiPlannerProposal;
  readonly onConfirm: (proposal: AiPlannerProposal) => Promise<AiProposalApplyResult>;
  readonly onCancel: (proposal: AiPlannerProposal) => void;
}

export function AiProposalReview({ proposal, onConfirm, onCancel }: AiProposalReviewProps) {
  const [current, setCurrent] = useState(proposal);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiProposalApplyResult | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef(onCancel);
  const currentRef = useRef(current);
  const closeAllowedRef = useRef(true);
  cancelRef.current = onCancel;
  currentRef.current = current;
  const closeAllowed = !busy && result?.status !== "applied";
  closeAllowedRef.current = closeAllowed;

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (closeAllowedRef.current) cancelRef.current(currentRef.current);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

  async function confirm() {
    if (busy || result?.status === "applied") return;
    setBusy(true);
    setResult(null);
    try {
      const next = await onConfirm(current);
      setResult(next);
      if ("proposal" in next) setCurrent(next.proposal);
    } catch {
      setResult({ status: "failed", proposal: current, message: "确认失败，请检查数据后重试。" });
    } finally {
      setBusy(false);
    }
  }

  const success = result?.status === "applied";
  const errorText =
    result && result.status !== "applied" && result.status !== "needsReconfirmation"
      ? result.status === "failed"
        ? result.message
        : result.status === "expired"
          ? "此提案已过期，请重新生成。"
          : result.status === "stale"
            ? "提案关联的数据已变化，请重新生成提案。"
            : "提案已不可用，请关闭后重试。"
      : "";

  return (
    <div
      className="ai-proposal-backdrop"
      data-testid="ai-proposal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && closeAllowed) onCancel(current);
      }}
    >
      <section
        ref={dialogRef}
        className="ai-proposal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-proposal-title"
        tabIndex={-1}
        data-testid="ai-proposal-review"
      >
        <header>
          <div>
            <p className="ai-proposal-eyebrow">AI 规划提案 · 待确认</p>
            <h2 id="ai-proposal-title">{current.title}</h2>
          </div>
          <button
            type="button"
            className="ai-proposal-close"
            aria-label="关闭提案预览"
            onClick={() => closeAllowed && onCancel(current)}
            disabled={!closeAllowed}
          >
            ×
          </button>
        </header>

        <div className="ai-proposal-content">
          <p className="ai-proposal-disclosure">{current.description}</p>
          <dl className="ai-proposal-fields">
            {current.preview.fields.map((field, index) => (
              <div key={`${field.label}-${index}`}>
                <dt>{field.label}</dt>
                <dd>
                  {field.previousValue && (
                    <span className="ai-proposal-previous">{field.previousValue} → </span>
                  )}
                  {field.value}
                </dd>
              </div>
            ))}
          </dl>
          {current.preview.warnings.length > 0 && (
            <aside className="ai-proposal-warnings" role="status" aria-label="安排冲突提示">
              <strong>需要留意</strong>
              {current.preview.warnings.map((warning, index) => (
                <div key={`${warning.code}-${index}`}>
                  <p>{warning.message}</p>
                  <ul>
                    {warning.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </aside>
          )}
          {result?.status === "needsReconfirmation" && (
            <p className="ai-proposal-refresh" role="status" aria-live="polite">
              相关安排已变化，请检查更新后的预览，再次确认。
            </p>
          )}
          {errorText && (
            <p className="ai-proposal-error" role="alert">
              {errorText}
            </p>
          )}
          {success && (
            <p className="ai-proposal-success" role="status">
              已添加到规划。
            </p>
          )}
        </div>

        <footer>
          {success ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => onCancel(current)}
              data-initial-focus
            >
              完成
            </button>
          ) : (
            <>
              <button
                type="button"
                className="secondary-button"
                onClick={() => onCancel(current)}
                disabled={!closeAllowed}
                data-initial-focus
              >
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void confirm()}
                disabled={busy || Boolean(errorText)}
              >
                {busy ? "正在验证并保存…" : confirmLabel(current)}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}

function confirmLabel(proposal: AiPlannerProposal): string {
  if (proposal.type === "task") return "确认创建任务";
  if (proposal.type === "event") return "确认创建日程";
  return "确认安排时间块";
}
