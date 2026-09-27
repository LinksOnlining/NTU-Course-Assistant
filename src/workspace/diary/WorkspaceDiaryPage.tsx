import { useCallback, useEffect, useRef, useState } from "react";
import { localDateKey } from "../../application/workspace/index.ts";
import {
  loadDiaryContentDates,
  loadDiaryEntry,
  saveDiaryEntry,
} from "../../application/diary/diary.ts";
import type { AppRoute } from "../../navigation/types.ts";
import type { DiaryEntry } from "../../types/diary.ts";
import type { DiaryReflectionResult } from "../../application/ai/sensitive-workflows.ts";
import { AiSensitiveConsent } from "../ai/AiSensitiveConsent.tsx";
import { sensitiveAiService } from "../ai/sensitive-ai-service.ts";
import { DiaryAutosave, type DiarySaveState } from "./diary-autosave.ts";
import "./workspace-diary.css";

interface WorkspaceDiaryPageProps {
  readonly onNavigate: (route: AppRoute) => void;
  readonly registerFlush: (flush: () => Promise<boolean>) => () => void;
  readonly initialDate?: string;
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

export function WorkspaceDiaryPage({
  onNavigate,
  registerFlush,
  initialDate,
}: WorkspaceDiaryPageProps) {
  const [selectedDate, setSelectedDate] = useState(() => initialDate ?? localDateKey(new Date()));
  const [body, setBody] = useState("");
  const [entry, setEntry] = useState<DiaryEntry | null>(null);
  const [recentDates, setRecentDates] = useState<readonly string[]>([]);
  const [saveState, setSaveState] = useState<DiarySaveState>("idle");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [switching, setSwitching] = useState(false);
  const [aiConsentDate, setAiConsentDate] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiResult, setAiResult] = useState<DiaryReflectionResult | null>(null);
  const autosaveRef = useRef<DiaryAutosave | null>(null);
  const switchLock = useRef(false);
  const aiLock = useRef(false);
  const aiContentRevision = useRef(0);

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
      aiContentRevision.current += 1;
      setLoading(true);
      setLoadError("");
      setAiConsentDate(null);
      setAiResult(null);
      setAiError("");
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

  async function requestDiaryAi() {
    if (aiLock.current || aiBusy || !body.trim()) return;
    aiLock.current = true;
    const contentRevision = aiContentRevision.current;
    setAiError("");
    try {
      if (!(await sensitiveAiService.isConfigured())) {
        if (contentRevision === aiContentRevision.current) {
          setAiError("请先在设置中配置 DeepSeek，之后再发起本次日记整理。");
        }
        return;
      }
      if (contentRevision === aiContentRevision.current) setAiConsentDate(selectedDate);
    } finally {
      aiLock.current = false;
    }
  }

  async function allowDiaryAiOnce() {
    const date = aiConsentDate;
    if (!date || aiLock.current || aiBusy) return;
    aiLock.current = true;
    const contentRevision = aiContentRevision.current;
    setAiConsentDate(null);
    setAiBusy(true);
    setAiResult(null);
    setAiError("");
    try {
      if (!(await (autosaveRef.current?.flush() ?? Promise.resolve(true)))) {
        setAiError("日记尚未保存成功，请先解决保存问题后重新发起并授权。");
        return;
      }
      if (contentRevision !== aiContentRevision.current) return;
      const selectedEntry = await loadDiaryEntry(date);
      if (contentRevision !== aiContentRevision.current) return;
      if (!selectedEntry?.body.trim()) {
        setAiError("当前日记为空，暂时没有可整理的内容。");
        return;
      }
      const outcome = await sensitiveAiService.reflectSelectedDiary(selectedEntry);
      if (contentRevision !== aiContentRevision.current) return;
      if (outcome.status === "ready") {
        const truncationNote = `日记正文超出本次处理上限，仅处理前 16 KiB，另省略 ${outcome.omittedBytes} 字节。`;
        const limitations = outcome.truncated
          ? [
              truncationNote,
              ...outcome.result.limitations.filter((item) => item !== truncationNote),
            ]
          : [...outcome.result.limitations];
        setAiResult({ ...outcome.result, limitations: [...new Set(limitations)].slice(0, 6) });
      } else if (outcome.status === "notConfigured") {
        setAiError("DeepSeek 当前未配置，请前往设置配置后重新发起；上一次授权不会保留。");
      } else if (outcome.status === "busy") {
        setAiError("该日记整理请求仍在处理中，请稍后再试。重新发起时会再次询问授权。");
      } else {
        setAiError(outcome.message);
      }
    } catch {
      if (contentRevision === aiContentRevision.current) {
        setAiError("本次日记整理失败；如需重试，请重新确认授权。");
      }
    } finally {
      aiLock.current = false;
      setAiBusy(false);
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
          <p>
            默认仅保存在本机；只有你明确同意 AI 整理时，才会发送当前选中的这一篇日记至 DeepSeek。
          </p>
        </div>
        <div
          className="workspace-diary-status"
          data-save-state={saveState}
          role={saveState === "failed" ? "alert" : "status"}
        >
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
            {body.trim() && (
              <button
                type="button"
                className="secondary-button workspace-diary-ai-button"
                onClick={() => void requestDiaryAi()}
                disabled={aiBusy || loading || switching}
              >
                {aiBusy ? "正在整理…" : "AI 帮我整理"}
              </button>
            )}
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
                aiContentRevision.current += 1;
                setAiResult(null);
                setAiError("");
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
          {aiError && (
            <div className="workspace-diary-ai-error" role="alert">
              <span>{aiError}</span>
              {aiError.includes("设置中配置 DeepSeek") && (
                <button
                  type="button"
                  onClick={() => onNavigate({ area: "settings", page: "main" })}
                >
                  打开设置
                </button>
              )}
            </div>
          )}
          {aiResult && (
            <section
              className="workspace-diary-ai-result"
              aria-label="日记整理结果"
              data-testid="diary-ai-result"
            >
              <h4>基于这篇日记</h4>
              <p>{aiResult.summary}</p>
              {aiResult.themes.length > 0 && (
                <ResultList title="主要主题" items={aiResult.themes} />
              )}
              {aiResult.observations.length > 0 && (
                <ResultList title="观察" items={aiResult.observations} />
              )}
              {aiResult.suggestions.length > 0 && (
                <ResultList title="温和建议" items={aiResult.suggestions} />
              )}
              {aiResult.limitations.length > 0 && (
                <ResultList title="限制" items={aiResult.limitations} />
              )}
              <p className="workspace-diary-ai-privacy">
                结果仅显示在当前页面，不会保存为 AI 历史或写回日记。
              </p>
            </section>
          )}
        </section>
      </div>
      <AiSensitiveConsent
        open={aiConsentDate !== null}
        title="允许 AI 整理本篇日记？"
        selectedDate={aiConsentDate ?? selectedDate}
        contentType="日记正文"
        onDismiss={() => setAiConsentDate(null)}
        onAllowOnce={() => void allowDiaryAiOnce()}
      />
    </section>
  );
}

function ResultList({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly string[];
}) {
  return (
    <div className="workspace-diary-ai-list">
      <h5>{title}</h5>
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
