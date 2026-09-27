import { useEffect, useRef } from "react";
import "./ai-sensitive-consent.css";

interface AiSensitiveConsentProps {
  readonly open: boolean;
  readonly title: string;
  readonly selectedDate: string;
  readonly contentType: "日记正文" | "收件箱原文";
  readonly onDismiss: () => void;
  readonly onAllowOnce: () => void;
}

export function AiSensitiveConsent({
  open,
  title,
  selectedDate,
  contentType,
  onDismiss,
  onAllowOnce,
}: AiSensitiveConsentProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const allowLock = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      allowLock.current = false;
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("[data-initial-focus]")?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function allowOnce() {
    if (allowLock.current) return;
    allowLock.current = true;
    onAllowOnce();
  }

  function dismiss() {
    if (allowLock.current) return;
    onDismiss();
  }

  return (
    <dialog
      ref={dialogRef}
      className="ai-sensitive-consent"
      aria-labelledby="ai-sensitive-consent-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <header>
        <p className="ai-sensitive-consent-eyebrow">敏感内容单次授权</p>
        <h2 id="ai-sensitive-consent-title">{title}</h2>
      </header>
      <div className="ai-sensitive-consent-content">
        <p>
          本次操作会将当前选中的{contentType}发送至 DeepSeek 处理。仅本次有效，不会自动读取其他
          {contentType === "日记正文" ? "日记" : "收件箱内容"}。
        </p>
        <dl>
          <div>
            <dt>日期 / 记录时间</dt>
            <dd>{selectedDate}</dd>
          </div>
          <div>
            <dt>内容类型</dt>
            <dd>{contentType}</dd>
          </div>
          <div>
            <dt>范围</dt>
            <dd>仅当前这一篇 / 条</dd>
          </div>
        </dl>
        <p className="ai-sensitive-consent-note">取消、按 Esc 或点击背景都不会发送请求。</p>
      </div>
      <footer>
        <button type="button" className="secondary-button" onClick={dismiss} data-initial-focus>
          取消
        </button>
        <button type="button" className="primary-button" onClick={allowOnce}>
          仅本次允许
        </button>
      </footer>
    </dialog>
  );
}
