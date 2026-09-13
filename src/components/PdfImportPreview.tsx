import { useMemo, useState } from "react";
import { formatWeeks, parseWeeks } from "../core/weeks.ts";
import type { ImportCandidateEdit } from "../types/import-candidate.ts";
import type {
  CandidateEvaluation,
  ImportEvaluation,
  ImportPlan,
} from "../types/import-proposal.ts";
import type { PdfExtraction } from "../types/pdf.ts";
import type { PeriodTime } from "../types/time.ts";

const WEEKDAY_LABELS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const STATUS_LABELS = { ready: "可继续", warning: "需留意", blocking: "需修正" } as const;

type CandidateFilter = "all" | CandidateEvaluation["status"];

interface PdfImportPreviewProps {
  readonly document: PdfExtraction;
  readonly evaluation: ImportEvaluation;
  readonly periods: readonly PeriodTime[];
  readonly isUsingTestSchedule: boolean;
  readonly plan: ImportPlan | null;
  readonly isImporting: boolean;
  readonly importError: string;
  readonly onSaveEdit: (candidateId: string, edit: ImportCandidateEdit) => void;
  readonly onOpenPeriodSettings: () => void;
  readonly onEnterFinalReview: () => void;
  readonly onReturnToEdit: () => void;
  readonly onConfirmImport: () => void;
  readonly onCancelImport: () => void;
}

function candidateSchedule(entry: CandidateEvaluation): string {
  const candidate = entry.candidate;
  const weekday = candidate.weekday === null ? "星期待补充" : WEEKDAY_LABELS[candidate.weekday];
  const period =
    candidate.startPeriod === null || candidate.endPeriod === null
      ? "节次待补充"
      : `第 ${candidate.startPeriod}–${candidate.endPeriod} 节`;
  const time = entry.resolvedTime
    ? `${entry.resolvedTime.startTime}–${entry.resolvedTime.endTime}`
    : "实际时间待解析";
  return `${weekday} · ${period} · ${time}`;
}

