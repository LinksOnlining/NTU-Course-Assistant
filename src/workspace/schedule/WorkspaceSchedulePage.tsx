import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  loadWorkspaceScheduleDay,
  localDateKey,
  shiftWorkspaceScheduleDate,
} from "../../application/workspace/index.ts";
import {
  createPlannerEvent,
  createTimeBlock,
  deletePlannerEvent,
  deleteTimeBlock,
  updatePlannerEvent,
  updateTimeBlock,
} from "../../application/planner/planner-schedule.ts";
import {
  findTimelineConflicts,
  formatTimelineMinute,
  layoutTimelineItems,
  moveTimelineInterval,
  resizeTimelineInterval,
  timeToDayMinute,
  type MinuteInterval,
} from "../../application/timeline/index.ts";
import type { TimelineItem } from "../../application/timeline/types.ts";
import type {
  PlannerEvent,
  PlannerEventDraft,
  TimeBlock,
  TimeBlockDraft,
} from "../../types/planner.ts";
import type { TermConfig } from "../../types/reminder.ts";
import { PlannerEventEditor } from "./PlannerEventEditor.tsx";
import { TimeBlockEditor } from "./TimeBlockEditor.tsx";
import "./workspace-schedule.css";

type ScheduleEditor =
  | { readonly kind: "event"; readonly event?: PlannerEvent }
  | { readonly kind: "timeBlock"; readonly block?: TimeBlock; readonly initialTaskId?: string };

interface WorkspaceSchedulePageProps {
  readonly termConfig: TermConfig | null;
  readonly requestedTaskId: string | null;
  readonly onTaskRequestHandled: () => void;
}

