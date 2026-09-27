import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createLocalDailyBrief,
  dailyBriefGreeting,
  dailyBriefLocalDate,
  dailyBriefLocalTime,
  isDailyBriefSignificant,
  type DailyBriefResult,
  type DailyBriefSuggestion,
} from "../../application/ai/daily-brief.ts";
import type { AiPlannerProposal } from "../../application/ai/proposal.ts";
import type { AiProposalApplyResult } from "../../application/ai/proposal-runtime.ts";
import type { AiWorkflowOrchestrator } from "../../application/ai/workflow-orchestrator.ts";
import type {
  WorkspaceDashboardSources,
  WorkspaceDashboardViewModel,
} from "../../application/workspace/index.ts";
import { formatTimelineMinute } from "../../application/timeline/planner-interactions.ts";
import { findTimelineConflicts } from "../../application/timeline/planner-interactions.ts";
import {
  DAILY_BRIEF_PREFERENCES_EVENT,
  loadDailyBriefPreferences,
  saveDailyBriefPreferences,
  shouldAutoShowDailyBrief,
  type DailyBriefPreferences,
} from "../../services/daily-brief-storage.ts";
import { AiProposalReview } from "./AiProposalReview.tsx";
import "./daily-brief.css";

interface DailyBriefPanelProps {
  readonly model: WorkspaceDashboardViewModel;
  readonly sources: WorkspaceDashboardSources;
  readonly now: Date;
  readonly service: AiWorkflowOrchestrator;
  readonly onOpenSettings: () => void;
  readonly onConfirmProposal: (proposal: AiPlannerProposal) => Promise<AiProposalApplyResult>;
  readonly onCancelProposal: (proposal: AiPlannerProposal) => void;
  readonly onApplied: () => void;
}

type EnrichmentState = "idle" | "loading" | "ready" | "unavailable";

function buildLocalBrief(
  model: WorkspaceDashboardViewModel,
  sources: WorkspaceDashboardSources,
): DailyBriefResult {
  const lastRelevantDate = addDays(model.date, 3);
  const relevantTasks = model.taskSummary.items.filter((task) => {
    if (task.deadlineKind === "overdue" || task.deadlineKind === "today") return true;
    return (
      task.deadlineKind === "upcoming" &&
      task.dueAt !== null &&
      task.dueAt.slice(0, 10) <= lastRelevantDate
    );
  });
  const relevantPersonalTasks = (sources.personalTasks ?? [])
    .filter(
      (task) =>
        task.status !== "completed" &&
        task.deadlineDate !== null &&
        task.deadlineDate <= lastRelevantDate,
    )
    .sort(
      (left, right) =>
        left.deadlineDate!.localeCompare(right.deadlineDate!) || left.id.localeCompare(right.id),
    );
  const relevantAcademicTasks = sources.tasks
    .filter((task) => {
      const dueDate = task.dueAt.trim().slice(0, 10);
      return (
        task.status !== "COMPLETED" &&
        /^\d{4}-\d{2}-\d{2}$/u.test(dueDate) &&
        dueDate <= lastRelevantDate
      );
    })
    .sort(
      (left, right) => left.dueAt.localeCompare(right.dueAt) || left.id.localeCompare(right.id),
    );
  const taskTitles = [
    ...new Set([
      ...model.taskSummary.todayItems.map((task) => task.title),
      ...relevantTasks.map((task) => task.title),
      ...relevantPersonalTasks.map((task) => task.title),
      ...relevantAcademicTasks.map((task) => task.title),
    ]),
  ].slice(0, 4);
  const slot = model.context.nextFreeSlot?.date === model.date ? model.context.nextFreeSlot : null;
  const hasConflict = model.timelineItems.some(
    (item) =>
      item.date === model.date && findTimelineConflicts(model.timelineItems, item).length > 0,
  );
  const warnings = [
    ...model.warnings,
    ...(hasConflict ? ["今天有安排存在占用时间重叠，请留意冲突。"] : []),
  ];
  const routineNote = model.routineSuggestion
    ? `今天可选的轻量目标：${model.routineSuggestion.title}（约 ${model.routineSuggestion.targetDurationMinutes} 分钟）。`
    : undefined;
  const weatherNote = model.context.weatherSummary
    ? `已缓存天气：${model.context.weatherSummary.condition}，${model.context.weatherSummary.temperature}。`
    : undefined;
  const freeWindow = slot
    ? {
        date: slot.date,
        startTime: formatTimelineMinute(slot.startMinute),
        endTime: formatTimelineMinute(slot.endMinute),
      }
    : undefined;
  const todayDeadlines = model.taskSummary.todayItems.filter(
    (task) => task.deadlineKind === "today",
  );
  const overdue = model.taskSummary.todayItems.filter((task) => task.deadlineKind === "overdue");
  return {
    ...createLocalDailyBrief({
      date: model.date,
      arrangementCount: model.todayArrangements.filter((item) => !item.cancelled).length,
      scheduleHighlights: model.todayArrangements
        .filter((item) => !item.cancelled)
        .slice(0, 6)
        .map((item) => `${item.startTime}–${item.endTime} · ${item.title}`),
      taskTitles,
      overdueCount: overdue.length,
      deadlineCount: todayDeadlines.length,
      freeWindow,
      routineTitles: routineNote ? [routineNote] : [],
      routineNote,
      weatherNote,
      warnings,
    }),
  };
}

