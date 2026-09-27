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
  const [message, setMessage] = useState("");

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
    setMessage("正在整理今天……");
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
        if (validation) throw new Error(validation);
        setDraft(generated);
        setOrigin("ai");
        setSaved(false);
        setEditor(null);
        setEdited(false);
        setEditing(false);
        setMessage("AI 已根据今天的安排生成总结。尚未保存。 ");
      } else {
        setDraft(base);
        setOrigin("local");
        setSaved(false);
        setEditor(null);
        setEdited(false);
        setEditing(false);
        setMessage("AI 暂时不可用，已根据本地日程生成基础总结。尚未保存。");
      }
    } catch {
      if (generationRef.current !== requestId) return;
      setDraft(base);
      setOrigin("local");
      setSaved(false);
      setEditor(null);
      setEdited(false);
      setEditing(false);
      setMessage("AI 暂时不可用，已根据本地日程生成基础总结。尚未保存。");
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
    setMessage("正在读取今天的总结……");
    try {
      const existing = await getDailySummaryByDate(model.date);
      if (generationRef.current !== requestId) return;
      if (existing) {
        setDraft(existing);
        setOrigin("saved");
        setSaved(true);
        setMessage("今天的总结已保存。");
        return;
      }
      const local = buildLocalDraft();
      setDraft(local);
      setOrigin("local");
      setMessage("正在整理今天……");
      setLoading(false);
      await generateDraft(local, requestId);
    } catch {
      if (generationRef.current !== requestId) return;
      const local = buildLocalDraft();
      setDraft(local);
      setOrigin("local");
      setSaved(false);
      setMessage("无法读取已保存总结；已根据本地日程生成基础总结。尚未保存。");
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
    setMessage("");
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
      setMessage(validation);
      return;
    }
    setSaving(true);
    setMessage("正在保存今日总结……");
    try {
      const savedSummary = await saveDailySummary(candidate);
      setDraft(savedSummary);
      setEditor(null);
      setOrigin("saved");
      setSaved(true);
      setEdited(false);
      setEditing(false);
      setMessage("今日总结已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败；编辑内容仍保留。");
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
              {message || (saved && !edited ? "今天的总结已保存。" : "尚未保存。")}
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
                  setMessage("尚未保存。");
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
                  setMessage("尚未保存。");
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
                  setMessage("尚未保存。");
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
                  setMessage("尚未保存。");
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
