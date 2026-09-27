import { useEffect, useMemo, useState, type FormEvent } from "react";
import { loadAcademicHubData } from "../../application/academic/index.ts";
import { ChineseDateInput } from "../../components/ChineseDateInput.tsx";
import {
  createPersonalTask,
  deletePersonalTask,
  loadPersonalTasks,
  personalTaskDeadlineKind,
  personalTaskDeadlineLabel,
  setPersonalTaskCompleted,
  sortPersonalTasks,
  updatePersonalTask,
  validatePersonalTaskDraft,
  type PersonalTaskDraftErrors,
} from "../../application/planner/personal-tasks.ts";
import type { AppRoute } from "../../navigation/types.ts";
import type { AcademicTask } from "../../types/academic-task.ts";
import type {
  PersonalTask,
  PersonalTaskDraft,
  PersonalTaskPriority,
} from "../../types/personal-task.ts";
import type { TermConfig } from "../../types/reminder.ts";
import "./workspace-tasks.css";

interface WorkspaceTasksPageProps {
  readonly termConfig: TermConfig | null;
  readonly onNavigate: (route: AppRoute) => void;
  readonly onScheduleTask: (taskId: string) => void;
  readonly initialTaskId?: string;
}

type TaskTab = "open" | "completed";

const EMPTY_DRAFT: PersonalTaskDraft = {
  title: "",
  description: "",
  priority: "none",
  deadlineDate: "",
  deadlineTime: "",
};

function draftFromTask(task: PersonalTask): PersonalTaskDraft {
  return {
    title: task.title,
    description: task.description ?? "",
    priority: task.priority,
    deadlineDate: task.deadlineDate ?? "",
    deadlineTime: task.deadlineTime ?? "",
  };
}

function academicDeadline(task: AcademicTask): string {
  if (!task.dueAt.trim()) return "无截止日期";
  const date = new Date(task.dueAt);
  if (!Number.isFinite(date.getTime())) return "截止日期待确认";
  const dateText = String(date.getMonth() + 1) + "月" + date.getDate() + "日";
  return (
    dateText +
    " " +
    String(date.getHours()).padStart(2, "0") +
    ":" +
    String(date.getMinutes()).padStart(2, "0")
  );
}

