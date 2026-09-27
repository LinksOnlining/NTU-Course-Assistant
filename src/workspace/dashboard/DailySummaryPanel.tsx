import { useEffect, useState } from "react";
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
import type { DailySummary } from "../../types/daily-summary.ts";
import type { AiWorkflowOrchestrator } from "../../application/ai/workflow-orchestrator.ts";
import "./daily-summary.css";

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
  const [draft, setDraft] = useState<DailySummary | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessage("");
    void getDailySummaryByDate(model.date)
      .then((existing) => {
        if (!active) return;
        setDraft(existing ?? buildLocalDraft());
        setSaved(Boolean(existing));
        setDirty(!existing);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setDraft(buildLocalDraft());
        setSaved(false);
        setDirty(true);
        setMessage(error instanceof Error ? error.message : "读取每日总结失败；已生成本地草稿。");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [model.date, sources]);

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

  function updateDraft(patch: Partial<DailySummary>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
    setMessage("尚有未保存的修改。");
  }

  function useLocalDraft() {
    if (dirty && !window.confirm("放弃当前未保存的修改并重新生成本地草稿？")) return;
    setDraft(buildLocalDraft());
    setSaved(false);
    setDirty(true);
    setMessage("本地草稿已生成，保存前不会写入数据。 ");
  }

  async function enrichOverview() {
    if (!draft || enriching) return;
    setEnriching(true);
    setMessage("正在根据已授权的今日结构化数据整理概览；其他工作台功能可继续使用。");
    try {
      const result = await service.run({ workflowId: "dailySummary.generate" });
      if (result.status === "ready" && result.result.workflowId === "dailySummary.generate") {
        const overview = result.result.answer.trim();
        if (!overview || [...overview].length > 500) throw new Error("AI 返回的概览格式无效。");
        updateDraft({ overview });
        setMessage("AI 已润色概览；其他总结条目仍来自本机草稿，请检查后手动保存。");
      } else {
        setMessage(`${workflowFallback(result)}本地草稿仍保留，未保存的内容没有丢失。`);
      }
    } catch (error) {
      setMessage(
        `${error instanceof Error ? error.message : "AI 暂不可用。"}本地草稿仍保留，可稍后重试。`,
      );
    } finally {
      setEnriching(false);
    }
  }

  async function saveDraft() {
    if (!draft || saving) return;
    const validation = validateDailySummaryDraft(draft);
    if (validation) {
      setMessage(validation);
      return;
    }
    setSaving(true);
    setMessage("正在保存每日总结…");
    try {
      const savedSummary = await saveDailySummary({
        ...draft,
        updatedAt: new Date().toISOString(),
      });
      setDraft(savedSummary);
      setSaved(true);
      setDirty(false);
      setMessage("每日总结已保存到本机。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败；草稿仍保留在当前页面。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <details
      className="workspace-dashboard-card daily-summary-card"
      data-testid="daily-summary-panel"
    >
      <summary className="daily-summary-header">
        <div>
          <h2 id="daily-summary-title">每日总结</h2>
          <p>
            {model.date} ·{" "}
            {saved && !dirty
              ? `已保存 · 第 ${draft?.revision ?? 1} 版`
              : saved
                ? "有未保存修改"
                : "本地草稿，需手动保存"}
          </p>
        </div>
        {draft && <span className="daily-summary-preview">{draft.overview}</span>}
        <span className="daily-summary-toggle">编辑</span>
      </summary>
      <div className="daily-summary-editor">
        <button
          type="button"
          className="workspace-card-link"
          onClick={useLocalDraft}
          disabled={loading || saving}
        >
          本地草稿
        </button>
        {loading || !draft ? (
          <p className="daily-summary-status" role="status">
            正在读取每日总结…
          </p>
        ) : (
          <>
            <label className="daily-summary-field">
              <span>今日概览</span>
              <textarea
                value={draft.overview}
                maxLength={2000}
                rows={3}
                onChange={(event) => updateDraft({ overview: event.currentTarget.value })}
                data-testid="daily-summary-overview"
              />
            </label>
            <SummaryListField
              title="今日完成"
              value={draft.highlights}
              onChange={(highlights) => updateDraft({ highlights })}
            />
            <SummaryListField
              title="待推进"
              value={draft.unfinished}
              onChange={(unfinished) => updateDraft({ unfinished })}
            />
            <SummaryListField
              title="明日备注"
              value={draft.tomorrowNotes}
              onChange={(tomorrowNotes) => updateDraft({ tomorrowNotes })}
            />
            <div className="daily-summary-actions">
              <div className="daily-summary-ai-actions">
                <button type="button" className="workspace-card-link" onClick={onOpenSettings}>
                  配置 AI
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void enrichOverview()}
                  disabled={enriching || saving}
                >
                  {enriching ? "AI 整理中…" : "AI 润色概览"}
                </button>
              </div>
              <button
                type="button"
                className="primary-button"
                onClick={() => void saveDraft()}
                disabled={saving || enriching || !dirty}
                data-testid="daily-summary-save"
              >
                {saving ? "保存中…" : "保存总结"}
              </button>
            </div>
            {message && (
              <p className="daily-summary-status" role="status" aria-live="polite">
                {message}
              </p>
            )}
          </>
        )}
      </div>
    </details>
  );
}

function SummaryListField({
  title,
  value,
  onChange,
}: {
  readonly title: string;
  readonly value: readonly string[];
  readonly onChange: (value: readonly string[]) => void;
}) {
  return (
    <label className="daily-summary-field">
      <span>{title}（每行一项，最多 8 项）</span>
      <textarea
        value={value.join("\n")}
        rows={2}
        onChange={(event) =>
          onChange(
            event.currentTarget.value
              .split(/\r?\n/u)
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
      />
    </label>
  );
}

function workflowFallback(result: Awaited<ReturnType<AiWorkflowOrchestrator["run"]>>): string {
  if (result.status === "notConfigured") return "尚未配置 DeepSeek。";
  if (result.status === "noPermissions") return "尚无适用于每日总结的已授权数据。";
  if (result.status === "noContext") return "已授权数据暂不可用。";
  if (result.status === "failed") return result.message;
  if (result.status === "busy") return "AI 正在处理其他请求。";
  if (result.status === "clarification") return result.message;
  return "AI 暂不可用。";
}
