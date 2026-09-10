import { useState } from "react";
import { validatePeriodTimes } from "../core/period-time.ts";
import { minutesToTime, timeToMinutes } from "../core/time.ts";
import type { PeriodTime } from "../types/time.ts";

interface PeriodSettingsProps {
  readonly periods: readonly PeriodTime[];
  readonly isUsingTestSchedule: boolean;
  readonly onSave: (periods: readonly PeriodTime[]) => Promise<void>;
  readonly onCancel: () => void;
}

export function PeriodSettings({
  periods,
  isUsingTestSchedule,
  onSave,
  onCancel,
}: PeriodSettingsProps) {
  const [draft, setDraft] = useState<PeriodTime[]>(() => periods.map((period) => ({ ...period })));
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  function update(index: number, field: "startTime" | "endTime", value: string) {
    setDraft((current) =>
      current.map((period, periodIndex) =>
        periodIndex === index ? { ...period, [field]: value } : period,
      ),
    );
    setError("");
  }

  function addPeriod() {
    if (draft.length >= 30) {
      setError("最多只能配置 30 节课");
      return;
    }
    const last = draft[draft.length - 1];
    let startTime = "08:00";
    let endTime = "08:45";
    if (last) {
      startTime = last.endTime;
      try {
        const end = timeToMinutes(startTime) + 45;
        endTime = end <= 1439 ? minutesToTime(end) : "23:59";
      } catch {
        endTime = "23:59";
      }
    }
    setDraft((current) => [...current, { period: current.length + 1, startTime, endTime }]);
    setError("");
  }

  function removeLastPeriod() {
    if (draft.length <= 1) {
      setError("至少保留一节课");
      return;
    }
    setDraft((current) => current.slice(0, -1));
    setError("");
  }

  async function save() {
    try {
      validatePeriodTimes(draft);
      setIsSaving(true);
      await onSave(draft);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "保存作息失败，请稍后重试。");
      setIsSaving(false);
    }
  }

  return (
    <div className="course-form-backdrop period-settings-backdrop" role="presentation">
      <section
        className="course-form-dialog period-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="period-settings-title"
        data-testid="period-settings"
      >
        <div className="course-form-heading">
          <div>
            <h2 id="period-settings-title">作息时间</h2>
            <p className="period-settings-note">
              {isUsingTestSchedule
                ? "当前使用测试作息，请设置并保存你的实际作息时间。"
                : "修改后只影响时间轴和后续节次映射，不会改动已有课程时间。"}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onCancel}
            aria-label="关闭作息设置"
          >
            ×
          </button>
        </div>
        <div className="period-settings-list">
          {draft.map((period, index) => (
            <div className="period-settings-row" data-testid="period-row" key={period.period}>
              <strong>第{period.period}节</strong>
              <label>
                <span className="visually-hidden">第{period.period}节开始时间</span>
                <input
                  type="time"
                  value={period.startTime}
                  onChange={(event) => update(index, "startTime", event.target.value)}
                  aria-label={`第${period.period}节开始时间`}
                />
              </label>
              <span aria-hidden="true">—</span>
              <label>
                <span className="visually-hidden">第{period.period}节结束时间</span>
                <input
                  type="time"
                  value={period.endTime}
                  onChange={(event) => update(index, "endTime", event.target.value)}
                  aria-label={`第${period.period}节结束时间`}
                />
              </label>
            </div>
          ))}
        </div>
        <div className="period-settings-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={addPeriod}
            disabled={isSaving}
          >
            ＋ 添加节次
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={removeLastPeriod}
            disabled={isSaving || draft.length <= 1}
          >
            删除最后一节
          </button>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onCancel} disabled={isSaving}>
            取消
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void save()}
            disabled={isSaving}
          >
            {isSaving ? "保存中…" : "保存作息"}
          </button>
        </div>
      </section>
    </div>
  );
}
