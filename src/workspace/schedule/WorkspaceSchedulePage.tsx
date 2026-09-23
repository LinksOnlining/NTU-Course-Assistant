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
import { layoutTimelineItems } from "../../application/timeline/index.ts";
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
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function DayTimeline({
  date,
  items,
  onOpen,
}: {
  readonly date: string;
  readonly items: readonly TimelineItem[];
  readonly onOpen: (item: TimelineItem) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => layoutTimelineItems(items), [items]);
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
          {items.length === 0 && <p className="workspace-timeline-empty">这一天暂无安排</p>}
          <div className="workspace-timeline-blocks">
            {items.map((item) => {
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
                <button key={item.id} type="button" {...common} onClick={() => onOpen(item)}>
                  {content}
                </button>
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

  async function saveEvent(draft: PlannerEventDraft) {
    setBusy(true);
    setEditorError("");
    try {
      const saved =
        editor?.kind === "event" && editor.event
          ? await updatePlannerEvent(editor.event, draft)
          : await createPlannerEvent(draft);
      setEditor(null);
      setDate(saved.date);
      setRetry((value) => value + 1);
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : "保存日程失败。");
    } finally {
      setBusy(false);
    }
  }

  async function saveTimeBlock(draft: TimeBlockDraft) {
    setBusy(true);
    setEditorError("");
    try {
      const saved =
        editor?.kind === "timeBlock" && editor.block
          ? await updateTimeBlock(editor.block, draft)
          : await createTimeBlock(draft);
      setEditor(null);
      setDate(saved.date);
      setRetry((value) => value + 1);
    } catch (cause) {
      setEditorError(cause instanceof Error ? cause.message : "保存任务时间失败。");
    } finally {
      setBusy(false);
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
          <DayTimeline date={date} items={day.timelineItems} onOpen={openTimelineItem} />
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
    </main>
  );
}
