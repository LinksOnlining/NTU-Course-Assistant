import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  createDailySummaryDraft,
  getDailySummaryByDate,
  saveDailySummary,
  validateDailySummaryDraft,
} from "../../application/workspace/daily-summary.ts";
import type {
  WorkspaceDashboardSources,
  WorkspaceDashboardViewModel,
} from "../../application/workspace/index.ts";
import type { AiWorkflowOrchestrator } from "../../application/ai/workflow-orchestrator.ts";
import type { DailySummary } from "../../types/daily-summary.ts";
import "./daily-summary.css";

type SummaryText = Pick<DailySummary, "overview" | "highlights" | "unfinished" | "tomorrowNotes">;
type SummaryEditorText = {
  overview: string;
  highlights: string;
  unfinished: string;
  tomorrowNotes: string;
};
type SummaryOrigin = "saved" | "ai" | "local";
type SummaryStatus =
  | { readonly kind: "idle" | "reading" | "generating" | "ai-draft" | "saved" | "saving" }
  | { readonly kind: "edited"; readonly source: SummaryOrigin }
  | { readonly kind: "save-failed" | "validation-error"; readonly message: string }
  | {
      readonly kind: "local-fallback";
      readonly reason:
        | "not-configured"
        | "no-permissions"
        | "no-context"
        | "busy"
        | "clarification"
        | "ai-failed"
        | "invalid-result"
        | "read-failed"
        | "request-failed";
      readonly detail?: string;
    };

function localFallbackStatus(
  result: Awaited<ReturnType<AiWorkflowOrchestrator["run"]>>,
): SummaryStatus {
  switch (result.status) {
    case "notConfigured":
      return { kind: "local-fallback", reason: "not-configured" };
    case "noPermissions":
      return { kind: "local-fallback", reason: "no-permissions" };
    case "noContext":
      return { kind: "local-fallback", reason: "no-context" };
    case "busy":
      return { kind: "local-fallback", reason: "busy" };
    case "clarification":
      return { kind: "local-fallback", reason: "clarification", detail: result.message };
    case "failed":
      return { kind: "local-fallback", reason: "ai-failed", detail: result.message };
    case "ready":
      return { kind: "local-fallback", reason: "invalid-result" };
  }
}

function summaryStatusText(status: SummaryStatus): string {
  switch (status.kind) {
    case "idle":
      return "尚未保存。";
    case "reading":
      return "正在读取今天的总结……";
    case "generating":
      return "正在整理今天……";
    case "ai-draft":
      return "AI 已生成今日总结，尚未保存。";
    case "saved":
      return "今天的总结已保存。";
    case "saving":
      return "正在保存今日总结……";
    case "edited":
      return status.source === "ai"
        ? "AI 总结已修改，尚未保存。"
        : status.source === "local"
          ? "本地草稿已修改，尚未保存。"
          : "已保存的总结已修改，尚未保存。";
    case "save-failed":
    case "validation-error":
      return status.message;
    case "local-fallback":
      switch (status.reason) {
        case "not-configured":
          return "尚未配置 DeepSeek，已使用本地基础总结。尚未保存。";
        case "no-permissions":
          return "未授予生成总结所需的数据权限，已使用本地基础总结。尚未保存。";
        case "no-context":
          return "当前没有可供 AI 使用的授权数据，已使用本地基础总结。尚未保存。";
        case "busy":
          return "AI 正在处理其他请求，已使用本地基础总结。尚未保存。";
        case "clarification":
          return status.detail
            ? `AI 需要补充信息：${status.detail.replace(/[。！？；]+$/u, "")}。已使用本地基础总结。尚未保存。`
            : "AI 需要补充信息，已使用本地基础总结。尚未保存。";
        case "ai-failed":
          return status.detail
            ? `AI 生成失败：${status.detail.replace(/[。！？；]+$/u, "")}。已使用本地基础总结。尚未保存。`
            : "AI 生成失败，已使用本地基础总结。尚未保存。";
        case "invalid-result":
          return "AI 返回内容不完整，已使用本地基础总结。尚未保存。";
        case "read-failed":
          return "无法读取已保存总结，已使用本地基础总结。尚未保存。";
        case "request-failed":
          return "AI 请求未能完成，已使用本地基础总结。尚未保存。";
      }
  }
}

