import { useEffect, useRef, useState } from "react";
import {
  adjustPeriodSchedule,
  applyUniformPeriodDuration,
  validatePeriodTimes,
} from "../core/period-time.ts";
import {
  SHANGHAI_TIMEZONE,
  validateReminderSettings,
  validateTermConfig,
} from "../core/reminder.ts";
import { durationMinutes, minutesToTime, timeToMinutes } from "../core/time.ts";
import { loadAutostartEnabled, saveAutostartEnabled } from "../services/autostart.ts";
import { sendTestCourseNotification } from "../services/reminder-notification.ts";
import type { ReminderConfiguration, ReminderSettings, TermConfig } from "../types/reminder.ts";
import type { SaveOperationState } from "../types/save-operation.ts";
import type { PeriodTime } from "../types/time.ts";
import type { WidgetDisplayMode, WidgetSettings } from "../types/widget-settings.ts";

interface PeriodSettingsProps {
  readonly periods: readonly PeriodTime[];
  readonly isUsingTestSchedule: boolean;
  readonly reminderConfiguration: ReminderConfiguration;
  readonly widgetSettings: WidgetSettings;
  readonly courseCount: number;
  readonly onSave: (
    periods: readonly PeriodTime[],
    termConfig: TermConfig | null,
    reminderSettings: ReminderSettings,
  ) => Promise<void>;
  readonly onSaveWidgetSettings: (patch: Partial<WidgetSettings>) => Promise<WidgetSettings>;
  readonly onClearAllCourses: () => Promise<void>;
  readonly onCheckUpdates: () => void;
  readonly onCancel: () => void;
}

function isSaveOperationBusy(state: SaveOperationState): boolean {
  return state.kind === "validating" || state.kind === "saving";
}

