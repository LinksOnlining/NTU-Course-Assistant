import { useCallback, useEffect, useRef, useState } from "react";
import { localDateKey } from "../../application/workspace/index.ts";
import type { AppRoute } from "../../navigation/types.ts";
import type { DiaryEntry } from "../../types/diary.ts";
import {
  loadDiaryContentDates,
  loadDiaryEntry,
  saveDiaryEntry,
} from "../../services/diary-storage.ts";
import { DiaryAutosave, type DiarySaveState } from "./diary-autosave.ts";
import "./workspace-diary.css";

interface WorkspaceDiaryPageProps {
  readonly onNavigate: (route: AppRoute) => void;
  readonly registerFlush: (flush: () => Promise<boolean>) => () => void;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDateKey(value);
}

function formatDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function createAutosave(onState: (state: DiarySaveState) => void): DiaryAutosave {
  return new DiaryAutosave(saveDiaryEntry, onState);
}

export function WorkspaceDiaryPage({ onNavigate, registerFlush }: WorkspaceDiaryPageProps) {
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()));
  const [body, setBody] = useState("");
  const [entry, setEntry] = useState<DiaryEntry | null>(null);
  const [recentDates, setRecentDates] = useState<readonly string[]>([]);
  const [saveState, setSaveState] = useState<DiarySaveState>("idle");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [switching, setSwitching] = useState(false);
  const autosaveRef = useRef<DiaryAutosave | null>(null);
  const switchLock = useRef(false);

  const updateSaveState = useCallback((state: DiarySaveState) => {
    setSaveState(state);
    if (state === "saved") {
      void loadDiaryContentDates()
        .then(setRecentDates)
        .catch(() => {});
    }
  }, []);

  const loadDate = useCallback(
    async (date: string) => {
      setLoading(true);
      setLoadError("");
      try {
        const [loaded, dates] = await Promise.all([loadDiaryEntry(date), loadDiaryContentDates()]);
        setSelectedDate(date);
        setEntry(loaded);
        setBody(loaded?.body ?? "");
        setRecentDates(dates);
        const autosave = createAutosave(updateSaveState);
        autosave.hydrate(date, loaded);
        autosaveRef.current = autosave;
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "无法读取这一天的日记。");
      } finally {
        setLoading(false);
      }
    },
    [updateSaveState],
  );

  useEffect(() => {
    void loadDate(selectedDate);
    // Initial date is loaded once; subsequent changes use the guarded switch below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () =>
      registerFlush(async () => {
        const saved = await (autosaveRef.current?.flush() ?? Promise.resolve(true));
        if (!saved) setSaveState("failed");
        return saved;
      }),
    [registerFlush],
  );

  async function changeDate(date: string) {
    if (switchLock.current || date === selectedDate || loading) return;
    switchLock.current = true;
    setSwitching(true);
    try {
      const saved = await (autosaveRef.current?.flush() ?? Promise.resolve(true));
      if (!saved) {
        setSaveState("failed");
        return;
      }
      await loadDate(date);
    } finally {
      switchLock.current = false;
      setSwitching(false);
    }
  }

  function statusText(): string {
    switch (saveState) {
      case "pending":
        return "待保存…";
      case "saving":
        return "正在保存…";
      case "saved":
        return "已保存";
      case "failed":
        return "保存失败";
      default:
        return entry ? "已保存" : "尚未记录";
    }
  }

  return (
    <section className="workspace-diary-page" aria-labelledby="workspace-diary-title">
      <header className="workspace-diary-heading">
        <div>
          <button
            type="button"
            className="workspace-diary-breadcrumb"
            onClick={() => onNavigate({ area: "workspace", page: "home" })}
          >
            工作台 <span aria-hidden="true">›</span> 日记
          </button>
          <h2 id="workspace-diary-title">日记</h2>
          <p>仅保存在本机，不会发送到网络或进入日志。</p>
        </div>
        <div className="workspace-diary-status" role={saveState === "failed" ? "alert" : "status"}>
          <span>{statusText()}</span>
          {saveState === "failed" && (
            <button type="button" onClick={() => void autosaveRef.current?.flush()}>
              重试保存
            </button>
          )}
        </div>
      </header>

      <div className="workspace-diary-layout">
        <aside className="workspace-diary-dates" aria-label="日记日期导航">
          <h3>日期</h3>
          <div className="workspace-diary-date-actions">
            <button
              type="button"
              onClick={() => void changeDate(shiftDate(selectedDate, -1))}
              disabled={loading || switching}
              aria-label="前一天"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => void changeDate(localDateKey(new Date()))}
              disabled={loading || switching || selectedDate === localDateKey(new Date())}
            >
              今天
            </button>
            <button
              type="button"
              onClick={() => void changeDate(shiftDate(selectedDate, 1))}
              disabled={loading || switching}
              aria-label="后一天"
            >
              →
            </button>
          </div>
          <h4>近期记录</h4>
          {recentDates.length === 0 ? (
            <p className="workspace-diary-empty-dates">还没有其他记录日期</p>
          ) : (
            <ul>
              {recentDates.map((date) => (
                <li key={date}>
                  <button
                    type="button"
                    aria-current={date === selectedDate ? "date" : undefined}
                    onClick={() => void changeDate(date)}
                    disabled={loading || switching || date === selectedDate}
                  >
                    {date}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="workspace-diary-editor" aria-label="日记编辑器">
          <div className="workspace-diary-editor-heading">
            <h3>{formatDate(selectedDate)}</h3>
            <span>{selectedDate}</span>
          </div>
          {loadError ? (
            <div className="workspace-diary-load-error" role="alert">
              <p>{loadError}</p>
              <button type="button" onClick={() => void loadDate(selectedDate)}>
                重新加载
              </button>
            </div>
          ) : (
            <textarea
              aria-label={`${selectedDate} 日记正文`}
              placeholder="写下今天想记住的事情…"
              value={body}
              disabled={loading || switching}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setBody(value);
                autosaveRef.current?.schedule(selectedDate, value);
              }}
              onBlur={() => void autosaveRef.current?.flush()}
              spellCheck
            />
          )}
          {loading && (
            <p className="workspace-diary-loading" role="status">
              正在读取日记…
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