function CandidateEditor({
  entry,
  periods,
  onSave,
  onCancel,
}: {
  readonly entry: CandidateEvaluation;
  readonly periods: readonly PeriodTime[];
  readonly onSave: (edit: ImportCandidateEdit) => void;
  readonly onCancel: () => void;
}) {
  const candidate = entry.candidate;
  const [name, setName] = useState(candidate.name ?? "");
  const [teacher, setTeacher] = useState(candidate.teacher ?? "");
  const [classroom, setClassroom] = useState(candidate.classroom ?? "");
  const [weekday, setWeekday] = useState(
    candidate.weekday === null ? "" : String(candidate.weekday),
  );
  const [startPeriod, setStartPeriod] = useState(
    candidate.startPeriod === null ? "" : String(candidate.startPeriod),
  );
  const [endPeriod, setEndPeriod] = useState(
    candidate.endPeriod === null ? "" : String(candidate.endPeriod),
  );
  const [weeks, setWeeks] = useState(candidate.weeks === null ? "" : formatWeeks(candidate.weeks));
  const [error, setError] = useState("");
  const maximumPeriod = Math.max(
    periods.at(-1)?.period ?? 1,
    candidate.startPeriod ?? 1,
    candidate.endPeriod ?? 1,
  );

  function save() {
    try {
      const parsedWeeks = weeks.trim() === "" ? null : parseWeeks(weeks);
      const parsedStart = startPeriod === "" ? null : Number(startPeriod);
      const parsedEnd = endPeriod === "" ? null : Number(endPeriod);
      if (parsedStart !== null && parsedEnd !== null && parsedEnd < parsedStart) {
        setError("结束节次不能早于开始节次");
        return;
      }
      onSave({
        name: name.trim() || null,
        teacher: teacher.trim() || null,
        classroom: classroom.trim() || null,
        weekday: weekday === "" ? null : (Number(weekday) as ImportCandidateEdit["weekday"]),
        startPeriod: parsedStart,
        endPeriod: parsedEnd,
        weeks: parsedWeeks,
      });
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "请检查候选字段。");
    }
  }

  return (
    <section className="candidate-editor" aria-label={`编辑 ${candidate.name ?? "未命名候选"}`}>
      <h3>修正候选</h3>
      <div className="candidate-form-grid">
        <label className="candidate-field candidate-field--wide">
          <span>课程名称</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="candidate-field">
          <span>教师</span>
          <input value={teacher} onChange={(event) => setTeacher(event.target.value)} />
        </label>
        <label className="candidate-field">
          <span>教室</span>
          <input value={classroom} onChange={(event) => setClassroom(event.target.value)} />
        </label>
        <label className="candidate-field">
          <span>星期</span>
          <select value={weekday} onChange={(event) => setWeekday(event.target.value)}>
            <option value="">待补充</option>
            {WEEKDAY_LABELS.slice(1).map((label, index) => (
              <option value={index + 1} key={label}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="candidate-field">
          <span>开始节次</span>
          <select value={startPeriod} onChange={(event) => setStartPeriod(event.target.value)}>
            <option value="">待补充</option>
            {Array.from({ length: maximumPeriod }, (_, index) => index + 1).map((period) => (
              <option value={period} key={period}>
                第 {period} 节
              </option>
            ))}
          </select>
        </label>
        <label className="candidate-field">
          <span>结束节次</span>
          <select value={endPeriod} onChange={(event) => setEndPeriod(event.target.value)}>
            <option value="">待补充</option>
            {Array.from({ length: maximumPeriod }, (_, index) => index + 1).map((period) => (
              <option value={period} key={period}>
                第 {period} 节
              </option>
            ))}
          </select>
        </label>
        <label className="candidate-field candidate-field--wide">
          <span>上课周数</span>
          <input
            value={weeks}
            onChange={(event) => setWeeks(event.target.value)}
            placeholder="例如 1-4,7,10-12"
          />
        </label>
      </div>
      <p className="candidate-time-preview">实际时间由已保存作息严格映射，不能在候选中直接修改。</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="candidate-editor-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>
          取消修改
        </button>
        <button type="button" className="primary-button" onClick={save}>
          保存候选
        </button>
      </div>
    </section>
  );
}

function FinalImportReview({
  document,
  evaluation,
  plan,
  isImporting,
  importError,
  onReturnToEdit,
  onConfirmImport,
  onCancelImport,
}: {
  readonly document: PdfExtraction;
  readonly evaluation: ImportEvaluation;
  readonly plan: ImportPlan;
  readonly isImporting: boolean;
  readonly importError: string;
  readonly onReturnToEdit: () => void;
  readonly onConfirmImport: () => void;
  readonly onCancelImport: () => void;
}) {
  const evaluations = new Map(
    evaluation.candidates.map((entry) => [entry.candidate.id, entry] as const),
  );
  const warningCount = plan.entries.filter((entry) => {
    if (entry.action !== "insert") return false;
    const hasWarning = evaluations
      .get(entry.proposal.candidateId)
      ?.issues.some((issue) => issue.severity === "warning" && issue.code !== "duplicate-course");
    return hasWarning === true || entry.hasConflict;
  }).length;
  const normalCount = plan.summary.toInsert - warningCount;
  const canConfirm = evaluation.canContinue && !isImporting;

  return (
    <div className="pdf-preview-backdrop" role="presentation">
      <section
        className="pdf-preview-dialog pdf-final-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-final-title"
        data-testid="pdf-import-final"
        aria-busy={isImporting}
      >
        <header className="pdf-preview-header">
          <div>
            <p className="eyebrow">PDF 最终确认</p>
            <h2 id="pdf-final-title">确认导入课程</h2>
            <p>
              {document.fileName} · 即将写入 {plan.summary.toInsert} 条，跳过重复课程{" "}
              {plan.summary.skippedDuplicates} 条
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onCancelImport}
            disabled={isImporting}
            aria-label="取消本次 PDF 导入"
          >
            ×
          </button>
        </header>
        <div className="pdf-preview-stats" data-testid="pdf-final-summary">
          <strong>提案 {plan.summary.total}</strong>
          <span data-status="ready">普通 {normalCount}</span>
          <span data-status="warning">警告 {warningCount}</span>
          <span>重复 {plan.summary.skippedDuplicates}</span>
          <span data-status="warning">冲突 {plan.summary.conflicts}</span>
        </div>
        <div className="final-course-list" aria-label="最终导入课程列表">
          {plan.entries.map((entry) => {
            const course = entry.proposal.course;
            const reviewed = evaluations.get(entry.proposal.candidateId);
            return (
              <article
                className={`final-course-card ${entry.action === "skip-duplicate" ? "final-course-card--skipped" : ""}`}
                data-plan-action={entry.action}
                key={entry.proposal.candidateId}
              >
                <div className="final-course-heading">
                  <strong>{course.name}</strong>
                  <span>{entry.action === "skip-duplicate" ? "跳过重复" : "准备写入"}</span>
                </div>
                <p>
                  {WEEKDAY_LABELS[course.weekday]} · 第 {course.startPeriod}–{course.endPeriod} 节 ·{" "}
                  {course.startTime}–{course.endTime}
                </p>
                <p>
                  {formatWeeks(course.weeks)} 周 · {course.classroom ?? "教室待确认"} ·{" "}
                  {course.teacher ?? "教师待确认"}
                </p>
                {entry.hasConflict && <small>提示：与另一门课程时间重叠，将保留并分栏显示。</small>}
                {reviewed?.issues
                  .filter(
                    (issue) => issue.severity === "warning" && issue.code !== "duplicate-course",
                  )
                  .map((issue) => (
                    <small key={`${issue.code}-${issue.field}`}>{issue.message}</small>
                  ))}
              </article>
            );
          })}
        </div>
        {importError && (
          <p className="final-import-error" role="alert">
            {importError}
          </p>
        )}
        {!evaluation.canContinue && (
          <p className="final-import-error" role="alert">
            候选状态已经变化，请返回修改并重新检查。
          </p>
        )}
        <footer className="pdf-preview-footer">
          <div>
            {isImporting ? "正在以单个 SQLite 事务写入…" : "确认后将一次性写入全部非重复课程。"}
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={onReturnToEdit}
            disabled={isImporting}
          >
            返回修改
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onCancelImport}
            disabled={isImporting}
          >
            取消本次导入
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={onConfirmImport}
            disabled={!canConfirm}
          >
            {isImporting ? "正在导入…" : `确认导入 ${plan.summary.toInsert} 条课程`}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function PdfImportPreview({
  document,
  evaluation,
  periods,
  isUsingTestSchedule,
  plan,
  isImporting,
  importError,
  onSaveEdit,
  onOpenPeriodSettings,
  onEnterFinalReview,
  onReturnToEdit,
  onConfirmImport,
  onCancelImport,
}: PdfImportPreviewProps) {
  const [filter, setFilter] = useState<CandidateFilter>("all");
  const [selectedId, setSelectedId] = useState(evaluation.candidates[0]?.candidate.id ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const filtered = useMemo(
    () => evaluation.candidates.filter((entry) => filter === "all" || entry.status === filter),
    [evaluation.candidates, filter],
  );
  const selected =
    filtered.find((entry) => entry.candidate.id === selectedId) ?? filtered[0] ?? null;
  const summary = evaluation.summary;
  const filters: readonly [CandidateFilter, string, number][] = [
    ["all", "全部", summary.total],
    ["ready", "可继续", summary.ready],
    ["warning", "需留意", summary.warning],
    ["blocking", "需修正", summary.blocking],
  ];

  if (plan !== null) {
    return (
      <FinalImportReview
        document={document}
        evaluation={evaluation}
        plan={plan}
        isImporting={isImporting}
        importError={importError}
        onReturnToEdit={onReturnToEdit}
        onConfirmImport={onConfirmImport}
        onCancelImport={onCancelImport}
      />
    );
  }

  return (
    <div className="pdf-preview-backdrop" role="presentation">
      <section
        className="pdf-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-preview-title"
        data-testid="pdf-import-preview"
      >
        <header className="pdf-preview-header">
          <div>
            <p className="eyebrow">PDF 课程识别</p>
            <h2 id="pdf-preview-title">检查导入候选</h2>
            <p>
              {document.fileName} · {document.pageCount} 页 · 当前只生成提案，不会写入课程表
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onCancelImport}
            aria-label="取消本次 PDF 导入"
          >
            ×
          </button>
        </header>

        <div className="pdf-preview-stats" data-testid="pdf-candidate-summary">
          <strong>识别到 {summary.total} 个候选</strong>
          <span>固定安排 {summary.fixed}</span>
          <span>非固定实践 {summary.practice}</span>
          <span data-status="ready">可继续 {summary.ready}</span>
          <span data-status="warning">需留意 {summary.warning}</span>
          <span data-status="blocking">需修正 {summary.blocking}</span>
        </div>

        <div className="pdf-preview-toolbar">
          {isUsingTestSchedule && (
            <div className="pdf-schedule-warning" role="alert">
              <span>请先在设置中确认作息，固定课程才能生成正式时间。</span>
              <button type="button" className="secondary-button" onClick={onOpenPeriodSettings}>
                打开作息设置
              </button>
            </div>
          )}

          <nav className="candidate-filters" aria-label="筛选候选状态">
            {filters.map(([value, label, count]) => (
              <button
                type="button"
                key={value}
                className={filter === value ? "is-active" : ""}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label} {count}
              </button>
            ))}
          </nav>
        </div>

        <div className="pdf-preview-content">
          <div className="candidate-list" aria-label="PDF 课程候选">
            {filtered.map((entry) => {
              const candidate = entry.candidate;
              return (
                <article
                  className={`candidate-card candidate-card--${entry.status}`}
                  data-candidate-id={candidate.id}
                  data-candidate-kind={candidate.kind}
                  data-candidate-status={entry.status}
                  key={candidate.id}
                >
                  <button
                    type="button"
                    className="candidate-card-main"
                    onClick={() => setSelectedId(candidate.id)}
                    aria-label={`查看 ${candidate.name ?? "未命名候选"}`}
                  >
                    <span className="candidate-card-heading">
                      <strong>{candidate.name ?? "未识别课程名"}</strong>
                      <small>{STATUS_LABELS[entry.status]}</small>
                    </span>
                    <span>{candidateSchedule(entry)}</span>
                    <span>{candidate.classroom ?? "教室待确认"}</span>
                  </button>
                  <button
                    type="button"
                    className="candidate-edit-button"
                    onClick={() => {
                      setSelectedId(candidate.id);
                      setEditingId(candidate.id);
                    }}
                    aria-label={`编辑 ${candidate.name ?? "未命名候选"}`}
                  >
                    编辑
                  </button>
                </article>
              );
            })}
            {filtered.length === 0 && <p className="candidate-empty">此筛选下没有候选。</p>}
          </div>

          <aside className="candidate-detail" aria-live="polite">
            {selected === null ? (
              <p>没有可检查的课程候选。</p>
            ) : editingId === selected.candidate.id ? (
              <CandidateEditor
                key={selected.candidate.id}
                entry={selected}
                periods={periods}
                onSave={(edit) => {
                  onSaveEdit(selected.candidate.id, edit);
                  setEditingId(null);
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                <div className="candidate-detail-heading">
                  <div>
                    <span className={`candidate-status candidate-status--${selected.status}`}>
                      {STATUS_LABELS[selected.status]}
                    </span>
                    <h3>{selected.candidate.name ?? "未识别课程名"}</h3>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setEditingId(selected.candidate.id)}
                    aria-label={`编辑 ${selected.candidate.name ?? "未命名候选"}`}
                  >
                    编辑候选
                  </button>
                </div>
                <dl className="candidate-facts">
                  <div>
                    <dt>上课安排</dt>
                    <dd>{candidateSchedule(selected)}</dd>
                  </div>
                  <div>
                    <dt>上课周数</dt>
                    <dd>
                      {selected.candidate.weeks === null
                        ? "待补充"
                        : formatWeeks(selected.candidate.weeks)}
                    </dd>
                  </div>
                  <div>
                    <dt>教室</dt>
                    <dd>{selected.candidate.classroom ?? "待确认"}</dd>
                  </div>
                  <div>
                    <dt>教师</dt>
                    <dd>{selected.candidate.teacher ?? "待确认"}</dd>
                  </div>
                  <div>
                    <dt>来源</dt>
                    <dd>
                      第 {selected.candidate.source.page} 页 · 位置 x{" "}
                      {selected.candidate.source.bounds.x.toFixed(1)} / y{" "}
                      {selected.candidate.source.bounds.y.toFixed(1)}
                    </dd>
                  </div>
                </dl>
                {selected.issues.length > 0 ? (
                  <ul
                    className="candidate-issues"
                    aria-label={`${selected.candidate.name ?? "候选"}的问题`}
                  >
                    {selected.issues.map((current) => (
                      <li key={`${current.code}-${current.field}`} data-severity={current.severity}>
                        <strong>{current.severity === "blocking" ? "需修正" : "提示"}</strong>
                        {current.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="candidate-ready-message">字段完整，可以生成课程提案。</p>
                )}
                <details className="candidate-source-text">
                  <summary>查看当前候选来源文字</summary>
                  <p>{selected.candidate.source.text}</p>
                </details>
              </>
            )}
          </aside>
        </div>

        <footer className="pdf-preview-footer">
          <div>
            已生成 {summary.proposalCount}/{summary.total} 条课程提案
            {summary.blocking > 0 && <small>请先修正全部阻断项。</small>}
          </div>
          <button type="button" className="secondary-button" onClick={onCancelImport}>
            取消本次导入
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!evaluation.canContinue}
            onClick={onEnterFinalReview}
          >
            进入最终确认
          </button>
        </footer>
      </section>
    </div>
  );
}
