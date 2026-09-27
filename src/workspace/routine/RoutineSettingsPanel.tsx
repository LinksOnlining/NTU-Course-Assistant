import { useEffect, useState, type FormEvent } from "react";
import {
  createRoutine,
  deleteRoutine,
  loadRoutines,
  updateRoutine,
  validateRoutineDraft,
} from "../../application/planner/routines.ts";
import type { Routine, RoutineDraft } from "../../types/routine.ts";
import "./routine-settings.css";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const;
const EMPTY_DRAFT: RoutineDraft = {
  title: "",
  targetDurationMinutes: 40,
  weekdaysMask: 0b0010101,
  preferredStartTime: null,
  preferredEndTime: null,
  enabled: true,
};

function draftFromRoutine(routine: Routine): RoutineDraft {
  return {
    title: routine.title,
    targetDurationMinutes: routine.targetDurationMinutes,
    weekdaysMask: routine.weekdaysMask,
    preferredStartTime: routine.preferredStartTime,
    preferredEndTime: routine.preferredEndTime,
    enabled: routine.enabled,
  };
}

function weekdayLabel(mask: number): string {
  return WEEKDAYS.filter((_, index) => (mask & (1 << index)) !== 0)
    .map((day) => `周${day}`)
    .join("、");
}

export function RoutineSettingsPanel() {
  const [routines, setRoutines] = useState<readonly Routine[]>([]);
  const [editing, setEditing] = useState<Routine | null>(null);
  const [draft, setDraft] = useState<RoutineDraft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void loadRoutines()
      .then((loaded) => {
        if (active) setRoutines(loaded);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "无法读取日常习惯。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function beginCreate() {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setError("");
  }

  function beginEdit(routine: Routine) {
    setEditing(routine);
    setDraft(draftFromRoutine(routine));
    setError("");
  }

  async function save(submission: FormEvent<HTMLFormElement>) {
    submission.preventDefault();
    const validation = validateRoutineDraft(draft);
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = editing ? await updateRoutine(editing, draft) : await createRoutine(draft);
      setRoutines((items) =>
        editing
          ? items.map((item) => (item.id === saved.id ? saved : item))
          : [...items, saved].sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
            ),
      );
      beginCreate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存日常习惯失败。");
    } finally {
      setBusy(false);
    }
  }

  async function remove(routine: Routine) {
    if (!window.confirm(`删除“${routine.title}”？已安排的日程不会删除。`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteRoutine(routine.id);
      setRoutines((items) => items.filter((item) => item.id !== routine.id));
      if (editing?.id === routine.id) beginCreate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "删除日常习惯失败。");
    } finally {
      setBusy(false);
    }
  }

  function toggleWeekday(index: number) {
    setDraft((current) => ({
      ...current,
      weekdaysMask: current.weekdaysMask ^ (1 << index),
    }));
  }

  function setPreferredTime(edge: "start" | "end", value: string) {
    if (!value) {
      setDraft((current) => ({
        ...current,
        preferredStartTime: null,
        preferredEndTime: null,
      }));
      return;
    }
    setDraft((current) => ({
      ...current,
      preferredStartTime: edge === "start" ? value : current.preferredStartTime,
      preferredEndTime: edge === "end" ? value : current.preferredEndTime,
    }));
  }

  return (
    <section className="routine-settings" aria-label="日常习惯管理" data-testid="routine-settings">
      <p className="settings-domain-note">
        日常习惯只提供时间建议；只有你保存日程后才会安排，不会自动创建任务。
      </p>
      {error && (
        <p className="routine-settings-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">正在读取日常习惯…</p>
      ) : (
        <ul className="routine-settings-list">
          {routines.map((routine) => (
            <li key={routine.id}>
              <div>
                <strong>{routine.title}</strong>
                <span>
                  {routine.targetDurationMinutes} 分钟 · {weekdayLabel(routine.weekdaysMask)}
                </span>
                <span>
                  {routine.preferredStartTime && routine.preferredEndTime
                    ? `${routine.preferredStartTime}–${routine.preferredEndTime}`
                    : "无偏好时间窗口"}
                </span>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={routine.enabled}
                  disabled={busy}
                  aria-label={`启用${routine.title}`}
                  onChange={(event) =>
                    void updateRoutine(routine, {
                      ...draftFromRoutine(routine),
                      enabled: event.currentTarget.checked,
                    })
                      .then((saved) =>
                        setRoutines((items) =>
                          items.map((item) => (item.id === saved.id ? saved : item)),
                        ),
                      )
                      .catch((cause: unknown) =>
                        setError(cause instanceof Error ? cause.message : "更新状态失败。"),
                      )
                  }
                />
                启用
              </label>
              <button type="button" disabled={busy} onClick={() => beginEdit(routine)}>
                编辑
              </button>
              <button type="button" disabled={busy} onClick={() => void remove(routine)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="routine-settings-form" onSubmit={(event) => void save(event)}>
        <h4>{editing ? "编辑日常习惯" : "新增日常习惯"}</h4>
        <label>
          名称
          <input
            maxLength={200}
            value={draft.title}
            onChange={(event) => {
              const title = event.currentTarget.value;
              setDraft((current) => ({ ...current, title }));
            }}
          />
        </label>
        <label>
          目标时长（分钟）
          <input
            type="number"
            min={5}
            max={720}
            step={5}
            value={draft.targetDurationMinutes}
            onChange={(event) => {
              const targetDurationMinutes = Number(event.currentTarget.value);
              setDraft((current) => ({ ...current, targetDurationMinutes }));
            }}
          />
        </label>
        <fieldset>
          <legend>适用星期</legend>
          {WEEKDAYS.map((day, index) => (
            <label key={day}>
              <input
                type="checkbox"
                checked={(draft.weekdaysMask & (1 << index)) !== 0}
                onChange={() => toggleWeekday(index)}
              />
              周{day}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>偏好时间窗口（可选）</legend>
          <label>
            开始
            <input
              type="time"
              lang="zh-CN"
              value={draft.preferredStartTime ?? ""}
              onChange={(event) => setPreferredTime("start", event.currentTarget.value)}
            />
          </label>
          <label>
            结束
            <input
              type="time"
              lang="zh-CN"
              value={draft.preferredEndTime ?? ""}
              onChange={(event) => setPreferredTime("end", event.currentTarget.value)}
            />
          </label>
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              setDraft((current) => ({ ...current, enabled }));
            }}
          />
          启用此习惯
        </label>
        <div>
          {editing && (
            <button type="button" disabled={busy} onClick={beginCreate}>
              取消编辑
            </button>
          )}
          <button type="submit" disabled={busy}>
            {busy ? "正在保存…" : editing ? "保存修改" : "新增习惯"}
          </button>
        </div>
      </form>
    </section>
  );
}
