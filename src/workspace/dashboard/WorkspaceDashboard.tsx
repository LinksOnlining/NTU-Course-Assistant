import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  buildWorkspaceDashboardViewModel,
  loadWorkspaceDashboardSources,
  localDateKey,
  localTimeKey,
  type WorkspaceDashboardSources,
  type WorkspaceDashboardViewModel,
} from "../../application/workspace/index.ts";
import { layoutTimelineItems } from "../../application/timeline/index.ts";
import { createWorkspaceTasksTarget } from "../../navigation/navigation.ts";
import type { AppRoute } from "../../navigation/types.ts";
import type { TermConfig } from "../../types/reminder.ts";
import type { WeatherSnapshot } from "../../types/weather.ts";
import type { RoutineSuggestion } from "../../types/routine.ts";
import type { AiPlannerProposal } from "../../application/ai/proposal.ts";
import type { AiProposalApplyResult } from "../../application/ai/proposal-runtime.ts";
import { aiPlannerProposalRuntime } from "../../application/ai/proposal-runtime.ts";
import { todayAssistantService } from "../ai/today-assistant-service.ts";
import { TodayAssistantPanel } from "../ai/TodayAssistantPanel.tsx";
import { DailyBriefPanel } from "../ai/DailyBriefPanel.tsx";
import "./workspace-dashboard.css";

interface WorkspaceDashboardProps {
  readonly ready: boolean;
  readonly storageError: string;
  readonly termConfig: TermConfig | null;
  readonly weatherSnapshot: WeatherSnapshot | null;
  readonly onNavigate: (route: AppRoute) => void;
  readonly onScheduleRoutine?: (suggestion: RoutineSuggestion) => void;
  readonly onOpenAISettings?: () => void;
}

function minuteOfDay(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timeout = 0;
    const schedule = () => {
      timeout = window.setTimeout(
        () => {
          setNow(new Date());
          schedule();
        },
        60_000 - (Date.now() % 60_000),
      );
    };
    schedule();
    return () => window.clearTimeout(timeout);
  }, []);
  return now;
}

function useDashboardSources(
  ready: boolean,
  date: string,
  termConfig: TermConfig | null,
  retry: number,
): { sources: WorkspaceDashboardSources | null; error: string } {
  const [sources, setSources] = useState<WorkspaceDashboardSources | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!ready) return;
    let active = true;
    setSources(null);
    setError("");
    void loadWorkspaceDashboardSources(date, termConfig)
      .then((result) => {
        if (active) setSources(result);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "无法读取今日日程。");
        }
      });
    return () => {
      active = false;
    };
  }, [date, ready, retry, termConfig]);

  return { sources, error };
}

function taskRoute(): AppRoute {
  return createWorkspaceTasksTarget().route;
}

