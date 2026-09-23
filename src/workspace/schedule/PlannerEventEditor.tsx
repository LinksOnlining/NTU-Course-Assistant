import { useState, type FormEvent } from "react";
import {
  validatePlannerEventDraft,
  type PlannerEventDraftErrors,
} from "../../application/planner/planner-schedule.ts";
import type { PlannerEvent, PlannerEventDraft } from "../../types/planner.ts";

interface PlannerEventEditorProps {
  readonly event?: PlannerEvent;
  readonly initialDate: string;
  readonly busy?: boolean;
  readonly onSave: (draft: PlannerEventDraft) => Promise<void>;
  readonly onCancel: () => void;
}

function draftFromEvent(event: PlannerEvent | undefined, initialDate: string): PlannerEventDraft {
  return event
    ? {
        title: event.title,
        description: event.description ?? "",
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime,
        location: event.location ?? "",
        bufferBeforeMinutes: event.bufferBeforeMinutes,
        bufferAfterMinutes: event.bufferAfterMinutes,
      }
    : {
        title: "",
        description: "",
        date: initialDate,
        startTime: "09:00",
        endTime: "10:00",
        location: "",
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
      };
}

export function PlannerEventEditor({
  event,
  initialDate,
  busy = false,
  onSave,
  onCancel,
}: PlannerEventEditorProps) {
  const [draft, setDraft] = useState(() => draftFromEvent(event, initialDate));
  const [errors, setErrors] = useState<PlannerEventDraftErrors>({});
  const update = <K extends keyof PlannerEventDraft>(field: K, value: PlannerEventDraft[K]) =>
    setDraft((current) => ({ ...current, [field]: value }));

  function submit(submission: FormEvent<HTMLFormElement>) {
    submission.preventDefault();
    const nextErrors = validatePlannerEventDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) void onSave(draft);
  }

  return (
    <div className="workspace-task-backdrop">
      <section
        className="workspace-task-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={event ? "编辑日程" : "添加日程"}
      >
        <header>
          <h3>{event ? "编辑日程" : "添加日程"}</h3>
          <button
            type="button"
            className="workspace-task-close"
            onClick={onCancel}
            aria-label="关闭"
          >
            ×
          </button>
        </header>
        <form onSubmit={submit}>
          <label>
            标题
            <input
              autoFocus
              maxLength={200}
              value={draft.title}
              onChange={(input) => update("title", input.currentTarget.value)}
              aria-invalid={Boolean(errors.title)}
            />
          </label>
          <label>
            日期
            <input
              type="date"
              value={draft.date}
              onChange={(input) => update("date", input.currentTarget.value)}
              aria-invalid={Boolean(errors.date)}
            />
          </label>
          {(errors.title || errors.date) && (
            <p className="workspace-task-error" role="alert">
              {errors.title ?? errors.date}
            </p>
          )}
          <div className="workspace-task-deadline-fields">
            <label>
              开始时间
              <input
                type="time"
                value={draft.startTime}
                onChange={(input) => update("startTime", input.currentTarget.value)}
                aria-invalid={Boolean(errors.startTime)}
              />
            </label>
            <label>
              结束时间
              <input
                type="time"
                value={draft.endTime}
                onChange={(input) => update("endTime", input.currentTarget.value)}
                aria-invalid={Boolean(errors.endTime)}
              />
            </label>
          </div>
          {(errors.startTime || errors.endTime) && (
            <p className="workspace-task-error" role="alert">
              {errors.startTime ?? errors.endTime}
            </p>
          )}
          <label>
            地点（可选）
            <input
              maxLength={200}
              value={draft.location}
              onChange={(input) => update("location", input.currentTarget.value)}
              aria-invalid={Boolean(errors.location)}
            />
          </label>
          {errors.location && <p className="workspace-task-error">{errors.location}</p>}
          <label>
            描述（可选）
            <textarea
              rows={2}
              maxLength={5000}
              value={draft.description}
              onChange={(input) => update("description", input.currentTarget.value)}
              aria-invalid={Boolean(errors.description)}
            />
          </label>
          {errors.description && <p className="workspace-task-error">{errors.description}</p>}
          <div className="workspace-task-deadline-fields">
            <label>
              提前缓冲（分钟）
              <input
                type="number"
                min={0}
                max={240}
                step={1}
                value={draft.bufferBeforeMinutes}
                onChange={(input) =>
                  update("bufferBeforeMinutes", Number(input.currentTarget.value))
                }
                aria-invalid={Boolean(errors.bufferBeforeMinutes)}
              />
            </label>
            <label>
              延后缓冲（分钟）
              <input
                type="number"
                min={0}
                max={240}
                step={1}
                value={draft.bufferAfterMinutes}
                onChange={(input) =>
                  update("bufferAfterMinutes", Number(input.currentTarget.value))
                }
                aria-invalid={Boolean(errors.bufferAfterMinutes)}
              />
            </label>
          </div>
          {(errors.bufferBeforeMinutes || errors.bufferAfterMinutes) && (
            <p className="workspace-task-error" role="alert">
              {errors.bufferBeforeMinutes ?? errors.bufferAfterMinutes}
            </p>
          )}
          <p className="workspace-task-hint">
            缓冲仅用于时间占用与冲突计算，不会改变日程实际起止时间。
          </p>
          <footer>
            <button
              type="button"
              className="workspace-task-button workspace-task-button--secondary"
              onClick={onCancel}
              disabled={busy}
            >
              取消
            </button>
            <button
              type="submit"
              className="workspace-task-button workspace-task-button--primary"
              disabled={busy}
            >
              {busy ? "正在保存…" : "保存"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
