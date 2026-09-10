import { useEffect, useMemo, useState } from "react";
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
import { courseTiming } from "./core/timetable-layout.ts";
import { parseNtuPdfTimetable } from "./importers/ntu-pdf/parse.ts";
import { TEST_COURSES } from "./fixtures/courses.ts";
import { choosePdfFile, extractPdfText, PdfImportError } from "./services/pdf-import.ts";
import {
  deleteStoredCourse,
  importStoredCourses,
  insertStoredCourse,
  loadStoredCourses,
  loadStoredPeriodTimes,
  updateStoredCourse,
  saveStoredPeriodTimes,
} from "./services/course-storage.ts";
import type { Course } from "./types/course.ts";
import type { ImportCandidate, ImportCandidateEdit } from "./types/import-candidate.ts";
import type { ImportPlan } from "./types/import-proposal.ts";
import type { PdfExtraction } from "./types/pdf.ts";
import type { PeriodTime } from "./types/time.ts";

type PdfImportState =
  | { readonly kind: "idle" }
  | { readonly kind: "reading"; readonly fileName: string }
  | {
      readonly kind: "success";
      readonly document: PdfExtraction;
      readonly candidates: readonly ImportCandidate[];
    }
  | { readonly kind: "error"; readonly message: string };

export function App() {
  const [userCourses, setUserCourses] = useState<readonly Course[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [periods, setPeriods] = useState<readonly PeriodTime[]>(TEST_TIMETABLE.periods);
  const [isPeriodSettingsOpen, setIsPeriodSettingsOpen] = useState(false);
  const [isUsingTestSchedule, setIsUsingTestSchedule] = useState(true);
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
  const [importSuccess, setImportSuccess] = useState("");
  const fixtureCourses = import.meta.env.DEV ? TEST_COURSES : [];
  const courses = useMemo(() => [...fixtureCourses, ...userCourses], [fixtureCourses, userCourses]);
  const axis = useMemo(() => getTimelineBounds(TEST_TIMETABLE.axis, periods), [periods]);
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
    let active = true;
    void Promise.all([loadStoredCourses(), loadStoredPeriodTimes()])
      .then(([result, storedPeriods]) => {
        if (!active) return;
        const activePeriods = storedPeriods ?? TEST_TIMETABLE.periods;
        setPeriods(activePeriods);
        setIsUsingTestSchedule(storedPeriods === null);
        setPeriodMessage(
          storedPeriods === null ? "当前使用测试作息，请在设置中确认。" : "已使用自定义作息。",
        );
        const displayAxis = getTimelineBounds(TEST_TIMETABLE.axis, activePeriods);
        const warnings = [...result.warnings];
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
        setStorageMessage(warnings.join(" "));
        setStorageStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStorageMessage(error instanceof Error ? error.message : "本地课程数据库不可用。");
        setStorageStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  async function importPdf() {
    try {
      const file = await choosePdfFile();
      if (file === null) return;
      setImportPlan(null);
      setPendingImportCourses([]);
      setImportError("");
      setImportSuccess("");
      setPdfImport({ kind: "reading", fileName: file.fileName });
      const document = await extractPdfText(file);
      const candidates = parseNtuPdfTimetable(document, {
        periods,
        isUsingTestSchedule,
      });
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
      setImportSuccess(
        `已导入 ${inserted.length} 条课程安排，跳过 ${importPlan.summary.skippedDuplicates} 条重复课程。`,
      );
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
            <span className="prototype-badge">桌面原型</span>
          </div>
          <p className="subtitle">时间决定位置，空闲时段按真实比例保留</p>
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
          <div className="week-status" aria-label={`当前为测试第 ${TEST_TIMETABLE.currentWeek} 周`}>
            <span>测试教学周</span>
            <strong>第 {TEST_TIMETABLE.currentWeek} 周</strong>
            <small>周一至周日</small>
          </div>
        </div>
      </header>
      <p className="fixture-notice" role="status">
        <strong>测试数据</strong>
        开发模式显示 fixture；用户课程单独保存在 Windows 应用数据目录。
      </p>
      {storageStatus === "loading" && <p className="storage-notice">正在读取本地课程…</p>}
      {storageMessage && (
        <p
          className={`storage-notice storage-notice--${storageStatus}`}
          role={storageStatus === "error" ? "alert" : "status"}
        >
          {storageMessage}
        </p>
      )}
      {periodMessage && (
        <p className="schedule-notice" role="status" data-testid="schedule-notice">
          {periodMessage}
        </p>
      )}
      {pdfImport.kind === "reading" && (
        <p className="pdf-import-status" role="status">
          正在读取 {pdfImport.fileName}…
        </p>
      )}
      {pdfImport.kind === "error" && (
        <p className="pdf-import-status pdf-import-status--error" role="alert">
          {pdfImport.message}
        </p>
      )}
      {importSuccess && (
        <p className="import-success-notice" role="status">
          <span>{importSuccess}</span>
          <button type="button" onClick={() => setImportSuccess("")} aria-label="关闭导入结果">
            ×
          </button>
        </p>
      )}
      <Timetable
        courses={courses}
        userCourseIds={userCourseIds}
        currentWeek={TEST_TIMETABLE.currentWeek}
        axis={axis}
        pxPerMinute={TEST_TIMETABLE.pxPerMinute}
        periods={periods}
        onEditCourse={(course) => setEditingCourse(course)}
      />
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
            } else {
              await insertStoredCourse(course);
              setUserCourses((current) => [...current, course]);
            }
            setIsAdding(false);
            setEditingCourse(null);
          }}
          onDelete={async (id) => {
            await deleteStoredCourse(id);
            setUserCourses((current) => current.filter((course) => course.id !== id));
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
          periods={periods}
          isUsingTestSchedule={isUsingTestSchedule}
          onSave={async (nextPeriods) => {
            await saveStoredPeriodTimes(nextPeriods);
            setPeriods([...nextPeriods]);
            setIsUsingTestSchedule(false);
            setPeriodMessage("已使用自定义作息。");
            setIsPeriodSettingsOpen(false);
          }}
          onCancel={() => setIsPeriodSettingsOpen(false)}
        />
      )}
    </main>
  );
}