function TaskEditor({
  task,
  busy,
  onCancel,
  onSave,
}: {
  readonly task: PersonalTask | null;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onSave: (draft: PersonalTaskDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<PersonalTaskDraft>(task ? draftFromTask(task) : EMPTY_DRAFT);
  const [errors, setErrors] = useState<PersonalTaskDraftErrors>({});
  const update = <K extends keyof PersonalTaskDraft>(field: K, value: PersonalTaskDraft[K]) =>
    setDraft((current) => ({ ...current, [field]: value }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validatePersonalTaskDraft(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) void onSave(draft);
  }

  return (
    <div className="workspace-task-backdrop">
      <section
        className="workspace-task-dialog workspace-task-dialog--editor"
        role="dialog"
        aria-modal="true"
        aria-label={task ? "编辑个人任务" : "新建个人任务"}
      >
        <header>
          <h3>{task ? "编辑个人任务" : "新建个人任务"}</h3>
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
              onChange={(event) => update("title", event.currentTarget.value)}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? "personal-task-title-error" : undefined}
            />
          </label>
          {errors.title && (
            <p id="personal-task-title-error" className="workspace-task-error">
              {errors.title}
            </p>
          )}
          <label>
            描述
            <textarea
              rows={3}
              maxLength={5000}
              value={draft.description}
              onChange={(event) => update("description", event.currentTarget.value)}
              aria-invalid={Boolean(errors.description)}
            />
          </label>
          {errors.description && <p className="workspace-task-error">{errors.description}</p>}
          <label>
            优先级
            <select
              value={draft.priority}
              onChange={(event) =>
                update("priority", event.currentTarget.value as PersonalTaskPriority)
              }
            >
              <option value="none">无</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </label>
          <div className="workspace-task-deadline-fields">
            <div className="workspace-task-date-field">
              <span>截止日期</span>
              <ChineseDateInput
                value={draft.deadlineDate}
                onChange={(value) => update("deadlineDate", value)}
                ariaLabel="截止日期"
                ariaInvalid={Boolean(errors.deadlineDate)}
              />
            </div>
            <label>
              截止时间
              <input
                type="time"
                lang="zh-CN"
                value={draft.deadlineTime}
                onChange={(event) => update("deadlineTime", event.currentTarget.value)}
                aria-invalid={Boolean(errors.deadlineTime)}
              />
            </label>
          </div>
          {(errors.deadlineDate || errors.deadlineTime) && (
            <p className="workspace-task-error" role="alert">
              {errors.deadlineDate ?? errors.deadlineTime}
            </p>
          )}
          <p className="workspace-task-hint">
            截止日期和时间均可留空；设置时间时必须同时选择日期。
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

export function WorkspaceTasksPage({
  termConfig,
  onNavigate,
  onScheduleTask,
  initialTaskId,
}: WorkspaceTasksPageProps) {
  const [personalTasks, setPersonalTasks] = useState<readonly PersonalTask[]>([]);
  const [academicTasks, setAcademicTasks] = useState<readonly AcademicTask[]>([]);
  const [tab, setTab] = useState<TaskTab>("open");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<PersonalTask | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<PersonalTask | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const today =
    String(now.getFullYear()) +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0");
  const nowTime =
    String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const fallbackSemesterId = termConfig ? "legacy-active-semester" : undefined;
    void Promise.allSettled([
      loadPersonalTasks(),
      loadAcademicHubData({ fallbackSemesterId }),
    ]).then(([personalResult, academicResult]) => {
      if (!active) return;
      if (personalResult.status === "fulfilled") setPersonalTasks(personalResult.value);
      if (academicResult.status === "fulfilled") setAcademicTasks(academicResult.value.tasks);
      const failures = [personalResult, academicResult].flatMap((result) =>
        result.status === "rejected"
          ? [result.reason instanceof Error ? result.reason.message : "读取任务失败"]
          : [],
      );
      setError(failures.join(" "));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [refresh, termConfig]);

  useEffect(() => {
    const target = personalTasks.find((task) => task.id === initialTaskId);
    if (target) setTab(target.status === "completed" ? "completed" : "open");
  }, [initialTaskId, personalTasks]);

  const visiblePersonalTasks = useMemo(
    () =>
      sortPersonalTasks(
        personalTasks.filter((task) => task.status === tab),
        today,
        nowTime,
      ),
    [nowTime, personalTasks, tab, today],
  );
  const visibleAcademicTasks = useMemo(
    () =>
      academicTasks
        .filter((task) =>
          tab === "open" ? task.status !== "COMPLETED" : task.status === "COMPLETED",
        )
        .slice()
        .sort(
          (left, right) => left.dueAt.localeCompare(right.dueAt) || left.id.localeCompare(right.id),
        ),
    [academicTasks, tab],
  );

  useEffect(() => {
    if (!initialTaskId || !visiblePersonalTasks.some((task) => task.id === initialTaskId)) return;
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-personal-task-id="${CSS.escape(initialTaskId)}"]`)
        ?.scrollIntoView({ block: "center" });
    });
  }, [initialTaskId, visiblePersonalTasks]);

  async function saveTask(draft: PersonalTaskDraft) {
    setBusy(true);
    setError("");
    try {
      const saved = editor
        ? await updatePersonalTask(editor, draft)
        : await createPersonalTask(draft);
      setPersonalTasks((current) =>
        editor ? current.map((task) => (task.id === saved.id ? saved : task)) : [...current, saved],
      );
      setEditor(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存个人任务失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function toggleCompletion(task: PersonalTask) {
    setBusyTaskId(task.id);
    setError("");
    try {
      const updated = await setPersonalTaskCompleted(task.id, task.status !== "completed");
      setPersonalTasks((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "更新个人任务状态失败。");
    } finally {
      setBusyTaskId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    setError("");
    try {
      await deletePersonalTask(deleteTarget.id);
      setPersonalTasks((current) => current.filter((task) => task.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除个人任务失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="workspace-tasks-page" data-testid="workspace-tasks">
      <header className="workspace-tasks-heading">
        <div>
          <p className="workspace-tasks-eyebrow">工作台</p>
          <h2>任务</h2>
          <p>个人任务可在此管理；学业事项保留在课表模块中。</p>
        </div>
        <button
          type="button"
          className="workspace-task-button workspace-task-button--primary"
          onClick={() => setEditor(null)}
        >
          新建任务
        </button>
      </header>
      <nav className="workspace-task-tabs" aria-label="任务状态">
        <button type="button" aria-pressed={tab === "open"} onClick={() => setTab("open")}>
          未完成{" "}
          <span>
            {personalTasks.filter((task) => task.status === "open").length +
              academicTasks.filter((task) => task.status !== "COMPLETED").length}
          </span>
        </button>
        <button
          type="button"
          aria-pressed={tab === "completed"}
          onClick={() => setTab("completed")}
        >
          已完成{" "}
          <span>
            {personalTasks.filter((task) => task.status === "completed").length +
              academicTasks.filter((task) => task.status === "COMPLETED").length}
          </span>
        </button>
      </nav>
      {error && (
        <p className="workspace-tasks-message" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="workspace-tasks-message" role="status">
          正在读取任务…
        </p>
      ) : (
        <div className="workspace-personal-task-list">
          {visiblePersonalTasks.map((task) => (
            <article
              className="workspace-task-row"
              key={"personal:" + task.id}
              data-personal-task-id={task.id}
            >
              <button
                type="button"
                className="workspace-task-complete"
                aria-label={
                  task.status === "completed" ? "重新打开" + task.title : "完成" + task.title
                }
                disabled={busyTaskId === task.id}
                onClick={() => void toggleCompletion(task)}
              >
                {task.status === "completed" ? "✓" : "○"}
              </button>
              <div className="workspace-task-row-main">
                <div className="workspace-task-row-title">
                  <strong>{task.title}</strong>
                  <span className="workspace-task-source">个人</span>
                  {task.priority !== "none" && (
                    <span className="workspace-task-priority">{priorityLabel(task.priority)}</span>
                  )}
                </div>
                {task.description && (
                  <p className="workspace-task-description">{task.description}</p>
                )}
                <span
                  className={
                    "workspace-personal-task-deadline workspace-personal-task-deadline--" +
                    (personalTaskDeadlineKind(task, today, nowTime) === "overdue"
                      ? "overdue"
                      : "normal")
                  }
                >
                  {personalTaskDeadlineLabel(task, today, nowTime)}
                </span>
              </div>
              <div className="workspace-task-row-actions">
                <button type="button" onClick={() => onScheduleTask(task.id)}>
                  安排时间
                </button>
                <button type="button" onClick={() => setEditor(task)}>
                  编辑
                </button>
                <button type="button" onClick={() => setDeleteTarget(task)}>
                  删除
                </button>
              </div>
            </article>
          ))}
          {visibleAcademicTasks.map((task) => (
            <article
              className="workspace-task-row workspace-task-row--academic"
              key={"academic:" + task.id}
            >
              <span
                className="workspace-task-complete workspace-task-complete--readonly"
                aria-hidden="true"
              >
                {task.status === "COMPLETED" ? "✓" : "·"}
              </span>
              <div className="workspace-task-row-main">
                <div className="workspace-task-row-title">
                  <strong>{task.title}</strong>
                  <span className="workspace-task-source">学业</span>
                </div>
                <span className="workspace-personal-task-deadline">{academicDeadline(task)}</span>
              </div>
              <button
                type="button"
                className="workspace-task-academic-link"
                onClick={() => onNavigate({ area: "academic", page: "tasks-legacy" })}
              >
                在课表中管理
              </button>
            </article>
          ))}
          {visiblePersonalTasks.length + visibleAcademicTasks.length === 0 && (
            <p className="workspace-task-empty">
              {tab === "open" ? "暂无未完成任务。" : "暂无已完成任务。"}
            </p>
          )}
        </div>
      )}
      <button
        type="button"
        className="workspace-task-retry"
        onClick={() => setRefresh((value) => value + 1)}
      >
        刷新任务
      </button>
      {editor !== undefined && (
        <TaskEditor
          key={editor?.id ?? "new-task"}
          task={editor}
          busy={busy}
          onCancel={() => setEditor(undefined)}
          onSave={saveTask}
        />
      )}
      {deleteTarget && (
        <div className="workspace-task-backdrop">
          <section
            className="workspace-task-dialog workspace-task-dialog--delete"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-personal-task-title"
          >
            <h3 id="delete-personal-task-title">删除个人任务？</h3>
            <p>删除“{deleteTarget.title}”后，关联的时间块也会同时删除。</p>
            <footer>
              <button
                type="button"
                className="workspace-task-button workspace-task-button--secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={busy}
              >
                取消
              </button>
              <button
                type="button"
                className="workspace-task-button workspace-task-button--danger"
                onClick={() => void confirmDelete()}
                disabled={busy}
              >
                {busy ? "正在删除…" : "确认删除"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}

function priorityLabel(priority: PersonalTaskPriority): string {
  if (priority === "high") return "高优先级";
  if (priority === "medium") return "中优先级";
  return "低优先级";
}