function dateLabel(date: string): string {
  const value = new Date(`${date}T12:00:00`);
  return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日 星期${"日一二三四五六"[value.getDay()]}`;
}

function minuteOfDay(time: string): number {
  return timeToDayMinute(time, true) ?? 0;
}

type TimelineMutation =
  | {
      readonly kind: "event";
      readonly draft: PlannerEventDraft;
      readonly existing?: PlannerEvent;
    }
  | {
      readonly kind: "timeBlock";
      readonly draft: TimeBlockDraft;
      readonly existing?: TimeBlock;
    };

interface ConflictPrompt {
  readonly mutation: TimelineMutation;
  readonly proposed: TimelineItem;
  readonly conflicts: readonly TimelineItem[];
}

interface PointerInteraction {
  readonly pointerId: number;
  readonly startClientY: number;
  readonly item: TimelineItem;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly edge: "move" | "start" | "end";
  moved: boolean;
  interval: MinuteInterval;
}

function DayTimeline({
  date,
  items,
  onOpen,
  onChange,
}: {
  readonly date: string;
  readonly items: readonly TimelineItem[];
  readonly onOpen: (item: TimelineItem) => void;
  readonly onChange: (item: TimelineItem, interval: MinuteInterval) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<PointerInteraction | null>(null);
  const suppressClickRef = useRef(false);
  const [preview, setPreview] = useState<{ id: string; interval: MinuteInterval } | null>(null);
  const visualItems = useMemo(
    () =>
      preview
        ? items.map((item) =>
            item.id === preview.id
              ? {
                  ...item,
                  startTime: formatTimelineMinute(preview.interval.startMinute),
                  endTime: formatTimelineMinute(preview.interval.endMinute),
                }
              : item,
          )
        : items,
    [items, preview],
  );
  const layout = useMemo(() => layoutTimelineItems(visualItems), [visualItems]);
  const placements = useMemo(
    () => new Map(layout.placements.map((placement) => [placement.id, placement])),
    [layout.placements],
  );
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = localDateKey(now);
  const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const isToday = date === today;

  function beginPointerInteraction(event: React.PointerEvent<HTMLDivElement>, item: TimelineItem) {
    if (!item.draggable || event.button !== 0) return;
    const startMinute = timeToDayMinute(item.startTime);
    const endMinute = timeToDayMinute(item.endTime, true);
    if (startMinute === null || endMinute === null || endMinute <= startMinute) return;
    const handle = (event.target as HTMLElement).closest<HTMLElement>("[data-resize-edge]");
    const edge = handle?.dataset.resizeEdge;
    pointerRef.current = {
      pointerId: event.pointerId,
      startClientY: event.clientY,
      item,
      startMinute,
      endMinute,
      edge: edge === "start" || edge === "end" ? edge : "move",
      moved: false,
      interval: { startMinute, endMinute },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function movePointerInteraction(event: React.PointerEvent<HTMLDivElement>) {
    const interaction = pointerRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const delta = event.clientY - interaction.startClientY;
    interaction.moved ||= Math.abs(delta) >= 3;
    interaction.interval =
      interaction.edge === "move"
        ? moveTimelineInterval(interaction.startMinute, interaction.endMinute, delta)
        : resizeTimelineInterval(
            interaction.startMinute,
            interaction.endMinute,
            interaction.edge,
            delta,
          );
    setPreview({ id: interaction.item.id, interval: interaction.interval });
  }

  function endPointerInteraction(event: React.PointerEvent<HTMLDivElement>) {
    const interaction = pointerRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    pointerRef.current = null;
    setPreview(null);
    if (
      interaction.moved &&
      (interaction.interval.startMinute !== interaction.startMinute ||
        interaction.interval.endMinute !== interaction.endMinute)
    ) {
      suppressClickRef.current = true;
      onChange(interaction.item, interaction.interval);
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  }

  function cancelPointerInteraction(event: React.PointerEvent<HTMLDivElement>) {
    if (pointerRef.current?.pointerId !== event.pointerId) return;
    pointerRef.current = null;
    setPreview(null);
  }

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = isToday
      ? Math.max(0, minuteOfDay(nowTime) - viewport.clientHeight * 0.4)
      : 0;
  }, [date, isToday]);

  return (
    <>
      {layout.warnings.length > 0 && (
        <p className="workspace-data-warning" role="note">
          {layout.warnings.map((warning) => warning.message).join(" ")}
        </p>
      )}
      <div
        ref={viewportRef}
        className="workspace-timeline-viewport workspace-schedule-viewport"
        aria-label="完整日程时间轴"
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
          {visualItems.length === 0 && <p className="workspace-timeline-empty">这一天暂无安排</p>}
          <div className="workspace-timeline-blocks">
            {visualItems.map((item) => {
              const placement = placements.get(item.id);
              if (!placement) return null;
              const style = {
                top: placement.top,
                height: placement.height,
                left: `${placement.leftPercent}%`,
                width: `${placement.widthPercent}%`,
              } as CSSProperties;
              const common = {
                className: [
                  "workspace-timeline-item",
                  `workspace-timeline-item--${item.status}`,
                  `workspace-schedule-item--${item.sourceType}`,
                ].join(" "),
                "data-testid": "workspace-schedule-item",
                "data-source-type": item.sourceType,
                "data-editable": String(item.editable),
                style,
                title: `${item.title} · ${item.startTime}–${item.endTime}${item.location ? ` · ${item.location}` : ""}`,
                "aria-label": `${item.title}，${item.startTime} 至 ${item.endTime}${item.location ? `，${item.location}` : ""}${item.status === "cancelled" ? "，已停课" : ""}`,
              } as const;
              const content = (
                <>
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
                </>
              );
              return item.editable ? (
                <div
                  key={item.id}
                  {...common}
                  role="button"
                  tabIndex={0}
                  className={`${common.className}${preview?.id === item.id ? " workspace-schedule-item--dragging" : ""}`}
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    onOpen(item);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onOpen(item);
                    }
                  }}
                  onPointerDown={(event) => beginPointerInteraction(event, item)}
                  onPointerMove={movePointerInteraction}
                  onPointerUp={endPointerInteraction}
                  onPointerCancel={cancelPointerInteraction}
                >
                  {item.resizable && (
                    <>
                      <span
                        className="workspace-schedule-resize-handle workspace-schedule-resize-handle--start"
                        data-resize-edge="start"
                        aria-hidden="true"
                      />
                      <span
                        className="workspace-schedule-resize-handle workspace-schedule-resize-handle--end"
                        data-resize-edge="end"
                        aria-hidden="true"
                      />
                    </>
                  )}
                  {content}
                </div>
              ) : (
                <article key={item.id} {...common} role="note" tabIndex={0}>
                  {content}
                </article>
              );
            })}
          </div>
          {isToday && (
            <span
              className="workspace-current-time-line"
              style={{ top: minuteOfDay(nowTime) }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>
    </>
  );
}

export function WorkspaceSchedulePage({
  termConfig,
  requestedTaskId,
  onTaskRequestHandled,
}: WorkspaceSchedulePageProps) {
  const [date, setDate] = useState(() => localDateKey(new Date()));
  const [day, setDay] = useState<Awaited<ReturnType<typeof loadWorkspaceScheduleDay>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [editor, setEditor] = useState<ScheduleEditor | null>(null);
  const [busy, setBusy] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [conflictPrompt, setConflictPrompt] = useState<ConflictPrompt | null>(null);
  const conflictReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;
    setDay(null);
    setLoading(true);
    setError("");
    void loadWorkspaceScheduleDay(date, termConfig)
      .then((result) => {
        if (active) setDay(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "无法读取当天日程。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [date, retry, termConfig]);

  useEffect(() => {
    if (!requestedTaskId || !day) return;
    if (day.tasks.some((task) => task.id === requestedTaskId)) {
      setDate(localDateKey(new Date()));
      setEditor({ kind: "timeBlock", initialTaskId: requestedTaskId });
    } else {
      setError("未找到要安排时间的个人任务。");
    }
    onTaskRequestHandled();
  }, [day, onTaskRequestHandled, requestedTaskId]);

  function openTimelineItem(item: TimelineItem) {
    setEditorError("");
    if (!day) return;
    if (item.sourceRef.type === "plannerEvent") {
      const eventId = item.sourceRef.id;
      const event = day.events.find((candidate) => candidate.id === eventId);
      if (event) setEditor({ kind: "event", event });
    } else if (item.sourceRef.type === "timeBlock") {
      const blockId = item.sourceRef.id;
      const block = day.timeBlocks.find((candidate) => candidate.id === blockId);
      if (block) setEditor({ kind: "timeBlock", block });
    }
  }

  async function loadItemsForDate(targetDate: string): Promise<readonly TimelineItem[]> {
    if (day?.date === targetDate) return day.timelineItems;
    return (await loadWorkspaceScheduleDay(targetDate, termConfig)).timelineItems;
  }

  async function commitMutation(mutation: TimelineMutation) {
    if (mutation.kind === "event") {
      return mutation.existing
        ? updatePlannerEvent(mutation.existing, mutation.draft)
        : createPlannerEvent(mutation.draft);
    }
    return mutation.existing
      ? updateTimeBlock(mutation.existing, mutation.draft)
      : createTimeBlock(mutation.draft);
  }

  async function persistMutation(mutation: TimelineMutation) {
    const saved = await commitMutation(mutation);
    setConflictPrompt(null);
    setEditor(null);
    setMutationError("");
    setDate(saved.date);
    setRetry((value) => value + 1);
  }

  function proposedItem(mutation: TimelineMutation): TimelineItem {
    if (mutation.kind === "event") {
      const event: PlannerEvent = {
        id: mutation.existing?.id ?? "pending-event",
        ...mutation.draft,
        description: mutation.draft.description || null,
        location: mutation.draft.location || null,
        createdAt: mutation.existing?.createdAt ?? "",
        updatedAt: mutation.existing?.updatedAt ?? "",
      };
      return {
        id: `planner-event:${event.id}`,
        sourceType: "plannerEvent",
        sourceRef: { type: "plannerEvent", id: event.id },
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime,
        title: event.title,
        location: event.location,
        status: "normal",
        editable: true,
        draggable: true,
        resizable: true,
        occupiesTime: true,
        bufferBeforeMinutes: event.bufferBeforeMinutes,
        bufferAfterMinutes: event.bufferAfterMinutes,
        warnings: [],
      };
    }
    const block: TimeBlock = {
      id: mutation.existing?.id ?? "pending-block",
      ...mutation.draft,
      createdAt: mutation.existing?.createdAt ?? "",
      updatedAt: mutation.existing?.updatedAt ?? "",
    };
    return {
      id: `time-block:${block.id}`,
      sourceType: "timeBlock",
      sourceRef: { type: "timeBlock", id: block.id },
      date: block.date,
      startTime: block.startTime,
      endTime: block.endTime,
      title: day?.tasks.find((task) => task.id === block.personalTaskId)?.title ?? "关联任务",
      location: null,
      status: "normal",
      editable: true,
      draggable: true,
      resizable: true,
      occupiesTime: true,
      bufferBeforeMinutes: block.bufferBeforeMinutes,
      bufferAfterMinutes: block.bufferAfterMinutes,
      warnings: [],
    };
  }

  async function requestMutation(mutation: TimelineMutation) {
    const proposed = proposedItem(mutation);
    setBusy(true);
    setEditorError("");
    setMutationError("");
    try {
      const items = await loadItemsForDate(proposed.date);
      const conflicts = findTimelineConflicts(items, proposed);
      if (conflicts.length > 0) {
        conflictReturnFocusRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setConflictPrompt({ mutation, proposed, conflicts });
        return;
      }
      await persistMutation(mutation);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "保存安排失败。";
      if (editor) setEditorError(message);
      else setMutationError(message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEvent(draft: PlannerEventDraft) {
    await requestMutation({
      kind: "event",
      draft,
      ...(editor?.kind === "event" && editor.event ? { existing: editor.event } : {}),
    });
  }

  async function saveTimeBlock(draft: TimeBlockDraft) {
    await requestMutation({
      kind: "timeBlock",
      draft,
      ...(editor?.kind === "timeBlock" && editor.block ? { existing: editor.block } : {}),
    });
  }

  async function confirmConflictSave() {
    if (!conflictPrompt) return;
    setBusy(true);
    setConflictPrompt(null);
    try {
      await persistMutation(conflictPrompt.mutation);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "保存安排失败。";
      if (editor) setEditorError(message);
      else setMutationError(message);
    } finally {
      setBusy(false);
    }
  }

  function dismissConflictPrompt() {
    setConflictPrompt(null);
    requestAnimationFrame(() => conflictReturnFocusRef.current?.focus());
  }

  async function changeTimelineTime(item: TimelineItem, interval: MinuteInterval) {
    const startTime = formatTimelineMinute(interval.startMinute);
    const endTime = formatTimelineMinute(interval.endMinute);
    if (item.sourceRef.type === "plannerEvent") {
      const eventId = item.sourceRef.id;
      const event = day?.events.find((candidate) => candidate.id === eventId);
      if (!event) return;
      await requestMutation({
        kind: "event",
        existing: event,
        draft: {
          ...event,
          description: event.description ?? "",
          location: event.location ?? "",
          startTime,
          endTime,
        },
      });
    } else if (item.sourceRef.type === "timeBlock") {
      const blockId = item.sourceRef.id;
      const block = day?.timeBlocks.find((candidate) => candidate.id === blockId);
      if (!block) return;
      await requestMutation({
        kind: "timeBlock",
        existing: block,
        draft: { ...block, startTime, endTime },
      });
    }
  }

  async function removeEvent(event: PlannerEvent) {
    setBusy(true);
    setEditorError("");
    try {
      await deletePlannerEvent(event.id);
      setEditor(null);
      setRetry((value) => value + 1);
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : "删除日程失败。");
    } finally {
      setBusy(false);
    }
  }

  async function removeTimeBlock(block: TimeBlock) {
    setBusy(true);
    setEditorError("");
    try {
      await deleteTimeBlock(block.id);
      setEditor(null);
      setRetry((value) => value + 1);
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : "删除任务时间失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="workspace-schedule-page" data-testid="workspace-schedule" data-date={date}>
      <header className="workspace-schedule-heading">
        <div>
          <p className="workspace-tasks-eyebrow">工作台 / 日程</p>
          <h2>日程</h2>
          <time dateTime={date} data-testid="workspace-schedule-date">
            {dateLabel(date)}
          </time>
        </div>
        <div className="workspace-schedule-actions">
          <button
            type="button"
            aria-label="上一天"
            onClick={() => setDate((value) => shiftWorkspaceScheduleDate(value, -1))}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="下一天"
            onClick={() => setDate((value) => shiftWorkspaceScheduleDate(value, 1))}
          >
            ›
          </button>
          <button type="button" onClick={() => setDate(localDateKey(new Date()))}>
            回到今天
          </button>
          <button
            type="button"
            className="workspace-task-button workspace-task-button--primary"
            onClick={() => {
              setEditorError("");
              setEditor({ kind: "event" });
            }}
          >
            + 添加日程
          </button>
        </div>
      </header>
      {mutationError && (
        <p className="workspace-schedule-mutation-error" role="alert">
          {mutationError}
        </p>
      )}
      {error && (
        <section className="workspace-schedule-state" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            重新加载
          </button>
        </section>
      )}
      {loading && (
        <p className="workspace-schedule-state" role="status">
          正在读取日程…
        </p>
      )}
      {day && !loading && !error && (
        <section className="workspace-schedule-card" aria-label={`${dateLabel(date)}日程`}>
          <header className="workspace-card-header">
            <h2>{dateLabel(date)}</h2>
            <p>{day.timelineItems.length} 项安排</p>
          </header>
          {day.warnings.length > 0 && (
            <p className="workspace-data-warning" role="note">
              {day.warnings.join(" ")}
            </p>
          )}
          <DayTimeline
            date={date}
            items={day.timelineItems}
            onOpen={openTimelineItem}
            onChange={changeTimelineTime}
          />
        </section>
      )}
      {editor?.kind === "event" && (
        <PlannerEventEditor
          key={editor.event?.id ?? `new-event:${date}`}
          event={editor.event}
          initialDate={date}
          busy={busy}
          error={editorError}
          onSave={saveEvent}
          onDelete={editor.event ? () => removeEvent(editor.event!) : undefined}
          onCancel={() => setEditor(null)}
        />
      )}
      {editor?.kind === "timeBlock" && day && (
        <TimeBlockEditor
          key={editor.block?.id ?? `new-block:${editor.initialTaskId ?? date}`}
          tasks={day.tasks}
          block={editor.block}
          initialDate={date}
          initialTaskId={editor.initialTaskId}
          busy={busy}
          error={editorError}
          onSave={saveTimeBlock}
          onDelete={editor.block ? () => removeTimeBlock(editor.block!) : undefined}
          onCancel={() => setEditor(null)}
        />
      )}
      {conflictPrompt && (
        <div className="workspace-task-backdrop workspace-schedule-conflict-backdrop">
          <section
            className="workspace-task-dialog workspace-schedule-conflict-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label="发现时间冲突"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                dismissConflictPrompt();
              } else if (event.key === "Tab") {
                const focusable =
                  event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
                const first = focusable.item(0);
                const last = focusable.item(focusable.length - 1);
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <header>
              <h3>发现时间冲突</h3>
            </header>
            <p>
              “{conflictPrompt.proposed.title}” {conflictPrompt.proposed.startTime}–
              {conflictPrompt.proposed.endTime} 与以下安排的有效占用时间重叠：
            </p>
            <ul>
              {conflictPrompt.conflicts.slice(0, 5).map((item) => (
                <li key={item.id}>
                  {item.title} · {item.startTime}–{item.endTime}（
                  {item.sourceType === "academicOccurrence"
                    ? "课程"
                    : item.sourceType === "plannerEvent"
                      ? "日程"
                      : "任务"}
                  ）
                </li>
              ))}
            </ul>
            <p>冲突只是提醒，不会阻止保存。</p>
            <footer>
              <button
                type="button"
                className="workspace-task-button workspace-task-button--secondary"
                disabled={busy}
                autoFocus
                onClick={dismissConflictPrompt}
              >
                返回调整
              </button>
              <button
                type="button"
                className="workspace-task-button workspace-task-button--primary"
                disabled={busy}
                onClick={() => void confirmConflictSave()}
              >
                仍然保存
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