function buildSignificance(model: WorkspaceDashboardViewModel, sources: WorkspaceDashboardSources) {
  const hasConflict = model.timelineItems.some(
    (item) =>
      item.date === model.date && findTimelineConflicts(model.timelineItems, item).length > 0,
  );
  const upcomingLimit = addDays(model.date, 3);
  const importantTaskCount = (sources.personalTasks ?? []).filter(
    (task) =>
      task.status !== "completed" &&
      task.priority === "high" &&
      task.deadlineDate !== null &&
      task.deadlineDate <= upcomingLimit,
  ).length;
  return isDailyBriefSignificant({
    arrangementCount: model.todayArrangements.filter((item) => !item.cancelled).length,
    deadlineCount: model.taskSummary.todayItems.filter((item) => item.deadlineKind === "today")
      .length,
    overdueCount: model.taskSummary.todayItems.filter((item) => item.deadlineKind === "overdue")
      .length,
    warningCount: model.warnings.length + Number(hasConflict),
    importantTaskCount,
    routineCount: model.routineSuggestion ? 1 : 0,
  });
}

function addDays(date: string, days: number): string {
  const result = new Date(`${date}T12:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function sourceLabels(sources: DailyBriefResult["sources"]): string {
  const labels = {
    academic: "课程与学业",
    planner: "任务与日程",
    routine: "日常目标",
    weather: "天气",
    dailySummary: "每日总结",
  };
  return sources.map((source) => labels[source]).join("、");
}

export function DailyBriefPanel({
  model,
  sources,
  now,
  service,
  onOpenSettings,
  onConfirmProposal,
  onCancelProposal,
  onApplied,
}: DailyBriefPanelProps) {
  const [preferences, setPreferences] = useState<DailyBriefPreferences>(() =>
    loadDailyBriefPreferences(),
  );
  const [brief, setBrief] = useState<DailyBriefResult>(() => buildLocalBrief(model, sources));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [compactBrief, setCompactBrief] = useState<DailyBriefResult | null>(null);
  const [origin, setOrigin] = useState<"auto" | "manual" | null>(null);
  const [enrichment, setEnrichment] = useState<EnrichmentState>("idle");
  const [enrichmentMessage, setEnrichmentMessage] = useState("");
  const [proposal, setProposal] = useState<AiPlannerProposal | null>(null);
  const [proposalMessage, setProposalMessage] = useState("");
  const autoProcessedDate = useRef("");
  const requestGeneration = useRef(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dailyDate = dailyBriefLocalDate(now);
  const significant = useMemo(() => buildSignificance(model, sources), [model, sources]);

  useEffect(() => {
    const refresh = () => setPreferences(loadDailyBriefPreferences());
    window.addEventListener(DAILY_BRIEF_PREFERENCES_EVENT, refresh);
    return () => window.removeEventListener(DAILY_BRIEF_PREFERENCES_EVENT, refresh);
  }, []);

  const generateBrief = useCallback(async () => {
    const generation = ++requestGeneration.current;
    setEnrichment("loading");
    setEnrichmentMessage("");
    try {
      const result = await service.run({ workflowId: "dailyBrief.generate" });
      if (requestGeneration.current !== generation) return;
      if (result.status === "ready" && result.result.dailyBrief) {
        const local = buildLocalBrief(model, sources);
        const dailyBrief = result.result.dailyBrief;
        setBrief({
          ...dailyBrief,
          ...(dailyBrief.sources.includes("routine") && local.routineNote
            ? { routineNote: local.routineNote }
            : {}),
          ...(dailyBrief.sources.includes("weather") && !dailyBrief.weatherNote && local.weatherNote
            ? { weatherNote: local.weatherNote }
            : {}),
        });
        setEnrichment("ready");
        return;
      }
      setEnrichment("unavailable");
      setEnrichmentMessage(fallbackMessage(result));
    } catch {
      if (requestGeneration.current !== generation) return;
      setEnrichment("unavailable");
      setEnrichmentMessage("AI 分析暂不可用，以下是根据本机数据整理的今日简报。");
    }
  }, [model, service, sources]);

  useEffect(() => {
    if (
      autoProcessedDate.current === dailyDate ||
      !shouldAutoShowDailyBrief(preferences, dailyDate)
    )
      return;
    if (document.querySelector('[role="dialog"]')) {
      autoProcessedDate.current = dailyDate;
      return;
    }
    autoProcessedDate.current = dailyDate;
    const local = buildLocalBrief(model, sources);
    setBrief(local);
    setOrigin("auto");
    if (significant) {
      setDialogOpen(true);
      setCompactBrief(null);
      void generateBrief();
    } else {
      setDialogOpen(false);
      setCompactBrief(local);
      setEnrichment("idle");
    }
  }, [dailyDate, generateBrief, model, preferences, significant, sources]);

  useEffect(() => {
    const visible = dialogOpen || compactBrief !== null;
    if (origin !== "auto" || !visible || preferences.lastAutoShownDate === dailyDate) return;
    const next = { ...preferences, lastAutoShownDate: dailyDate };
    if (saveDailyBriefPreferences(next)) setPreferences(next);
  }, [compactBrief, dailyDate, dialogOpen, origin, preferences]);

  useEffect(() => {
    if (!dialogOpen) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
      }
      if (event.key !== "Tab") return;
      const dialog = document.querySelector<HTMLElement>("[data-testid='daily-brief-dialog']");
      const focusable = dialog
        ? [
            ...dialog.querySelectorAll<HTMLElement>(
              'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
            ),
          ]
        : [];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
        event.preventDefault();
        focusable[0]?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (origin === "manual") previousFocus?.focus();
    };
  }, [dialogOpen, origin]);

  function closeDialog() {
    requestGeneration.current += 1;
    setDialogOpen(false);
    setProposal(null);
    if (origin === "manual") window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function openManual() {
    const local = buildLocalBrief(model, sources);
    setOrigin("manual");
    setBrief(local);
    setDialogOpen(true);
    setCompactBrief(null);
    setProposal(null);
    setProposalMessage("");
    void generateBrief();
  }

  async function createTaskProposal(suggestion: DailyBriefSuggestion) {
    if (!suggestion.taskId || !suggestion.candidateId || brief.mode !== "ai") return;
    const task = sources.personalTasks?.find(
      (item) => item.id === suggestion.taskId && item.status !== "completed",
    );
    const candidate = brief.freeWindows.find((item) => item.candidateId === suggestion.candidateId);
    if (!task || !candidate || candidate.date !== dailyDate) {
      setProposalMessage("这条安排依据的数据已变化；请重新生成简报后再尝试。");
      return;
    }
    setProposalMessage("正在按当前课程与日程重新核验候选时段…");
    const duration = timeMinutes(candidate.endTime) - timeMinutes(candidate.startTime);
    const result = await service.run({
      workflowId: "planner.route",
      instruction: `今天 ${candidate.startTime} 给${task.title}安排 ${duration} 分钟`,
      expectedCandidateId: candidate.candidateId,
    });
    if (result.status === "ready" && result.result.proposal) {
      setProposal(result.result.proposal);
      setProposalMessage("");
    } else if (result.status === "clarification") {
      setProposalMessage(result.message);
    } else {
      setProposalMessage("未能核验这段时间，请刷新简报或稍后重试；数据尚未修改。");
    }
  }

  function cancelProposal(current: AiPlannerProposal) {
    onCancelProposal(current);
    setProposal(null);
    setProposalMessage("提案已取消，应用数据未修改。");
  }

  async function confirmProposal(current: AiPlannerProposal): Promise<AiProposalApplyResult> {
    const result = await onConfirmProposal(current);
    if (result.status === "applied") onApplied();
    return result;
  }

  const greeting = dailyBriefGreeting(dailyBriefLocalTime(now));
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="workspace-card-link daily-brief-trigger"
        aria-haspopup="dialog"
        onClick={openManual}
        data-testid="daily-brief-open"
      >
        今日简报
      </button>
      {compactBrief && (
        <aside className="daily-brief-compact" role="status" data-testid="daily-brief-compact">
          <span>今天安排很轻，目前没有特别需要注意的事情。</span>
          <button type="button" onClick={() => setCompactBrief(null)} aria-label="关闭今日简报提示">
            ×
          </button>
        </aside>
      )}
      {dialogOpen && (
        <div className="daily-brief-backdrop">
          <section
            id="daily-brief-dialog"
            className="daily-brief-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="daily-brief-heading"
            tabIndex={-1}
            data-testid="daily-brief-dialog"
          >
            <header className="daily-brief-header">
              <div>
                <p>{dailyDateLabel(dailyDate)}</p>
                <h2 id="daily-brief-heading">{greeting}</h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className="daily-brief-close"
                aria-label="关闭今日简报"
                onClick={closeDialog}
              >
                ×
              </button>
            </header>
            <div className="daily-brief-content">
              <section className="daily-brief-overview">
                <h3>今日概览</h3>
                <p>{brief.overview}</p>
              </section>
              {brief.topPriorities.length > 0 && (
                <section className="daily-brief-section">
                  <h3>今天最重要的事</h3>
                  <ul>
                    {brief.topPriorities.map((item, index) => (
                      <li key={`${item.title}-${index}`}>
                        <strong>{item.title}</strong>
                        <span>{item.reason}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {brief.routineNote && <TextSection title="轻量目标" items={[brief.routineNote]} />}
              {brief.scheduleHighlights.length > 0 && (
                <TextSection title="今天的日程" items={brief.scheduleHighlights} />
              )}
              {brief.risks.length > 0 && <TextSection title="需要留意" items={brief.risks} />}
              {brief.carryOvers.length > 0 && (
                <TextSection title="连续事项" items={brief.carryOvers} />
              )}
              {brief.freeWindows.length > 0 && (
                <TextSection
                  title="本地核验的空闲时段"
                  items={brief.freeWindows.map(
                    (slot) => `${slot.date} ${slot.startTime}–${slot.endTime}`,
                  )}
                />
              )}
              {brief.suggestions.length > 0 && (
                <section className="daily-brief-section">
                  <h3>可以尝试</h3>
                  <ul>
                    {brief.suggestions.map((item, index) => {
                      const canPropose =
                        brief.mode === "ai" &&
                        Boolean(
                          item.taskId &&
                          item.candidateId &&
                          brief.freeWindows.some((slot) => slot.candidateId === item.candidateId),
                        );
                      return (
                        <li key={`${item.title}-${index}`}>
                          <strong>{item.title}</strong>
                          <span>{item.reason}</span>
                          {canPropose && (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => void createTaskProposal(item)}
                            >
                              生成这个安排
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              {brief.canWait.length > 0 && (
                <TextSection title="今天可以先不做" items={brief.canWait} />
              )}
              {brief.weatherNote && <TextSection title="天气" items={[brief.weatherNote]} />}
              {enrichment === "loading" && (
                <p className="daily-brief-status" role="status">
                  正在补充 AI 分析；工作台其他功能可继续使用。
                </p>
              )}
              {enrichment === "unavailable" && (
                <div className="daily-brief-fallback" role="status">
                  <p>{enrichmentMessage}</p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void generateBrief()}
                  >
                    重试 AI 分析
                  </button>
                  <button type="button" className="workspace-card-link" onClick={onOpenSettings}>
                    AI 设置
                  </button>
                </div>
              )}
              {enrichment === "ready" && (
                <p className="daily-brief-status">
                  AI 分析已完成。
                  {brief.sources.length ? `参考：${sourceLabels(brief.sources)}。` : ""}
                </p>
              )}
              {brief.limitations.length > 0 && (
                <TextSection title="信息限制" items={brief.limitations} />
              )}
              {proposal && (
                <AiProposalReview
                  inline
                  proposal={proposal}
                  onConfirm={confirmProposal}
                  onCancel={cancelProposal}
                />
              )}
              {proposalMessage && (
                <p className="daily-brief-status" role="status">
                  {proposalMessage}
                </p>
              )}
            </div>
            <footer className="daily-brief-footer">
              <span>
                {origin === "auto"
                  ? "自动简报仅在显示后记录当天已展示"
                  : "手动重新生成不会改变每日自动展示记录"}
              </span>
              <button
                type="button"
                className="primary-button"
                onClick={() => void generateBrief()}
                disabled={enrichment === "loading"}
              >
                {enrichment === "loading" ? "正在分析…" : "重新生成 AI 分析"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

function TextSection({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly string[];
}) {
  if (!items.length) return null;
  return (
    <section className="daily-brief-section">
      <h3>{title}</h3>
      <ul>
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function fallbackMessage(result: Awaited<ReturnType<AiWorkflowOrchestrator["run"]>>): string {
  if (result.status === "notConfigured")
    return "尚未配置 DeepSeek，以下是根据本机数据整理的简报。配置服务后可获得 AI 分析。";
  if (result.status === "noPermissions")
    return "没有可用于此次请求的已授权数据；以下保留本机简报。可在 AI 设置中查看数据访问权限。";
  if (result.status === "noContext") return "已授权数据暂不可用；以下保留本机简报。";
  if (result.status === "failed") return "AI 分析暂不可用，以下是根据本机数据整理的简报。";
  if (result.status === "busy") return "AI 正在处理其他请求，以下是根据本机数据整理的简报。";
  if (result.status === "clarification") return result.message;
  return "AI 分析暂不可用，以下是根据本机数据整理的简报。";
}

function dailyDateLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  return `${parsed.getUTCMonth() + 1}月${parsed.getUTCDate()}日`;
}

function timeMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
