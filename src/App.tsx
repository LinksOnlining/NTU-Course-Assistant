import { useEffect, useMemo, useRef, useState } from "react";
import { CourseForm } from "./components/CourseForm.tsx";
import { PdfImportPreview } from "./components/PdfImportPreview.tsx";
import { PeriodSettings } from "./components/PeriodSettings.tsx";
import { Timetable } from "./components/Timetable.tsx";
import { TEST_TIMETABLE } from "./config/timetable.ts";
import {
  applyImportCandidateEdit,
  evaluateImportCandidates,
  materializeImportCourses,
  prepareImportPlan,
} from "./core/import-proposal.ts";
import { getTimelineBounds } from "./core/period-time.ts";
import { courseTiming, layoutCourses } from "./core/timetable-layout.ts";
import { parseNtuPdfTimetable } from "./importers/ntu-pdf/parse.ts";
import { TEST_COURSES } from "./fixtures/courses.ts";
import { choosePdfFile, extractPdfText, PdfImportError } from "./services/pdf-import.ts";
import { subscribeReminderResume } from "./services/reminder-lifecycle.ts";
import {
  hideWidget,
  notifyWidgetDataChanged,
  notifyWidgetSettingsChanged,
  showWidget,
  subscribeWidgetSettingsChanged,
} from "./services/widget-window.ts";
import {
  deleteStoredCourse,
  importStoredCourses,
  loadHandledReminderKeys,
  insertStoredCourse,
  loadStoredCourses,
  loadStoredPeriodTimes,
  loadStoredDayCount,
  loadStoredReminderConfiguration,
  loadStoredWidgetSettings,
  refreshStoredReminderSchedule,
  saveStoredAppSettings,
  saveStoredDayCount,
  patchStoredWidgetSettings,
  updateStoredCourse,
} from "./services/course-storage.ts";
import { DEFAULT_WIDGET_SETTINGS } from "./services/widget-data.ts";
import { checkForApplicationUpdate, installApplicationUpdate } from "./services/updater.ts";
import {
  buildReminderPlans,
  DEFAULT_REMINDER_SETTINGS,
  excludeHandledReminderPlans,
  getShanghaiDate,
  getShanghaiTime,
  getShanghaiWeekday,
  getTeachingWeek,
} from "./core/reminder.ts";
import { timeToMinutes } from "./core/time.ts";
import type { Course } from "./types/course.ts";
import type { ImportCandidate, ImportCandidateEdit } from "./types/import-candidate.ts";
import type { ImportPlan } from "./types/import-proposal.ts";
import type { PdfExtraction } from "./types/pdf.ts";
import type { PeriodTime } from "./types/time.ts";
import type { ReminderConfiguration } from "./types/reminder.ts";
import type { WidgetSettings } from "./types/widget-settings.ts";

interface PdfImportResult {
  readonly inserted: number;
  readonly skippedDuplicates: number;
  readonly unselected: number;
  readonly warnings: number;
}

type PdfImportState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "reading";
      readonly fileName: string;
      readonly ocrProgress?: { readonly page: number; readonly pageCount: number };
    }
  | {
      readonly kind: "success";
      readonly document: PdfExtraction;
      readonly candidates: readonly ImportCandidate[];
    }
  | { readonly kind: "error"; readonly message: string };