function editorText(summary: SummaryText): SummaryEditorText {
  return {
    overview: summary.overview,
    highlights: summary.highlights.join("\n"),
    unfinished: summary.unfinished.join("\n"),
    tomorrowNotes: summary.tomorrowNotes.join("\n"),
  };
}

function listFromEditor(value: string): readonly string[] {
  return value
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function summaryFromEditor(value: SummaryEditorText): SummaryText {
  return {
    overview: value.overview,
    highlights: listFromEditor(value.highlights),
    unfinished: listFromEditor(value.unfinished),
    tomorrowNotes: listFromEditor(value.tomorrowNotes),
  };
}

export function DailySummaryPanel({
  model,
  sources,
  service,
  onOpenSettings,
}: {
  readonly model: WorkspaceDashboardViewModel;
  readonly sources: WorkspaceDashboardSources;
  readonly service: AiWorkflowOrchestrator;
  readonly onOpenSettings: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const generationRef = useRef(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<DailySummary | null>(null);
  const [editor, setEditor] = useState<SummaryEditorText | null>(null);
  const [origin, setOrigin] = useState<SummaryOrigin | null>(null);
  const [saved, setSaved] = useState(false);
  const [edited, setEdited] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<SummaryStatus>({ kind: "idle" });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialogOpen && dialog && !dialog.open) dialog.showModal();
  }, [dialogOpen]);

  function buildLocalDraft(): DailySummary {
    return createDailySummaryDraft({
      date: model.date,
      arrangements: model.todayArrangements,
      timelineItems: sources.futureItems ?? sources.timelineItems,
      personalTasks: sources.personalTasks ?? [],
      academicTasks: sources.tasks,
      routines: sources.routines ?? [],
    });
  }

  function localDraftWithIdentity(current: DailySummary | null): DailySummary {
    const local = buildLocalDraft();
    return current
      ? {
          ...local,
          id: current.id,
          createdAt: current.createdAt,
          revision: current.revision,
        }
      : local;
  }

  async function generateDraft(base: DailySummary, requestId: number) {
    if (generating || saving) return;
    setGenerating(true);
    setStatus({ kind: "generating" });
    try {
      const result = await service.run({ workflowId: "dailySummary.generate" });
      if (generationRef.current !== requestId) return;
      if (
        result.status === "ready" &&
        result.result.workflowId === "dailySummary.generate" &&
        result.result.dailySummary
      ) {
        const generated = { ...base, ...result.result.dailySummary };
        const validation = validateDailySummaryDraft(generated);
        if (validation) {
          setDraft(base);
          setOrigin("local");
          setSaved(false);
          setEditor(null);
          setEdited(false);
          setEditing(false);
          setStatus({ kind: "local-fallback", reason: "invalid-result" });
          return;
        }
        setDraft(generated);
        setOrigin("ai");
        setSaved(false);
        setEditor(null);
        setEdited(false);
        setEditing(false);
        setStatus({ kind: "ai-draft" });
      } else {
        setDraft(base);
        setOrigin("local");
        setSaved(false);
        setEditor(null);
        setEdited(false);
        setEditing(false);
        setStatus(localFallbackStatus(result));
      }
    } catch {
      if (generationRef.current !== requestId) return;
      setDraft(base);
      setOrigin("local");
      setSaved(false);
      setEditor(null);
      setEdited(false);
      setEditing(false);
      setStatus({ kind: "local-fallback", reason: "request-failed" });
    } finally {
      if (generationRef.current === requestId) setGenerating(false);
    }
  }

  async function openSummary() {
    if (dialogOpen || dialogRef.current?.open || loading || saving) return;
    const requestId = ++generationRef.current;
    setDialogOpen(true);
    setDraft(null);
    setEditor(null);
    setOrigin(null);
    setSaved(false);
    setEdited(false);
    setEditing(false);
    setLoading(true);
    setStatus({ kind: "reading" });
    try {
      const existing = await getDailySummaryByDate(model.date);
      if (generationRef.current !== requestId) return;
      if (existing) {
        setDraft(existing);
        setOrigin("saved");
        setSaved(true);
        setStatus({ kind: "saved" });
        return;
      }
      const local = buildLocalDraft();
      setDraft(local);
      setOrigin("local");
      setLoading(false);
      await generateDraft(local, requestId);
    } catch {
      if (generationRef.current !== requestId) return;
      const local = buildLocalDraft();
      setDraft(local);
      setOrigin("local");
      setSaved(false);
      setStatus({ kind: "local-fallback", reason: "read-failed" });
    } finally {
      if (generationRef.current === requestId) setLoading(false);
    }
  }

  async function regenerate() {
    if (!draft || generating || saving) return;
    if (edited && !window.confirm("重新整理将放弃当前未保存的编辑，继续吗？")) return;
    const requestId = ++generationRef.current;
    const local = localDraftWithIdentity(draft);
    setDraft(local);
    setEditor(null);
    setEdited(false);
    setEditing(false);
    setSaved(false);
    setOrigin("local");
    await generateDraft(local, requestId);
  }

  function closeSummary() {
    if (saving) return;
    if (edited && !window.confirm("有尚未保存的编辑，确定放弃吗？")) return;
    generationRef.current += 1;
    setDialogOpen(false);
    setDraft(null);
    setEditor(null);
    setOrigin(null);
    setSaved(false);
    setEdited(false);
    setEditing(false);
    setLoading(false);
    setGenerating(false);
    setStatus({ kind: "idle" });
    dialogRef.current?.close();
  }

  function startEditing() {
    if (!draft || generating || saving) return;
    setEditor((current) => current ?? editorText(draft));
    setEditing(true);
  }

  async function saveDraft() {
    if (!draft || saving || loading || generating || (saved && !edited)) return;
    const candidate = {
      ...draft,
      ...(editor ? summaryFromEditor(editor) : {}),
      updatedAt: new Date().toISOString(),
    };
    const validation = validateDailySummaryDraft(candidate);
    if (validation) {
      setStatus({ kind: "validation-error", message: validation });
      return;
    }
    setSaving(true);
    setStatus({ kind: "saving" });
    try {
      const savedSummary = await saveDailySummary(candidate);
      setDraft(savedSummary);
      setEditor(null);
      setOrigin("saved");
      setSaved(true);
      setEdited(false);
      setEditing(false);
      setStatus({ kind: "saved" });
    } catch (error) {
      setStatus({
        kind: "save-failed",
        message: error instanceof Error ? error.message : "保存失败；编辑内容仍保留。",
      });
    } finally {
      setSaving(false);
    }
  }

  const preview = draft ? { ...draft, ...(editor ? summaryFromEditor(editor) : {}) } : null;
  const busy = loading || generating || saving;

  return (
    <>
      <section
        className="workspace-dashboard-card daily-summary-card"
        data-testid="daily-summary-panel"
      >
        <div className="daily-summary-card-copy">
          <h2>每日总结</h2>
          <p>AI 整理今日安排，可预览和编辑后保存</p>
        </div>
        <button
          type="button"
          className="secondary-button daily-summary-open-button"
          data-testid="daily-summary-open"
          onClick={() => void openSummary()}
        >
          今日总结
        </button>
      </section>

      <dialog
        ref={dialogRef}
        className="daily-summary-dialog"
        data-testid="daily-summary-dialog"
        aria-labelledby="daily-summary-title"
        onClose={() => setDialogOpen(false)}
        onCancel={(event) => {
          event.preventDefault();
          closeSummary();
        }}
      >
        <header className="daily-summary-dialog-header">
          <div className="daily-summary-dialog-heading">
            <h2 id="daily-summary-title">今日总结</h2>
            <p>{model.date}</p>
          </div>
          <div className="daily-summary-dialog-header-actions">
            <p className="daily-summary-status" role="status" aria-live="polite">
              {summaryStatusText(status)}
            </p>
            <button
              type="button"
              className="workspace-card-link"
              onClick={closeSummary}
              disabled={saving}
            >
              关闭
            </button>
          </div>
        </header>

        <div
          className="daily-summary-dialog-body"
          data-testid="daily-summary-body"
          aria-busy={busy}
        >
          {loading || !preview ? (
            <p className="daily-summary-loading" role="status">
              {loading ? "正在读取今天的总结……" : "正在整理今天……"}
            </p>
          ) : editing ? (
            <div className="daily-summary-editor">
              <SummaryEditorField
                title="今日概览"
                value={editor?.overview ?? preview.overview}
                testId="daily-summary-overview"
                onChange={(overview) => {
                  setEditor((current) => ({ ...(current ?? editorText(preview)), overview }));
                  setEdited(true);
                  setSaved(false);
                  setStatus({ kind: "edited", source: origin ?? "local" });
                }}
              />
              <SummaryEditorField
                title="今日完成"
                description="每行一项"
                value={editor?.highlights ?? preview.highlights.join("\n")}
                testId="daily-summary-highlights"
                onChange={(highlights) => {
                  setEditor((current) => ({ ...(current ?? editorText(preview)), highlights }));
                  setEdited(true);
                  setSaved(false);
                  setStatus({ kind: "edited", source: origin ?? "local" });
                }}
              />
              <SummaryEditorField
                title="待推进"
                description="每行一项"
                value={editor?.unfinished ?? preview.unfinished.join("\n")}
                testId="daily-summary-unfinished"
                onChange={(unfinished) => {
                  setEditor((current) => ({ ...(current ?? editorText(preview)), unfinished }));
                  setEdited(true);
                  setSaved(false);
                  setStatus({ kind: "edited", source: origin ?? "local" });
                }}
              />
              <SummaryEditorField
                title="明天提醒"
                description="每行一项"
                value={editor?.tomorrowNotes ?? preview.tomorrowNotes.join("\n")}
                testId="daily-summary-tomorrow-notes"
                onChange={(tomorrowNotes) => {
                  setEditor((current) => ({ ...(current ?? editorText(preview)), tomorrowNotes }));
                  setEdited(true);
                  setSaved(false);
                  setStatus({ kind: "edited", source: origin ?? "local" });
                }}
              />
            </div>
          ) : (
            <div className="daily-summary-preview-content">
              <SummaryPreviewSection title="今日概览">
                <p>{preview.overview}</p>
              </SummaryPreviewSection>
              <SummaryPreviewSection title="今日完成" items={preview.highlights} />
              <SummaryPreviewSection title="待推进" items={preview.unfinished} />
              <SummaryPreviewSection title="明天提醒" items={preview.tomorrowNotes} />
            </div>
          )}
        </div>

        <footer className="daily-summary-dialog-footer">
          <div className="daily-summary-footer-leading">
            <button
              type="button"
              className="secondary-button"
              onClick={() => void regenerate()}
              disabled={!draft || busy}
            >
              {saved ? "AI 重新整理" : "重新生成"}
            </button>
            {origin === "local" && (
              <button
                type="button"
                className="workspace-card-link"
                onClick={onOpenSettings}
                disabled={busy}
              >
                配置 AI
              </button>
            )}
          </div>
          <div className="daily-summary-footer-actions">
            {editing ? (
              <button
                type="button"
                className="workspace-card-link"
                onClick={() => setEditing(false)}
                disabled={busy}
              >
                返回预览
              </button>
            ) : (
              <button
                type="button"
                className="workspace-card-link"
                onClick={startEditing}
                disabled={!draft || busy}
              >
                编辑
              </button>
            )}
            <button
              type="button"
              className="primary-button"
              onClick={() => void saveDraft()}
              disabled={!draft || busy || (saved && !edited)}
              data-testid="daily-summary-save"
            >
              {saving ? "保存中…" : "保存总结"}
            </button>
          </div>
        </footer>
      </dialog>
    </>
  );
}

function SummaryEditorField({
  title,
  description,
  value,
  testId,
  onChange,
}: {
  readonly title: string;
  readonly description?: string;
  readonly value: string;
  readonly testId: string;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="daily-summary-field">
      <span>
        {title}
        {description ? <small>（{description}）</small> : null}
      </span>
      <textarea
        value={value}
        rows={title === "今日概览" ? 3 : 4}
        onChange={(event) => onChange(event.currentTarget.value)}
        data-testid={testId}
      />
    </label>
  );
}

function SummaryPreviewSection({
  title,
  items,
  children,
}: {
  readonly title: string;
  readonly items?: readonly string[];
  readonly children?: ReactNode;
}) {
  return (
    <section className="daily-summary-section">
      <h3>{title}</h3>
      {items ? (
        items.length ? (
          <ul>
            {items.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="daily-summary-empty">暂无记录</p>
        )
      ) : (
        children
      )}
    </section>
  );
}