function TimelineCard({
  model,
  nowTime,
  onNavigate,
}: {
  readonly model: WorkspaceDashboardViewModel;
  readonly nowTime: string;
  readonly onNavigate: (route: AppRoute) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrolledDate = useRef("");
  const layout = useMemo(() => layoutTimelineItems(model.timelineItems), [model.timelineItems]);
  const placements = useMemo(
    () => new Map(layout.placements.map((placement) => [placement.id, placement])),
    [layout.placements],
  );
  const nowMinute = minuteOfDay(nowTime);

  useLayoutEffect(() => {
    if (scrolledDate.current === model.date) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    viewport.scrollTop = Math.min(maxScroll, Math.max(0, nowMinute - viewport.clientHeight * 0.4));
    scrolledDate.current = model.date;
  }, [model.date, nowMinute]);

  return (
    <section className="workspace-dashboard-card workspace-timeline-card">
      <header className="workspace-card-header workspace-timeline-header">
        <div>
          <h2>今日日程</h2>
          <p className="workspace-timeline-summary">{model.todayItemCount} 项安排</p>
        </div>
        <button
          type="button"
          className="workspace-card-link"
          onClick={() => onNavigate({ area: "workspace", page: "schedule" })}
        >
          查看完整日程 <span aria-hidden="true">→</span>
        </button>
      </header>

      {(model.warnings.length > 0 || layout.warnings.length > 0) && (
        <p className="workspace-data-warning" role="note">
          {[...model.warnings, ...layout.warnings.map((warning) => warning.message)].join(" ")}
        </p>
      )}

      <div
        ref={viewportRef}
        className="workspace-timeline-viewport"
        aria-label="今日日程时间轴"
        role="region"
        tabIndex={0}
      >
        <div className="workspace-timeline-canvas" style={{ height: layout.height }}>
          <div className="workspace-timeline-ruler" aria-hidden="true">
            {layout.ticks.map((tick) => (
              <span
                key={tick.minute}
                className={`workspace-timeline-tick workspace-timeline-tick--${tick.kind}`}
                style={{ top: tick.minute }}
              >
                {tick.label}
              </span>
            ))}
          </div>
          <div className="workspace-timeline-grid" aria-hidden="true">
            {layout.ticks.map((tick) => (
              <span
                key={tick.minute}
                className={`workspace-timeline-grid-line workspace-timeline-grid-line--${tick.kind}`}
                style={{ top: tick.minute }}
              />
            ))}
          </div>
          {model.timelineItems.length === 0 && (
            <p className="workspace-timeline-empty">今天暂无日程</p>
          )}
          <div className="workspace-timeline-blocks">
            {model.timelineItems.map((item) => {
              const placement = placements.get(item.id);
              if (!placement) return null;
              const style = {
                top: placement.top,
                height: placement.height,
                left: `${placement.leftPercent}%`,
                width: `${placement.widthPercent}%`,
              } as CSSProperties;
              return (
                <article
                  key={item.id}
                  className={`workspace-timeline-item workspace-timeline-item--${item.status}`}
                  data-testid="timeline-item"
                  data-source-type={item.sourceType}
                  data-editable={item.editable}
                  data-draggable={item.draggable}
                  data-resizable={item.resizable}
                  style={style}
                  title={`${item.title} · ${item.startTime}–${item.endTime}${item.location ? ` · ${item.location}` : ""}`}
                  aria-label={`${item.title}，${item.startTime} 至 ${item.endTime}${item.location ? `，${item.location}` : ""}${item.status === "cancelled" ? "，已停课" : ""}`}
                >
                  <strong>{item.title}</strong>
                  <span>
                    {item.startTime}–{item.endTime}
                  </span>
                  {item.location && <span>{item.location}</span>}
                  {item.status === "cancelled" && (
                    <span className="workspace-item-status">已停课</span>
                  )}
                  {item.status === "rescheduled" && (
                    <span className="workspace-item-status">已调课</span>
                  )}
                  {item.status === "makeup" && <span className="workspace-item-status">补课</span>}
                </article>
              );
            })}
          </div>
          <span
            className="workspace-current-time-line"
            style={{ top: nowMinute }}
            aria-hidden="true"
          />
        </div>
      </div>
    </section>
  );
}

function TimeContext({
  model,
  onScheduleRoutine,
}: {
  readonly model: WorkspaceDashboardViewModel;
  readonly onScheduleRoutine?: (suggestion: RoutineSuggestion) => void;
}) {
  const { primary, secondary } = model.timeContext;
  const suggestion = model.routineSuggestion;
  return (
    <aside
      className="workspace-time-context"
      aria-label="时间概览"
      data-testid="workspace-time-context"
    >
      <div className="workspace-time-section">
        <p className="workspace-time-kicker">{primary.label}</p>
        <strong className="workspace-time-value" title={primary.title ?? undefined}>
          {primary.value}
        </strong>
        {primary.title && (
          <strong className="workspace-time-course" title={primary.title}>
            {primary.title}
          </strong>
        )}
        <span>{primary.detail}</span>
        {primary.location && <span>{primary.location}</span>}
      </div>
      {secondary && (
        <div className="workspace-time-section workspace-time-section--secondary">
          <p className="workspace-time-kicker">{secondary.label}</p>
          <strong
            className={secondary.title ? "workspace-time-course" : "workspace-time-value"}
            title={secondary.title ?? undefined}
          >
            {secondary.value}
          </strong>
          <span>{secondary.detail}</span>
          {secondary.location && <span>{secondary.location}</span>}
        </div>
      )}
      {suggestion && onScheduleRoutine && (
        <div className="workspace-routine-suggestion" data-testid="routine-suggestion">
          <span>可安排</span>
          <strong>
            {suggestion.title} · {suggestion.targetDurationMinutes} 分钟
          </strong>
          <button type="button" onClick={() => onScheduleRoutine(suggestion)}>
            安排
          </button>
        </div>
      )}
    </aside>
  );
}

function TaskCard({
  model,
  onNavigate,
}: {
  readonly model: WorkspaceDashboardViewModel;
  readonly onNavigate: (route: AppRoute) => void;
}) {
  const summary = model.taskSummary;
  return (
    <section className="workspace-dashboard-card workspace-task-card">
      <header className="workspace-card-header">
        <h2>
          <button
            type="button"
            className="workspace-card-title-link"
            onClick={() => onNavigate(taskRoute())}
          >
            任务
          </button>
        </h2>
        <button
          type="button"
          className="workspace-card-link"
          onClick={() => onNavigate(taskRoute())}
        >
          查看全部 <span aria-hidden="true">→</span>
        </button>
      </header>
      {summary.items.length === 0 ? (
        <p className="workspace-card-empty">暂无未完成任务</p>
      ) : (
        <ul className="workspace-task-list">
          {summary.items.map((task) => (
            <li key={task.id}>
              <button type="button" onClick={() => onNavigate(taskRoute())}>
                <strong>{task.title}</strong>
                <span
                  className={`workspace-task-deadline workspace-task-deadline--${task.deadlineKind}`}
                >
                  {task.deadlineLabel} · {task.sourceLabel}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {summary.hiddenCount > 0 && (
        <p className="workspace-task-more">另有 {summary.hiddenCount} 项</p>
      )}
    </section>
  );
}

function ObsidianCard({ onNavigate }: { readonly onNavigate: (route: AppRoute) => void }) {
  return (
    <button
      type="button"
      className="workspace-dashboard-card workspace-module-card"
      onClick={() => onNavigate({ area: "workspace", page: "diary" })}
      aria-label="Obsidian，打开现有知识库"
    >
      <span className="workspace-module-title">Obsidian</span>
      <span className="workspace-module-status">我的知识库</span>
      <span className="workspace-module-description">在 Obsidian 中记录与同步</span>
    </button>
  );
}

function InboxCard({
  pendingCount,
  onNavigate,
}: {
  readonly pendingCount: number;
  readonly onNavigate: (route: AppRoute) => void;
}) {
  const status = pendingCount > 0 ? `待整理 ${pendingCount} 条` : "暂无待整理";
  return (
    <button
      type="button"
      className="workspace-dashboard-card workspace-module-card"
      onClick={() => onNavigate({ area: "workspace", page: "inbox" })}
      aria-label={`收件箱，${status}`}
    >
      <span className="workspace-module-title">收件箱</span>
      <span className="workspace-module-status">{status}</span>
      <span className="workspace-module-description">整理暂存的任务和日程想法</span>
    </button>
  );
}

export function WorkspaceDashboard({
  ready,
  storageError,
  termConfig,
  weatherSnapshot,
  onNavigate,
  onScheduleRoutine,
  onOpenAISettings,
}: WorkspaceDashboardProps) {
  const now = useMinuteClock();
  const date = localDateKey(now);
  const nowTime = localTimeKey(now);
  const [retry, setRetry] = useState(0);
  const [showTodayDetails, setShowTodayDetails] = useState(false);
  const todayOverviewRef = useRef<HTMLElement>(null);
  const todayTriggerRef = useRef<HTMLButtonElement>(null);
  const todayPopoverRef = useRef<HTMLElement>(null);
  const { sources, error } = useDashboardSources(ready, date, termConfig, retry);
  const model = useMemo(
    () =>
      sources?.date === date
        ? buildWorkspaceDashboardViewModel(sources, nowTime, weatherSnapshot)
        : null,
    [date, nowTime, sources, weatherSnapshot],
  );

  useEffect(() => {
    if (!showTodayDetails) return;
    todayPopoverRef.current?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!todayOverviewRef.current?.contains(event.target as Node)) setShowTodayDetails(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowTodayDetails(false);
      todayTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showTodayDetails]);

  if (!ready) {
    return (
      <section className="workspace-dashboard-state" role={storageError ? "alert" : "status"}>
        <h2>{storageError ? "工作台暂不可用" : "正在读取本地数据…"}</h2>
        {storageError && <p>{storageError}</p>}
      </section>
    );
  }
  if (error) {
    return (
      <section className="workspace-dashboard-state" role="alert">
        <h2>今日日程读取失败</h2>
        <p>{error}</p>
        <button
          type="button"
          className="workspace-card-link"
          onClick={() => setRetry((value) => value + 1)}
        >
          重新加载
        </button>
      </section>
    );
  }
  if (!model) {
    return (
      <section className="workspace-dashboard-state" role="status">
        <h2>正在读取今日日程…</h2>
      </section>
    );
  }

  return (
    <div className="workspace-dashboard-page">
      <section
        ref={todayOverviewRef}
        className="workspace-today-overview"
        aria-label="今日概览"
        data-testid="workspace-today-overview"
      >
        <div className="workspace-ambient" aria-hidden="true" />
        <button
          ref={todayTriggerRef}
          type="button"
          className="workspace-today-overview-trigger"
          aria-haspopup="dialog"
          aria-expanded={showTodayDetails}
          aria-controls="workspace-today-details"
          onClick={() => setShowTodayDetails((open) => !open)}
        >
          <span className="workspace-today-status" role="heading" aria-level={2}>
            {model.todayStatusText}
          </span>
          <span className="workspace-today-summary">{model.todaySummaryText}</span>
        </button>
        <DailyBriefPanel
          model={model}
          sources={sources!}
          now={now}
          service={todayAssistantService}
          onOpenSettings={() => onOpenAISettings?.()}
          onConfirmProposal={(proposal: AiPlannerProposal): Promise<AiProposalApplyResult> =>
            aiPlannerProposalRuntime.apply({
              id: proposal.id,
              confirmed: true,
              expectedPreviewRevision: proposal.preview.revision,
              permissionIds: ["planner.propose"],
            })
          }
          onCancelProposal={(proposal) => aiPlannerProposalRuntime.cancel(proposal.id)}
          onApplied={() => setRetry((value) => value + 1)}
        />
        {showTodayDetails && (
          <section
            ref={todayPopoverRef}
            id="workspace-today-details"
            className="workspace-today-details"
            role="dialog"
            aria-label="今日详情"
            tabIndex={-1}
          >
            <div className="workspace-today-details-section">
              <h3>今日安排（{model.todayItemCount} 项）</h3>
              {model.todayArrangements.length ? (
                <ul aria-label="今日安排列表">
                  {model.todayArrangements.map((item) => (
                    <li
                      key={item.id}
                      className={item.cancelled ? "workspace-today-detail-cancelled" : undefined}
                    >
                      <time>
                        {item.startTime}–{item.endTime}
                      </time>
                      <strong>{item.title}</strong>
                      <span>{item.cancelled ? "已停课" : item.sourceLabel}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>今天没有安排。</p>
              )}
            </div>
            <div className="workspace-today-details-section">
              <h3>今日待办（{model.taskSummary.todayItems.length} 项）</h3>
              {model.taskSummary.todayItems.length ? (
                <ul aria-label="今日待办列表">
                  {model.taskSummary.todayItems.map((task) => (
                    <li key={task.id}>
                      <strong>{task.title}</strong>
                      <span>
                        {task.deadlineLabel} · {task.sourceLabel}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>没有逾期或今天截止的未完成待办。</p>
              )}
            </div>
          </section>
        )}
      </section>
      <div className="workspace-dashboard" data-testid="workspace-dashboard" data-date={model.date}>
        <TimelineCard model={model} nowTime={nowTime} onNavigate={onNavigate} />
        <TimeContext model={model} onScheduleRoutine={onScheduleRoutine} />
        <aside className="workspace-dashboard-rail" aria-label="工作台摘要">
          <TaskCard model={model} onNavigate={onNavigate} />
          <div className="workspace-module-pair">
            <ObsidianCard onNavigate={onNavigate} />
            <InboxCard pendingCount={model.context.pendingInboxCount} onNavigate={onNavigate} />
          </div>
          <TodayAssistantPanel
            service={todayAssistantService}
            onOpenSettings={() => onOpenAISettings?.()}
            onConfirmProposal={(proposal: AiPlannerProposal): Promise<AiProposalApplyResult> =>
              aiPlannerProposalRuntime.apply({
                id: proposal.id,
                confirmed: true,
                expectedPreviewRevision: proposal.preview.revision,
                permissionIds: ["planner.propose"],
              })
            }
            onCancelProposal={(proposal) => {
              aiPlannerProposalRuntime.cancel(proposal.id);
            }}
            onApplied={() => setRetry((value) => value + 1)}
          />
        </aside>
      </div>
    </div>
  );
}
