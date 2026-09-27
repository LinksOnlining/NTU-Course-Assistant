import { useState, type FormEvent } from "react";
import {
  validateTimeBlockDraft,
  type TimeBlockDraftErrors,
} from "../../application/planner/planner-schedule.ts";
import { ChineseDateInput } from "../../components/ChineseDateInput.tsx";
import type { PersonalTask } from "../../types/personal-task.ts";
import type { TimeBlock, TimeBlockDraft } from "../../types/planner.ts";

interface TimeBlockEditorProps {
  readonly tasks: readonly PersonalTask[];
  readonly block?: TimeBlock;
  readonly initialDate: string;
  readonly initialTaskId?: string;
  readonly busy?: boolean;
  readonly error?: string;
  readonly onSave: (draft: TimeBlockDraft) => Promise<void>;
  readonly onDelete?: () => Promise<void>;
  readonly onCancel: () => void;
}

function draftFromBlock(
  block: TimeBlock | undefined,
  initialDate: string,
  initialTaskId: string | undefined,
): TimeBlockDraft {
  return block
    ? {
        personalTaskId: block.personalTaskId,
        date: block.date,
        startTime: block.startTime,
        endTime: block.endTime,
        bufferBeforeMinutes: block.bufferBeforeMinutes,
        bufferAfterMinutes: block.bufferAfterMinutes,
      }
    : {
        personalTaskId: initialTaskId ?? "",
        date: initialDate,
        startTime: "09:00",
        endTime: "10:00",
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
      };
}

export function TimeBlockEditor({
  tasks,
  block,
  initialDate,
  initialTaskId,
  busy = false,
  error = "",
  onSave,
  onDelete,
  onCancel,
}: TimeBlockEditorProps) {
  const [draft, setDraft] = useState(() => draftFromBlock(block, initialDate, initialTaskId));
  const [errors, setErrors] = useState<TimeBlockDraftErrors>({});
  const update = <K extends keyof TimeBlockDraft>(field: K, value: TimeBlockDraft[K]) =>
    setDraft((current) => ({ ...current, [field]: value }));

  function submit(submission: FormEvent<HTMLFormElement>) {
    submission.preventDefault();
    const nextErrors = validateTimeBlockDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) void onSave(draft);
  }

  return (
    <div className="workspace-task-backdrop">
      <section
        className="workspace-task-dialog workspace-task-dialog--time-block"
        role="dialog"
        aria-modal="true"
        aria-label={block ? "编辑任务时间" : "安排任务时间"}
      >
        <header>
          <h3>{block ? "编辑任务时间" : "安排任务时间"}</h3>
          <button
            type="button"
            className="workspace-task-close"
            onClick={onCancel}
            aria-label="关闭"
          >
            ×
          </button>
        </header>
        {error && (
          <p className="workspace-task-error" role="alert">
            {error}
          </p>
        )}
        <form onSubmit={submit}>
          <label>
            关联任务
            <select
              value={draft.personalTaskId}
              onChange={(input) => update("personalTaskId", input.currentTarget.value)}
              aria-invalid={Boolean(errors.personalTaskId)}
            >
              <option value="">请选择任务</option>
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                  {task.status === "completed" ? "（已完成）" : ""}
                </option>
              ))}
            </select>
          </label>
          {errors.personalTaskId && (
            <p className="workspace-task-error" role="alert">
              {errors.personalTaskId}
            </p>
          )}
          <div className="workspace-task-date-field">
            <span>日期</span>
            <ChineseDateInput
              value={draft.date}
              onChange={(value) => update("date", value)}
              ariaLabel="日期"
              ariaInvalid={Boolean(errors.date)}
            />
          </div>
          {errors.date && <p className="workspace-task-error">{errors.date}</p>}
          <div className="workspace-task-deadline-fields">
            <label>
              开始时间
              <input
                type="time"
                lang="zh-CN"
                value={draft.startTime}
                onChange={(input) => update("startTime", input.currentTarget.value)}
                aria-invalid={Boolean(errors.startTime)}
              />
            </label>
            <label>
              结束时间
              <input
                type="text"
                inputMode="numeric"
                maxLength={5}
                pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00"
                placeholder="时:分（可填 24:00）"
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
          <p className="workspace-task-hint">时间块没有独立标题，会使用所关联任务的名称。</p>
          <footer>
            {block && onDelete && (
              <button
                type="button"
                className="workspace-task-button workspace-task-button--danger"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("确定删除此任务时间安排吗？")) void onDelete();
                }}
              >
                删除安排
              </button>
            )}
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