export function PeriodSettings({
  periods,
  isUsingTestSchedule,
  reminderConfiguration,
  widgetSettings,
  courseCount,
  onSave,
  onSaveWidgetSettings,
  onClearAllCourses,
  onCheckUpdates,
  onCancel,
}: PeriodSettingsProps) {
  const [draft, setDraft] = useState<PeriodTime[]>(() => periods.map((period) => ({ ...period })));
  const draftRef = useRef(draft);
  const [timeDrafts, setTimeDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      periods.flatMap((period) => [
        [`${period.period}:startTime`, period.startTime],
        [`${period.period}:endTime`, period.endTime],
      ]),
    ),
  );
  const [uniformDuration, setUniformDuration] = useState(() =>
    periods[0] ? String(durationMinutes(periods[0])) : "45",
  );
  const [firstWeekMonday, setFirstWeekMonday] = useState(
    reminderConfiguration.termConfig?.firstWeekMonday ?? "",
  );
  const [totalWeeks, setTotalWeeks] = useState(
    String(reminderConfiguration.termConfig?.totalWeeks ?? 18),
  );
  const [remindersEnabled, setRemindersEnabled] = useState(
    reminderConfiguration.reminderSettings.enabled,
  );
  const [advanceMinutes, setAdvanceMinutes] = useState(
    String(reminderConfiguration.reminderSettings.advanceMinutes),
  );
  const [error, setError] = useState("");
  const saveStateRef = useRef<SaveOperationState>({ kind: "idle" });
  const [saveState, setSaveState] = useState<SaveOperationState>({ kind: "idle" });
  const isSaving = isSaveOperationBusy(saveState);
  const [isSendingTestReminder, setIsSendingTestReminder] = useState(false);
  const [testReminderMessage, setTestReminderMessage] = useState("");
  const [autostartEnabled, setAutostartEnabled] = useState<boolean | null>(null);
  const [autostartError, setAutostartError] = useState("");
  const [isUpdatingAutostart, setIsUpdatingAutostart] = useState(false);
  const [widgetEnabled, setWidgetEnabled] = useState(widgetSettings.enabled);
  const [widgetMode, setWidgetMode] = useState<WidgetDisplayMode>(widgetSettings.displayMode);
  const [widgetLocked, setWidgetLocked] = useState(widgetSettings.locked);
  const widgetSaveStateRef = useRef<SaveOperationState>({ kind: "idle" });
  const [widgetSaveState, setWidgetSaveState] = useState<SaveOperationState>({ kind: "idle" });
  const isSavingWidget = isSaveOperationBusy(widgetSaveState);
  const [widgetError, setWidgetError] = useState("");
  const [isConfirmingClearCourses, setIsConfirmingClearCourses] = useState(false);
  const [isClearingCourses, setIsClearingCourses] = useState(false);
  const [clearCoursesError, setClearCoursesError] = useState("");
  const [clearCoursesMessage, setClearCoursesMessage] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const enabled = await loadAutostartEnabled();
        if (active) {
          setAutostartEnabled(enabled);
          setAutostartError("");
        }
      } catch (caught: unknown) {
        if (active) {
          setAutostartError(
            caught instanceof Error
              ? caught.message
              : "无法读取 Windows 登录启动状态，请稍后重试。",
          );
        }
      }
    };
    void refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, []);

  function commitDraft(next: readonly PeriodTime[]) {
    const canonicalDraft = [...next];
    draftRef.current = canonicalDraft;
    setDraft(canonicalDraft);
    setTimeDrafts(
      Object.fromEntries(
        canonicalDraft.flatMap((period) => [
          [`${period.period}:startTime`, period.startTime],
          [`${period.period}:endTime`, period.endTime],
        ]),
      ),
    );
  }

  function update(index: number, field: "startTime" | "endTime", value: string) {
    const period = draftRef.current[index];
    if (!period) return;
    setTimeDrafts((current) => ({ ...current, [`${period.period}:${field}`]: value }));
    try {
      timeToMinutes(value);
      commitDraft(adjustPeriodSchedule(draftRef.current, index, { [field]: value }));
      setError("");
    } catch (caught: unknown) {
      if (value.length === 5) {
        setError(caught instanceof Error ? caught.message : "无法调整节次时间。");
      } else {
        setError("");
      }
    }
  }

  function addPeriod() {
    if (draft.length >= 30) {
      setError("最多只能配置 30 节课");
      return;
    }
    const last = draftRef.current[draftRef.current.length - 1];
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
    commitDraft([...draftRef.current, { period: draftRef.current.length + 1, startTime, endTime }]);
    setError("");
  }

  function removeLastPeriod() {
    if (draft.length <= 1) {
      setError("至少保留一节课");
      return;
    }
    commitDraft(draftRef.current.slice(0, -1));
    setError("");
  }

  function applyDuration() {
    try {
      commitDraft(applyUniformPeriodDuration(draftRef.current, Number(uniformDuration)));
      setError("");
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "无法应用单节课时长。");
    }
  }

  async function save() {
    if (isSaveOperationBusy(saveStateRef.current)) return;
    saveStateRef.current = { kind: "validating" };
    setSaveState(saveStateRef.current);
    setError("");
    try {
      if (
        draft.some(
          (period) =>
            timeDrafts[`${period.period}:startTime`] !== period.startTime ||
            timeDrafts[`${period.period}:endTime`] !== period.endTime,
        )
      ) {
        throw new RangeError("请先完成每个节次的 HH:mm 时间输入。");
      }
      validatePeriodTimes(draft);
      const reminderSettings = validateReminderSettings({
        enabled: remindersEnabled,
        advanceMinutes: Number(advanceMinutes),
      });
      const termConfig = firstWeekMonday
        ? validateTermConfig({
            firstWeekMonday,
            totalWeeks: Number(totalWeeks),
            timezone: SHANGHAI_TIMEZONE,
          })
        : null;
      if (reminderSettings.enabled && termConfig === null) {
        throw new RangeError("启用提醒前请设置第 1 教学周的星期一");
      }
      saveStateRef.current = { kind: "saving" };
      setSaveState(saveStateRef.current);
      await onSave(draft, termConfig, reminderSettings);
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : "保存作息失败，请稍后重试。";
      setError(message);
      saveStateRef.current = { kind: "error", message };
      setSaveState(saveStateRef.current);
    } finally {
      if (saveStateRef.current.kind !== "error") {
        saveStateRef.current = { kind: "idle" };
        setSaveState(saveStateRef.current);
      }
    }
  }

  async function sendTestReminder() {
    setIsSendingTestReminder(true);
    setTestReminderMessage("");
    try {
      await sendTestCourseNotification();
      setTestReminderMessage("已请求 Windows 显示测试提醒，请查看通知中心。");
    } catch (caught: unknown) {
      setTestReminderMessage(
        caught instanceof Error ? caught.message : "无法发送测试提醒，请稍后重试。",
      );
    } finally {
      setIsSendingTestReminder(false);
    }
  }

  async function updateAutostart(enabled: boolean) {
    const previous = autostartEnabled;
    setIsUpdatingAutostart(true);
    setAutostartError("");
    try {
      const actual = await saveAutostartEnabled(enabled);
      setAutostartEnabled(actual);
      if (actual !== enabled) {
        setAutostartError(
          enabled ? "系统未确认已开启登录后自动启动。" : "系统未确认已关闭登录后自动启动。",
        );
      }
    } catch (caught: unknown) {
      try {
        setAutostartEnabled(await loadAutostartEnabled());
      } catch {
        setAutostartEnabled(previous);
      }
      setAutostartError(
        caught instanceof Error ? caught.message : "无法更新 Windows 登录启动状态，请稍后重试。",
      );
    } finally {
      setIsUpdatingAutostart(false);
    }
  }

  async function clearAllCourses() {
    setIsClearingCourses(true);
    setClearCoursesError("");
    setClearCoursesMessage("");
    try {
      await onClearAllCourses();
      setIsConfirmingClearCourses(false);
      setClearCoursesMessage("全部课程已清空；作息、学期、提醒和小组件设置均未修改。");
    } catch (caught: unknown) {
      setClearCoursesError(
        caught instanceof Error ? caught.message : "清空全部课程失败，当前课程未被修改。",
      );
    } finally {
      setIsClearingCourses(false);
    }
  }
  async function saveWidget() {
    if (isSaveOperationBusy(widgetSaveStateRef.current)) return;
    widgetSaveStateRef.current = { kind: "validating" };
    setWidgetSaveState(widgetSaveStateRef.current);
    setWidgetError("");
    try {
      widgetSaveStateRef.current = { kind: "saving" };
      setWidgetSaveState(widgetSaveStateRef.current);
      const saved = await onSaveWidgetSettings({
        enabled: widgetEnabled,
        displayMode: widgetMode,
        locked: widgetLocked,
      });
      setWidgetEnabled(saved.enabled);
      setWidgetMode(saved.displayMode);
      setWidgetLocked(saved.locked);
      widgetSaveStateRef.current = { kind: "success" };
      setWidgetSaveState(widgetSaveStateRef.current);
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : "保存小组件设置失败，请稍后重试。";
      setWidgetError(message);
      widgetSaveStateRef.current = { kind: "error", message };
      setWidgetSaveState(widgetSaveStateRef.current);
    } finally {
      if (widgetSaveStateRef.current.kind !== "error") {
        widgetSaveStateRef.current = { kind: "idle" };
        setWidgetSaveState(widgetSaveStateRef.current);
      }
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
                ? "请设置并保存你的实际作息时间。"
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
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  pattern="[0-2][0-9]:[0-5][0-9]"
                  value={timeDrafts[`${period.period}:startTime`] ?? period.startTime}
                  onChange={(event) => update(index, "startTime", event.target.value)}
                  aria-label={`第${period.period}节开始时间`}
                />
              </label>
              <span aria-hidden="true">—</span>
              <label>
                <span className="visually-hidden">第{period.period}节结束时间</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  pattern="[0-2][0-9]:[0-5][0-9]"
                  value={timeDrafts[`${period.period}:endTime`] ?? period.endTime}
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
        <section className="settings-section" aria-labelledby="period-duration-title">
          <div>
            <h3 id="period-duration-title">单节课时长</h3>
            <p>应用后仅更新当前预览；保存作息后才会写入本地数据。</p>
          </div>
          <div className="settings-fields">
            <label>
              <span>分钟</span>
              <input
                type="number"
                min="20"
                max="120"
                step="1"
                value={uniformDuration}
                onChange={(event) => setUniformDuration(event.target.value)}
                aria-label="单节课时长分钟"
              />
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={applyDuration}
              disabled={isSaving}
            >
              应用到全部节次
            </button>
          </div>
        </section>
        <section className="settings-section" aria-labelledby="reminder-settings-title">
          <div>
            <h3 id="reminder-settings-title">学期与课程提醒</h3>
            <p>运行中的应用会在到期时发送 Windows 系统通知；可先发送测试提醒确认系统设置。</p>
          </div>
          <div className="settings-fields">
            <label>
              <span>第 1 教学周星期一</span>
              <input
                type="date"
                value={firstWeekMonday}
                onChange={(event) => setFirstWeekMonday(event.target.value)}
                aria-label="第 1 教学周星期一"
              />
            </label>
            <label>
              <span>总教学周数</span>
              <input
                type="number"
                min="1"
                max="30"
                value={totalWeeks}
                onChange={(event) => setTotalWeeks(event.target.value)}
                aria-label="总教学周数"
              />
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={remindersEnabled}
                onChange={(event) => setRemindersEnabled(event.target.checked)}
                aria-label="启用课程提醒"
              />
              <span>启用课程提醒</span>
            </label>
            <label>
              <span>提前提醒分钟</span>
              <input
                type="number"
                min="0"
                max="180"
                value={advanceMinutes}
                onChange={(event) => setAdvanceMinutes(event.target.value)}
                disabled={!remindersEnabled}
                aria-label="提前提醒分钟"
              />
            </label>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void sendTestReminder()}
            disabled={isSendingTestReminder}
          >
            {isSendingTestReminder ? "发送中…" : "发送测试提醒"}
          </button>
          {testReminderMessage && (
            <p className="form-message" role="status">
              {testReminderMessage}
            </p>
          )}
        </section>
        <section className="settings-section" aria-labelledby="autostart-settings-title">
          <div>
            <h3 id="autostart-settings-title">启动设置</h3>
            <p>登录 Windows 后自动启动应用。默认关闭，可随时修改。</p>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={autostartEnabled ?? false}
              disabled={autostartEnabled === null || isUpdatingAutostart}
              onChange={(event) => void updateAutostart(event.target.checked)}
              aria-label="登录 Windows 后自动启动应用"
            />
            <span>
              {autostartEnabled === null ? "正在读取启动状态…" : "登录 Windows 后自动启动应用"}
            </span>
          </label>
          {autostartError && (
            <p className="form-error" role="alert">
              {autostartError}
            </p>
          )}
        </section>
        <section className="settings-section" aria-labelledby="widget-settings-title">
          <div>
            <h3 id="widget-settings-title">桌面课程小组件</h3>
            <p>默认关闭；显示模式和锁定状态会在下次打开时恢复。</p>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={widgetEnabled}
              disabled={isSavingWidget}
              onChange={(event) => setWidgetEnabled(event.target.checked)}
              aria-label="启用桌面课程小组件"
            />
            <span>启用桌面课程小组件</span>
          </label>
          <div className="settings-fields">
            <label>
              <span>显示</span>
              <select
                value={widgetMode}
                disabled={isSavingWidget}
                onChange={(event) => setWidgetMode(event.target.value as WidgetDisplayMode)}
                aria-label="小组件显示模式"
              >
                <option value="today">今日</option>
                <option value="week">本周</option>
                <option value="next">下一节</option>
                <option value="deadlines">Deadline</option>
              </select>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={widgetLocked}
                disabled={isSavingWidget}
                onChange={(event) => setWidgetLocked(event.target.checked)}
                aria-label="锁定小组件位置"
              />
              <span>锁定位置</span>
            </label>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void saveWidget()}
            disabled={isSavingWidget}
          >
            {isSavingWidget ? "保存中…" : "保存小组件设置"}
          </button>
          {widgetError && (
            <p className="form-error" role="alert">
              {widgetError}
            </p>
          )}
        </section>
        <section className="settings-section" aria-labelledby="course-data-settings-title">
          <div>
            <h3 id="course-data-settings-title">课表数据</h3>
            <p>清空只会删除课程，不会修改作息、学期、提醒、小组件或其他应用偏好。</p>
          </div>
          <button
            type="button"
            className="danger-button"
            onClick={() => {
              setClearCoursesError("");
              setClearCoursesMessage("");
              setIsConfirmingClearCourses(true);
            }}
            disabled={courseCount === 0 || isClearingCourses}
          >
            清空全部课程
          </button>
          {clearCoursesMessage && (
            <p className="form-message" role="status">
              {clearCoursesMessage}
            </p>
          )}
          {isConfirmingClearCourses && (
            <div className="delete-confirmation" role="alertdialog" aria-label="清空全部课程确认">
              <p>
                确定清空全部 {courseCount}{" "}
                门课程吗？此操作不会删除作息、学期、提醒、小组件设置或其他应用偏好。
              </p>
              {clearCoursesError && <p className="form-error">{clearCoursesError}</p>}
              <div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setIsConfirmingClearCourses(false)}
                  disabled={isClearingCourses}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="danger-button danger-button--confirm"
                  onClick={() => void clearAllCourses()}
                  disabled={isClearingCourses}
                >
                  {isClearingCourses ? "正在清空…" : "确认清空"}
                </button>
              </div>
            </div>
          )}
        </section>
        <section className="settings-section" aria-labelledby="about-settings-title">
          <div>
            <h3 id="about-settings-title">关于</h3>
            <p>NTU Course Assistant · Version v{__APP_VERSION__}</p>
          </div>
          <div className="form-actions">
            <button type="button" className="secondary-button" onClick={onCheckUpdates}>
              检查更新
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                window.open(
                  "https://github.com/LinksOnlining/NTU-Course-Assistant/releases",
                  "_blank",
                )
              }
            >
              GitHub Release
            </button>
          </div>
        </section>
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