export function App() {
  const showDevelopmentFixtures = import.meta.env.DEV && !("__TAURI_INTERNALS__" in window);
  const [userCourses, setUserCourses] = useState<readonly Course[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [periods, setPeriods] = useState<readonly PeriodTime[]>(TEST_TIMETABLE.periods);
  const [isPeriodSettingsOpen, setIsPeriodSettingsOpen] = useState(false);
  const [isUsingTestSchedule, setIsUsingTestSchedule] = useState(true);
  const [reminderConfiguration, setReminderConfiguration] = useState<ReminderConfiguration>({
    termConfig: null,
    reminderSettings: DEFAULT_REMINDER_SETTINGS,
  });
  const [widgetSettings, setWidgetSettings] = useState<WidgetSettings>(DEFAULT_WIDGET_SETTINGS);
  const [periodMessage, setPeriodMessage] = useState("");
  const [storageStatus, setStorageStatus] = useState<"loading" | "ready" | "error">("loading");
  const [storageMessage, setStorageMessage] = useState("");
  const [pdfImport, setPdfImport] = useState<PdfImportState>({ kind: "idle" });
  const [candidateEdits, setCandidateEdits] = useState<
    Readonly<Record<string, ImportCandidateEdit>>
  >({});
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null);
  const [pendingImportCourses, setPendingImportCourses] = useState<readonly Course[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState<PdfImportResult | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [selectedWeek, setSelectedWeek] = useState(TEST_TIMETABLE.currentWeek);
  const [dayCount, setDayCount] = useState<5 | 7>(7);
  const [scrollRequest, setScrollRequest] = useState(0);
  const [restoreNonce, setRestoreNonce] = useState(0);
  const [updateState, setUpdateState] = useState<
    "idle" | "checking" | "available" | "downloading" | "installing" | "upToDate" | "error"
  >("idle");
  const [availableUpdate, setAvailableUpdate] =
    useState<Awaited<ReturnType<typeof checkForApplicationUpdate>>>(null);
  const [updateMessage, setUpdateMessage] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<{
    downloaded: number;
    total: number | null;
  }>({ downloaded: 0, total: null });
  const timetableScrollRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);
  const widgetSettingsRevision = useRef(0);
  const fixtureCourses = showDevelopmentFixtures ? TEST_COURSES : [];
  const courses = useMemo(() => [...fixtureCourses, ...userCourses], [fixtureCourses, userCourses]);
  const axis = useMemo(() => getTimelineBounds(TEST_TIMETABLE.axis, periods), [periods]);
  const currentTeachingWeek = useMemo(() => {
    const config = reminderConfiguration.termConfig;
    return config
      ? (getTeachingWeek(getShanghaiDate(now.getTime()), config) ?? 1)
      : TEST_TIMETABLE.currentWeek;
  }, [now, reminderConfiguration.termConfig]);
  const maxTeachingWeek = reminderConfiguration.termConfig?.totalWeeks ?? 30;
  const isViewingCurrentWeek = selectedWeek === currentTeachingWeek;
  const todayWeekday = getShanghaiWeekday(getShanghaiDate(now.getTime()));
  const nowTime = getShanghaiTime(now.getTime());
  const visibleWeekdays =
    dayCount === 5 ? ([1, 2, 3, 4, 5] as const) : ([1, 2, 3, 4, 5, 6, 7] as const);
  const weekendOccurrenceCount = useMemo(
    () => layoutCourses(courses, selectedWeek, axis).slice(5).flat().length,
    [axis, courses, selectedWeek],
  );
  const userCourseIds = useMemo(
    () => new Set(userCourses.map((course) => course.id)),
    [userCourses],
  );
  const effectiveCandidates = useMemo(
    () =>
      pdfImport.kind === "success"
        ? pdfImport.candidates.map((candidate) =>
            applyImportCandidateEdit(candidate, candidateEdits[candidate.id]),
          )
        : [],
    [candidateEdits, pdfImport],
  );
  const importEvaluation = useMemo(
    () => evaluateImportCandidates(effectiveCandidates, periods, isUsingTestSchedule, userCourses),
    [effectiveCandidates, isUsingTestSchedule, periods, userCourses],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkForUpdates(false);
    }, 7000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (storageStatus !== "ready") return;
    let active = true;
    const rebuildSchedule = async () => {
      const plans = buildReminderPlans(userCourses, reminderConfiguration);
      try {
        const handled = new Set(await loadHandledReminderKeys());
        if (!active) return;
        await refreshStoredReminderSchedule(
          reminderConfiguration,
          excludeHandledReminderPlans(plans, handled),
        );
      } catch {
        if (active) await refreshStoredReminderSchedule(reminderConfiguration, plans);
      }
    };
    const resume = () => void rebuildSchedule().catch(() => undefined);
    void rebuildSchedule().catch(() => undefined);
    const unsubscribe = subscribeReminderResume(resume);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [reminderConfiguration, storageStatus, userCourses]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      loadStoredCourses(),
      loadStoredPeriodTimes(),
      loadStoredReminderConfiguration(),
      loadStoredWidgetSettings(),
      loadStoredDayCount(),
    ])
      .then(
        ([
          result,
          storedPeriods,
          storedReminderConfiguration,
          storedWidgetSettings,
          storedDayCount,
        ]) => {
          if (!active) return;
          const activePeriods = storedPeriods ?? TEST_TIMETABLE.periods;
          setPeriods(activePeriods);
          setIsUsingTestSchedule(storedPeriods === null);
          setPeriodMessage(
            storedPeriods === null
              ? "尚未确认作息时间，请在设置中保存你的实际作息。"
              : "已使用自定义作息。",
          );
          const displayAxis = getTimelineBounds(TEST_TIMETABLE.axis, activePeriods);
          const warnings = [...result.warnings, ...storedReminderConfiguration.warnings];
          setReminderConfiguration({
            termConfig: storedReminderConfiguration.termConfig,
            reminderSettings: storedReminderConfiguration.reminderSettings,
          });
          setWidgetSettings(storedWidgetSettings);
          setDayCount(storedDayCount);
          const renderableCourses = result.courses.filter((course) => {
            try {
              courseTiming(course, displayAxis);
              return true;
            } catch {
              warnings.push(`课程“${course.name}”超出当前显示范围，已跳过且未修改原数据。`);
              return false;
            }
          });
          setUserCourses(renderableCourses);
          if (restoreNonce > 0) {
            notifyWidgetDataChanged();
            notifyWidgetSettingsChanged();
          }
          setStorageMessage(warnings.join(" "));
          setStorageStatus("ready");
        },
      )
      .catch((error: unknown) => {
        if (!active) return;
        setStorageMessage(error instanceof Error ? error.message : "本地课程数据库不可用。");
        setStorageStatus("error");
      });
    return () => {
      active = false;
    };
  }, [restoreNonce]);

  useEffect(() => {
    let timeout: number | undefined;
    let interval: number | undefined;
    const refresh = () => setNow(new Date());
    timeout = window.setTimeout(
      () => {
        refresh();
        interval = window.setInterval(refresh, 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const shouldScroll =
      isViewingCurrentWeek &&
      (scrollRequest > 0 || (!initialScrollDone.current && storageStatus === "ready"));
    if (!shouldScroll) return;
    const frame = window.requestAnimationFrame(() => {
      const scroll = timetableScrollRef.current;
      if (!scroll) return;
      const target = Math.max(
        0,
        (timeToMinutes(nowTime) - timeToMinutes(axis.startTime) - 45) * TEST_TIMETABLE.pxPerMinute,
      );
      scroll.scrollTop = Math.min(target, Math.max(0, scroll.scrollHeight - scroll.clientHeight));
      initialScrollDone.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [axis.startTime, isViewingCurrentWeek, nowTime, scrollRequest, storageStatus]);

  useEffect(() => {
    return subscribeWidgetSettingsChanged(() => {
      const revision = ++widgetSettingsRevision.current;
      void loadStoredWidgetSettings()
        .then((settings) => {
          if (revision === widgetSettingsRevision.current) setWidgetSettings(settings);
        })
        .catch(() => undefined);
    });
  }, []);

  async function checkForUpdates(manual: boolean) {
    if (updateState === "checking" || updateState === "downloading" || updateState === "installing")
      return;
    setUpdateState("checking");
    setUpdateMessage("");
    try {
      const update = await checkForApplicationUpdate();
      if (!update) {
        setUpdateState(manual ? "upToDate" : "idle");
        if (manual) setUpdateMessage("当前已是最新版本。");
        return;
      }
      setAvailableUpdate(update);
      setUpdateState("available");
    } catch {
      setUpdateState(manual ? "error" : "idle");
      if (manual) setUpdateMessage("检查更新失败，你仍可以继续使用当前版本。");
    }
  }

  async function installUpdate() {
    if (!availableUpdate) return;
    setUpdateState("downloading");
    setUpdateMessage("");
    setDownloadProgress({ downloaded: 0, total: null });
    try {
      await installApplicationUpdate(availableUpdate, (downloaded, total) =>
        setDownloadProgress({ downloaded, total }),
      );
      setUpdateState("installing");
    } catch {
      setUpdateState("error");
      setUpdateMessage("更新失败，你仍可以继续使用当前版本。");
    }
  }

  async function importPdf() {
    try {
      const file = await choosePdfFile();
      if (file === null) return;
      setImportPlan(null);
      setPendingImportCourses([]);
      setImportError("");
      setImportResult(null);
      setPdfImport({ kind: "reading", fileName: file.fileName });
      const document = await extractPdfText(file, (ocrProgress) =>
        setPdfImport({ kind: "reading", fileName: file.fileName, ocrProgress }),
      );
      const candidates = parseNtuPdfTimetable(document, {
        periods,
        isUsingTestSchedule,
      });
      if (candidates.length === 0) {
        throw new PdfImportError(
          "unsupported-structure",
          "已读取 PDF 文字，但暂时无法识别该课表结构。请确认文件是否为受支持的南通大学课表格式。",
        );
      }
      setCandidateEdits({});
      setPdfImport({ kind: "success", document, candidates });
    } catch (error) {
      const message =
        error instanceof PdfImportError ? error.message : "无法读取该 PDF，请确认文件后重试。";
      setPdfImport({ kind: "error", message });
    }
  }

  function cancelPdfImport() {
    if (isImporting) return;
    setPdfImport({ kind: "idle" });
    setCandidateEdits({});
    setImportPlan(null);
    setPendingImportCourses([]);
    setImportError("");
  }

  function enterFinalImportReview() {
    if (!importEvaluation.canContinue) return;
    const proposals = importEvaluation.candidates.flatMap((entry) =>
      entry.proposal === null ? [] : [entry.proposal],
    );
    const plan = prepareImportPlan(proposals, userCourses);
    try {
      const courses = materializeImportCourses(plan, () => crypto.randomUUID());
      setImportPlan(plan);
      setPendingImportCourses(courses);
      setImportError("");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "无法准备最终导入课程。");
    }
  }

  async function confirmPdfImport() {
    if (isImporting || importPlan === null || !importEvaluation.canContinue) return;
    setIsImporting(true);
    setImportError("");
    try {
      const inserted =
        pendingImportCourses.length === 0 ? [] : await importStoredCourses(pendingImportCourses);
      if (inserted.length !== pendingImportCourses.length) {
        throw new Error("数据库返回的课程数量不一致，界面未更新，请重试。");
      }
      setUserCourses((current) => [...current, ...inserted]);
      notifyWidgetDataChanged();
      const warnings = importPlan.entries.filter((entry) => {
        if (entry.action !== "insert") return false;
        return importEvaluation.candidates
          .find((candidate) => candidate.candidate.id === entry.proposal.candidateId)
          ?.issues.some(
            (issue) => issue.severity === "warning" && issue.code !== "duplicate-course",
          );
      }).length;
      setImportResult({
        inserted: inserted.length,
        skippedDuplicates: importPlan.summary.skippedDuplicates,
        unselected: Math.max(0, importEvaluation.summary.total - importPlan.summary.total),
        warnings,
      });
      setPdfImport({ kind: "idle" });
      setCandidateEdits({});
      setImportPlan(null);
      setPendingImportCourses([]);
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "批量导入失败，未保存任何课程，请稍后重试。",
      );
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <p className="eyebrow">NTU COURSE ASSISTANT</p>
          <div className="title-row">
            <h1>大学课程表</h1>
            {showDevelopmentFixtures && <span className="prototype-badge">开发预览</span>}
          </div>
          <p className="subtitle">本周课表已上线，早七点五十人的苦难开启🔛</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="pdf-import-button"
            onClick={() => void importPdf()}
            disabled={pdfImport.kind === "reading"}
            aria-label="导入 PDF"
          >
            导入 PDF
          </button>
          <button
            type="button"
            className="add-course-button"
            onClick={() => setIsAdding(true)}
            disabled={storageStatus !== "ready"}
            title={storageStatus === "ready" ? "添加课程" : "正在准备本地课程数据库"}
          >
            <span aria-hidden="true">＋</span> 添加课程
          </button>
          <button
            type="button"
            className="settings-button"
            onClick={() => setIsPeriodSettingsOpen(true)}
            disabled={storageStatus !== "ready"}
            title="作息设置"
          >
            设置
          </button>
          <div className="week-controls" aria-label="教学周切换">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSelectedWeek((week) => Math.max(1, week - 1))}
              disabled={selectedWeek <= 1}
              aria-label="上一教学周"
            >
              ‹
            </button>
            <strong>第 {selectedWeek} 周</strong>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setSelectedWeek((week) => Math.min(maxTeachingWeek, week + 1))}
              disabled={selectedWeek >= maxTeachingWeek}
              aria-label="下一教学周"
            >
              ›
            </button>
            <button
              type="button"
              className="secondary-button"
              aria-label="回到本周"
              title="回到现在"
              onClick={() => {
                setSelectedWeek(currentTeachingWeek);
                setScrollRequest((value) => value + 1);
              }}
            >
              回到现在
            </button>
          </div>
          <div className="day-count-controls" aria-label="课表视图天数">
            <button
              type="button"
              className={dayCount === 5 ? "is-active" : ""}
              onClick={() => {
                setDayCount(5);
                void saveStoredDayCount(5);
              }}
            >
              5天
            </button>
            <button
              type="button"
              className={dayCount === 7 ? "is-active" : ""}
              onClick={() => {
                setDayCount(7);
                void saveStoredDayCount(7);
              }}
            >
              7天
            </button>
          </div>
        </div>
      </header>
      {showDevelopmentFixtures && (
        <p className="fixture-notice" role="status">
          <strong>开发数据</strong>
          浏览器预览显示 fixture；用户课程单独保存在 Windows 应用数据目录。
        </p>
      )}
      {storageStatus === "loading" && <p className="storage-notice">正在读取本地课程…</p>}
      {storageMessage && (
        <p
          className={`storage-notice storage-notice--${storageStatus}`}
          role={storageStatus === "error" ? "alert" : "status"}
        >
          {storageMessage}
        </p>
      )}
      {updateMessage && (
        <p className="storage-notice" role="status">
          {updateMessage}
        </p>
      )}
      {updateState === "available" && availableUpdate && (
        <div className="course-form-backdrop" role="presentation">
          <section
            className="course-form-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="发现新版本"
          >
            <div className="course-form-heading">
              <div>
                <h2>发现新版本</h2>
                <p>当前版本 v1.2.0 · 新版本 v{availableUpdate.version}</p>
              </div>
            </div>
            {availableUpdate.date && (
              <p>发布日期：{new Date(availableUpdate.date).toLocaleDateString("zh-CN")}</p>
            )}
            {availableUpdate.body && (
              <pre className="import-source-text">{availableUpdate.body}</pre>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setUpdateState("idle")}
              >
                稍后提醒
              </button>
              <button type="button" className="primary-button" onClick={() => void installUpdate()}>
                立即更新
              </button>
            </div>
          </section>
        </div>
      )}
      {(updateState === "downloading" || updateState === "installing") && (
        <div className="course-form-backdrop" role="presentation">
          <section
            className="course-form-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="正在更新"
          >
            <h2>
              {updateState === "downloading"
                ? `正在下载 v${availableUpdate?.version ?? ""}`
                : "正在安装更新"}
            </h2>
            <progress
              value={downloadProgress.total ? downloadProgress.downloaded : undefined}
              max={downloadProgress.total ?? undefined}
            />
            {downloadProgress.total && (
              <p>
                {Math.min(
                  100,
                  Math.round((downloadProgress.downloaded / downloadProgress.total) * 100),
                )}
                %
              </p>
            )}
          </section>
        </div>
      )}
      {updateState === "error" && (
        <div className="course-form-backdrop" role="presentation">
          <section
            className="course-form-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="更新失败"
          >
            <h2>更新失败</h2>
            <p>{updateMessage}</p>
            <div className="form-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => void checkForUpdates(true)}
              >
                重试
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  window.open(
                    "https://github.com/LinksOnlining/NTU-Course-Assistant/releases",
                    "_blank",
                  )
                }
              >
                前往 GitHub Release
              </button>
            </div>
          </section>
        </div>
      )}
      {periodMessage && isUsingTestSchedule && (
        <p className="schedule-notice" role="status" data-testid="schedule-notice">
          {periodMessage}
        </p>
      )}
      {pdfImport.kind === "reading" && (
        <p className="pdf-import-status" role="status">
          {pdfImport.ocrProgress
            ? `正在识别扫描版课表…第 ${pdfImport.ocrProgress.page} / ${pdfImport.ocrProgress.pageCount} 页`
            : `正在读取 ${pdfImport.fileName}…`}
        </p>
      )}
      {pdfImport.kind === "error" && (
        <p className="pdf-import-status pdf-import-status--error" role="alert">
          {pdfImport.message}
        </p>
      )}
      {importResult && (
        <section className="import-result-panel" role="status" aria-label="PDF 导入结果">
          <div>
            <strong>课表导入完成</strong>
            <p>已写入课程表，可继续查看和编辑。</p>
          </div>
          <div className="import-result-stats">
            <span>成功导入 {importResult.inserted}</span>
            <span>重复跳过 {importResult.skippedDuplicates}</span>
            <span>未导入 {importResult.unselected}</span>
            <span>需要注意 {importResult.warnings}</span>
          </div>
          <button type="button" className="secondary-button" onClick={() => setImportResult(null)}>
            查看课表
          </button>
        </section>
      )}
      <Timetable
        courses={courses}
        userCourseIds={userCourseIds}
        currentWeek={selectedWeek}
        axis={axis}
        pxPerMinute={TEST_TIMETABLE.pxPerMinute}
        periods={periods}
        visibleWeekdays={visibleWeekdays}
        currentWeekday={isViewingCurrentWeek ? todayWeekday : null}
        nowMinutes={
          isViewingCurrentWeek && visibleWeekdays.some((weekday) => weekday === todayWeekday)
            ? timeToMinutes(nowTime)
            : null
        }
        nowTimeLabel={nowTime}
        scrollRef={timetableScrollRef}
        onEditCourse={(course) => setEditingCourse(course)}
      />
      {dayCount === 5 && weekendOccurrenceCount > 0 && (
        <button type="button" className="weekend-notice" onClick={() => setDayCount(7)}>
          周末有 {weekendOccurrenceCount} 节课，查看 7 天课表
        </button>
      )}
      {pdfImport.kind === "success" && (
        <PdfImportPreview
          document={pdfImport.document}
          evaluation={importEvaluation}
          periods={periods}
          isUsingTestSchedule={isUsingTestSchedule}
          plan={importPlan}
          isImporting={isImporting}
          importError={importError}
          onSaveEdit={(candidateId, edit) => {
            setCandidateEdits((current) => ({ ...current, [candidateId]: edit }));
            setImportPlan(null);
            setPendingImportCourses([]);
            setImportError("");
          }}
          onOpenPeriodSettings={() => setIsPeriodSettingsOpen(true)}
          onEnterFinalReview={enterFinalImportReview}
          onReturnToEdit={() => {
            if (isImporting) return;
            setImportPlan(null);
            setPendingImportCourses([]);
            setImportError("");
          }}
          onConfirmImport={() => void confirmPdfImport()}
          onCancelImport={cancelPdfImport}
        />
      )}
      {(isAdding || editingCourse) && (
        <CourseForm
          axis={axis}
          course={editingCourse ?? undefined}
          onSave={async (course) => {
            if (editingCourse) {
              await updateStoredCourse(course);
              setUserCourses((current) =>
                current.map((item) => (item.id === editingCourse.id ? course : item)),
              );
              notifyWidgetDataChanged();
            } else {
              await insertStoredCourse(course);
              setUserCourses((current) => [...current, course]);
              notifyWidgetDataChanged();
            }
            setIsAdding(false);
            setEditingCourse(null);
          }}
          onDelete={async (id) => {
            await deleteStoredCourse(id);
            setUserCourses((current) => current.filter((course) => course.id !== id));
            notifyWidgetDataChanged();
            setEditingCourse(null);
          }}
          onCancel={() => {
            setIsAdding(false);
            setEditingCourse(null);
          }}
        />
      )}
      {isPeriodSettingsOpen && (
        <PeriodSettings
          key={`period-settings-${restoreNonce}`}
          periods={periods}
          isUsingTestSchedule={isUsingTestSchedule}
          reminderConfiguration={reminderConfiguration}
          widgetSettings={widgetSettings}
          onSave={async (nextPeriods, termConfig, reminderSettings) => {
            const saved = await saveStoredAppSettings(nextPeriods, termConfig, reminderSettings);
            setPeriods([...saved.periods]);
            setIsUsingTestSchedule(false);
            setReminderConfiguration(saved.configuration);
            notifyWidgetDataChanged();
            setPeriodMessage("");
            setIsPeriodSettingsOpen(false);
          }}
          onSaveWidgetSettings={async (patch) => {
            const saved = await patchStoredWidgetSettings(patch);
            // Window creation/showing can take longer than the storage write on Windows.
            // Do not hold the settings dialog in a perpetual "saving" state while it does so.
            void (saved.enabled ? showWidget() : hideWidget()).catch(() => undefined);
            widgetSettingsRevision.current += 1;
            setWidgetSettings(saved);
            notifyWidgetSettingsChanged();
            return saved;
          }}
          onCheckUpdates={() => void checkForUpdates(true)}
          onBackupRestored={() => {
            setRestoreNonce((value) => value + 1);
          }}
          onCancel={() => setIsPeriodSettingsOpen(false)}
        />
      )}
    </main>
  );
}
