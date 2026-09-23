import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { resolveCourseOccurrences } from "../core/course-occurrence.ts";
import { getTodayDashboard } from "../core/today-dashboard.ts";
import { summarizeCourseChanges } from "../core/course-change.ts";
import { getShanghaiDate, getShanghaiTime, getTeachingWeek } from "../core/reminder.ts";
import { ChineseDateInput, ChineseDateTimeInput } from "./ChineseDateInput.tsx";
import { beginRuntimeTrace } from "../services/runtime-trace.ts";
import {
  archiveSemester,
  deleteAcademicTask,
  deleteExam,
  loadAcademicTasks,
  loadCourseOverrides,
  loadExams,
  loadSemesters,
  revokeCourseOverride,
  saveAcademicTask,
  saveCourseOverride,
  saveExam,
  saveSemester,
} from "../services/academic-storage.ts";
import type { AcademicTask, AcademicTaskType } from "../types/academic-task.ts";
import type { AcademicCourseOccurrence } from "../types/academic-occurrence.ts";
import type { Course } from "../types/course.ts";
import type { CourseOverride, CourseOverrideKind } from "../types/course-override.ts";
import type { Exam } from "../types/exam.ts";
import type { Semester } from "../types/semester.ts";
import type { TermConfig } from "../types/reminder.ts";
import type { PeriodTime } from "../types/time.ts";

type HubTab = "today" | "changes" | "tasks" | "exams" | "semesters";
type ChangeFilter = "all" | "changed";

interface AcademicHubProps {
  readonly courses: readonly Course[];
  readonly periods: readonly PeriodTime[];
  readonly termConfig: TermConfig | null;
  readonly onDataChanged?: () => void;
}

const TASK_TYPES: readonly { value: AcademicTaskType; label: string }[] = [
  { value: "ASSIGNMENT", label: "作业" },
  { value: "LAB_REPORT", label: "实验报告" },
  { value: "PRESENTATION", label: "展示" },
  { value: "PROJECT", label: "项目" },
  { value: "CUSTOM", label: "其他" },
];

function stamp(): string {
  return new Date().toISOString();
}

function localDateTimeValue(value: string): string {
  return value.slice(0, 16);
}

function daysUntil(value: string): number {
  return Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 86_400_000));
}

const WEEKDAY_LABELS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;

function formatChineseDate(value: string): string {
  const [, month, day] = value.split("-");
  return month && day ? `${Number(month)}月${Number(day)}日` : value;
}

function formatMeeting(
  weekday: number,
  startPeriod: number | null,
  endPeriod: number | null,
  startTime: string,
  endTime: string,
): string {
  const periods =
    startPeriod !== null && endPeriod !== null ? ` · 第${startPeriod}–${endPeriod}节` : "";
  return `${WEEKDAY_LABELS[weekday] ?? ""}${periods} · ${startTime}–${endTime}`;
}

function changeStatusLabel(item: AcademicCourseOccurrence): string | null {
  if (item.status === "CANCELLED") return "已停课";
  if (item.status === "RESCHEDULED") return "已调课";
  if (item.status === "MAKEUP") return "补课";
  if (item.appliedOverrideKind === "MODIFY") return "已换教室";
  return null;
}

function makeSemester(termConfig: TermConfig): Semester {
  const timestamp = stamp();
  return {
    id: "legacy-active-semester",
    name: "当前学期",
    firstWeekMonday: termConfig.firstWeekMonday,
    totalWeeks: termConfig.totalWeeks,
    timezone: "Asia/Shanghai",
    status: "ACTIVE",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function makeOverride(
  occurrence: ReturnType<typeof resolveCourseOccurrences>[number],
  kind: CourseOverrideKind,
  targetDate: string | null,
  startTime: string | null,
  endTime: string | null,
  classroom: string | null,
): CourseOverride {
  const timestamp = stamp();
  return {
    id: crypto.randomUUID(),
    courseId: occurrence.courseId,
    semesterId: occurrence.semesterId,
    kind,
    originalOccurrenceKey:
      kind === "MAKEUP" ? null : (occurrence.originalOccurrenceKey ?? occurrence.occurrenceKey),
    originalDate: kind === "MAKEUP" ? null : occurrence.date,
    targetDate,
    startPeriod: occurrence.startPeriod,
    endPeriod: occurrence.endPeriod,
    startTime,
    endTime,
    classroom,
    teacher: occurrence.teacher,
    note: null,
    active: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function confirmScheduleConflict(
  occurrences: readonly ReturnType<typeof resolveCourseOccurrences>[number][],
  source: ReturnType<typeof resolveCourseOccurrences>[number],
  date: string,
  startTime: string,
  endTime: string,
): boolean {
  const conflict = occurrences.find(
    (item) =>
      item.occurrenceKey !== source.occurrenceKey &&
      item.status !== "CANCELLED" &&
      item.date === date &&
      startTime < item.endTime &&
      endTime > item.startTime,
  );
  return (
    conflict === undefined ||
    window.confirm(
      `与同日课程 ${conflict.startTime}–${conflict.endTime} 存在时间冲突，仍要保存吗？`,
    )
  );
}

type CourseChangeAction = "cancel" | "reschedule" | "modify" | "makeup" | "revoke";
type CourseChangeOperation =
  | { readonly status: "idle" }
  | {
      readonly status: "saving";
      readonly action: CourseChangeAction;
      readonly occurrenceKey: string;
    };

type CourseChangeEditor = {
  readonly kind: Exclude<CourseOverrideKind, "CANCEL">;
  readonly occurrenceKey: string;
  readonly targetDate: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly room: string;
};

interface CourseChangePageStateOptions {
  readonly tab: HubTab;
  readonly courses: readonly Course[];
  readonly occurrences: readonly ReturnType<typeof resolveCourseOccurrences>[number][];
  readonly overrides: readonly CourseOverride[];
  readonly setOverrides: Dispatch<SetStateAction<readonly CourseOverride[]>>;
  readonly semester: Semester | null;
  readonly termConfig: TermConfig | null;
  readonly onDataChanged?: () => void;
}

function useCourseChangePageState({
  tab,
  courses,
  occurrences,
  overrides,
  setOverrides,
  semester,
  termConfig,
  onDataChanged,
}: CourseChangePageStateOptions) {
  const [changeCourseId, setChangeCourseId] = useState<string | null>(null);
  const [changeOccurrenceKey, setChangeOccurrenceKey] = useState<string | null>(null);
  const [changeSearch, setChangeSearch] = useState("");
  const [changeFilter, setChangeFilter] = useState<ChangeFilter>("all");
  const [changeEditor, setChangeEditor] = useState<CourseChangeEditor | null>(null);
  const [occurrenceMessage, setOccurrenceMessage] = useState("");
  const [operation, setOperation] = useState<CourseChangeOperation>({ status: "idle" });
  const operationRef = useRef<CourseChangeOperation>({ status: "idle" });
  const operationGeneration = useRef(0);
  const activeTabRef = useRef(tab);
  activeTabRef.current = tab;
  const updateOperation = (next: CourseChangeOperation) => {
    operationRef.current = next;
    setOperation(next);
  };

  useEffect(() => {
    if (tab !== "changes") {
      operationGeneration.current += 1;
      setChangeCourseId(null);
      setChangeOccurrenceKey(null);
      setChangeEditor(null);
      setOccurrenceMessage("");
      updateOperation({ status: "idle" });
      setChangeSearch("");
      setChangeFilter("all");
    }
    return () => {
      operationGeneration.current += 1;
    };
  }, [tab]);

  const changeSummaries = useMemo(
    () => summarizeCourseChanges(courses, occurrences, overrides),
    [courses, occurrences, overrides],
  );
  const visibleChangeSummaries = useMemo(() => {
    const query = changeSearch.trim().toLocaleLowerCase("zh-CN");
    return changeSummaries.filter((summary) => {
      if (changeFilter === "changed" && summary.changedCount === 0) return false;
      if (!query) return true;
      const haystack = [
        summary.course.name,
        summary.course.teacher ?? "",
        summary.course.classroom ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      return haystack.includes(query);
    });
  }, [changeFilter, changeSearch, changeSummaries]);
  const selectedChangeSummary = changeSummaries.find(
    (summary) => summary.course.id === changeCourseId,
  );
  const selectedChangeTemplate =
    selectedChangeSummary?.occurrences.find((item) => item.occurrenceKey === changeOccurrenceKey) ??
    selectedChangeSummary?.occurrences[0];
  const currentTeachingWeek = termConfig
    ? getTeachingWeek(getShanghaiDate(Date.now()), termConfig)
    : null;
  const selectedCourseCurrentWeek = selectedChangeSummary?.occurrences.filter(
    (item) => item.teachingWeek === currentTeachingWeek,
  );
  const occurrenceBusyKey = operation.status === "saving" ? operation.occurrenceKey : null;

  useEffect(() => {
    if (tab !== "changes" || !changeCourseId) return;
    if (!selectedChangeSummary) {
      setChangeCourseId(null);
      setChangeOccurrenceKey(null);
      setChangeEditor(null);
      setOccurrenceMessage("");
      return;
    }
    if (
      changeOccurrenceKey &&
      !selectedChangeSummary.occurrences.some((item) => item.occurrenceKey === changeOccurrenceKey)
    ) {
      setChangeOccurrenceKey(null);
      setChangeEditor(null);
      setOccurrenceMessage("");
    }
  }, [changeCourseId, changeOccurrenceKey, selectedChangeSummary, tab]);

  async function runOccurrence(
    action: CourseChangeAction,
    occurrenceKey: string,
    save: () => Promise<void>,
    success: string,
  ) {
    if (operationRef.current.status === "saving") return;
    const generation = ++operationGeneration.current;
    const trace = beginRuntimeTrace(`${action}-occurrence`, generation);
    updateOperation({ status: "saving", action, occurrenceKey });
    setOccurrenceMessage("");
    trace("confirmed");
    trace("save-start");
    try {
      await save();
      trace("save-success");
      trace("canonical-refresh-start");
      onDataChanged?.();
      trace("canonical-refresh-end");
      if (generation === operationGeneration.current && activeTabRef.current === "changes") {
        setOccurrenceMessage(success);
        trace("ui-update");
      }
    } catch (error: unknown) {
      if (generation === operationGeneration.current && activeTabRef.current === "changes") {
        setOccurrenceMessage(error instanceof Error ? error.message : "操作失败，请稍后重试。");
      }
    } finally {
      if (generation === operationGeneration.current) updateOperation({ status: "idle" });
      trace("operation-complete");
    }
  }

  function openChangeEditor(
    item: ReturnType<typeof resolveCourseOccurrences>[number],
    kind: Exclude<CourseOverrideKind, "CANCEL">,
  ) {
    setChangeOccurrenceKey(item.occurrenceKey);
    setOccurrenceMessage("");
    setChangeEditor({
      kind,
      occurrenceKey: item.occurrenceKey,
      targetDate: item.date,
      startTime: item.startTime,
      endTime: item.endTime,
      room: item.room ?? "",
    });
  }

  function updateChangeEditor(patch: Partial<CourseChangeEditor>) {
    setChangeEditor((current) => (current ? { ...current, ...patch } : current));
  }

  function submitChangeEditor(item: ReturnType<typeof resolveCourseOccurrences>[number]) {
    const editor = changeEditor;
    if (!editor || editor.occurrenceKey !== item.occurrenceKey || !semester) return;
    if (editor.kind !== "MODIFY" && (!editor.targetDate || !editor.startTime || !editor.endTime))
      return;
    if (
      editor.kind !== "MODIFY" &&
      !confirmScheduleConflict(
        occurrences,
        item,
        editor.targetDate,
        editor.startTime,
        editor.endTime,
      )
    )
      return;
    void runOccurrence(
      editor.kind === "RESCHEDULE" ? "reschedule" : editor.kind === "MAKEUP" ? "makeup" : "modify",
      item.occurrenceKey,
      async () => {
        const saved = await saveCourseOverride(
          makeOverride(
            item,
            editor.kind,
            editor.kind === "MODIFY" ? null : editor.targetDate,
            editor.kind === "MODIFY" ? null : editor.startTime,
            editor.kind === "MODIFY" ? null : editor.endTime,
            editor.room.trim() || null,
          ),
        );
        setOverrides((current) => [...current, saved]);
        setChangeEditor(null);
      },
      editor.kind === "RESCHEDULE"
        ? "已保存调课"
        : editor.kind === "MAKEUP"
          ? "已添加补课"
          : "已修改本次教室",
    );
  }

  return {
    changeCourseId,
    setChangeCourseId,
    changeOccurrenceKey,
    setChangeOccurrenceKey,
    changeSearch,
    setChangeSearch,
    changeFilter,
    setChangeFilter,
    changeEditor,
    setChangeEditor,
    occurrenceMessage,
    setOccurrenceMessage,
    occurrenceBusyKey,
    visibleChangeSummaries,
    selectedChangeSummary,
    selectedChangeTemplate,
    selectedCourseCurrentWeek,
    runOccurrence,
    openChangeEditor,
    updateChangeEditor,
    submitChangeEditor,
  };
}

export function AcademicHub({ courses, periods, termConfig, onDataChanged }: AcademicHubProps) {
  const [tab, setTab] = useState<HubTab>("today");
  const [semesters, setSemesters] = useState<readonly Semester[]>([]);
  const [semester, setSemester] = useState<Semester | null>(null);
  const [overrides, setOverrides] = useState<readonly CourseOverride[]>([]);
  const [tasks, setTasks] = useState<readonly AcademicTask[]>([]);
  const [exams, setExams] = useState<readonly Exam[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDueAt, setTaskDueAt] = useState("");
  const [taskType, setTaskType] = useState<AcademicTaskType>("ASSIGNMENT");
  const [taskCourseId, setTaskCourseId] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [examTitle, setExamTitle] = useState("");
  const [examStartsAt, setExamStartsAt] = useState("");
  const [examLocation, setExamLocation] = useState("");
  const [examCourseId, setExamCourseId] = useState("");
  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const activeTabRef = useRef(tab);
  activeTabRef.current = tab;

  useEffect(() => {
    setMessage("");
  }, [tab]);

  useEffect(() => {
    let active = true;
    void loadSemesters()
      .then(async (items) => {
        if (!active) return;
        let nextItems = [...items];
        let next = nextItems.find((item) => item.status === "ACTIVE") ?? null;
        if (!next && termConfig) {
          next = await saveSemester(makeSemester(termConfig));
          nextItems = [next, ...nextItems];
        }
        if (active) {
          setSemesters(nextItems);
          setSemester(next);
        }
      })
      .catch(
        (error: unknown) =>
          active && setMessage(error instanceof Error ? error.message : "无法读取学期"),
      );
    return () => {
      active = false;
    };
  }, [termConfig]);

  useEffect(() => {
    if (!semester) {
      setOverrides([]);
      setTasks([]);
      setExams([]);
      return;
    }
    let active = true;
    void Promise.all([
      loadCourseOverrides(semester.id),
      loadAcademicTasks(semester.id),
      loadExams(semester.id),
    ])
      .then(([nextOverrides, nextTasks, nextExams]) => {
        if (!active) return;
        setOverrides(nextOverrides);
        setTasks(nextTasks);
        setExams(nextExams);
      })
      .catch(
        (error: unknown) =>
          active && setMessage(error instanceof Error ? error.message : "无法读取学习数据"),
      );
    return () => {
      active = false;
    };
  }, [semester]);

  const occurrences = useMemo(
    () =>
      semester ? resolveCourseOccurrences(courses, semester, overrides, undefined, periods) : [],
    [courses, overrides, periods, semester],
  );
  const nowDate = getShanghaiDate(Date.now());
  const nowTime = getShanghaiTime(Date.now());
  const dashboard = useMemo(
    () => getTodayDashboard(nowDate, nowTime, occurrences, tasks, exams),
    [exams, nowDate, nowTime, occurrences, tasks],
  );
  const courseById = useMemo(
    () => new Map(courses.map((course) => [course.id, course])),
    [courses],
  );
  const {
    changeCourseId,
    setChangeCourseId,
    changeOccurrenceKey,
    setChangeOccurrenceKey,
    changeSearch,
    setChangeSearch,
    changeFilter,
    setChangeFilter,
    changeEditor,
    setChangeEditor,
    occurrenceMessage,
    setOccurrenceMessage,
    occurrenceBusyKey,
    visibleChangeSummaries,
    selectedChangeSummary,
    selectedChangeTemplate,
    selectedCourseCurrentWeek,
    runOccurrence,
    openChangeEditor,
    updateChangeEditor,
    submitChangeEditor,
  } = useCourseChangePageState({
    tab,
    courses,
    occurrences,
    overrides,
    setOverrides,
    semester,
    termConfig,
    onDataChanged,
  });
  const readOnly = semester?.status === "ARCHIVED";

  async function run(action: () => Promise<void>, success: string) {
    const actionTab = activeTabRef.current;
    setBusy(true);
    setMessage("");
    try {
      await action();
      if (activeTabRef.current === actionTab) setMessage(success);
      onDataChanged?.();
    } catch (error: unknown) {
      if (activeTabRef.current === actionTab) {
        setMessage(error instanceof Error ? error.message : "操作失败，请稍后重试。");
      }
    } finally {
      setBusy(false);
    }
  }

  function refreshSemester(next: Semester) {
    setSemester(next);
    setSemesters((current) => [next, ...current.filter((item) => item.id !== next.id)]);
  }

  const taskForm = (
    <form
      className="hub-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!semester || !taskTitle.trim() || !taskDueAt) return;
        const timestamp = stamp();
        void run(async () => {
          const existing = editingTaskId
            ? tasks.find((item) => item.id === editingTaskId)
            : undefined;
          const saved = await saveAcademicTask({
            id: existing?.id ?? crypto.randomUUID(),
            semesterId: semester.id,
            courseId: taskCourseId || null,
            type: taskType,
            title: taskTitle.trim(),
            note: null,
            dueAt: `${taskDueAt}:00+08:00`,
            priority: 0,
            status: existing?.status ?? "TODO",
            completedAt: existing?.completedAt ?? null,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
          });
          setTasks((current) =>
            existing
              ? current.map((item) => (item.id === saved.id ? saved : item))
              : [...current, saved],
          );
          setTaskTitle("");
          setTaskDueAt("");
          setTaskCourseId("");
          setEditingTaskId(null);
        }, "学习事项已添加");
      }}
    >
      <input
        value={taskTitle}
        onChange={(event) => setTaskTitle(event.target.value)}
        placeholder="例如：完成实验报告"
        aria-label="学习事项标题"
      />
      <select
        value={taskType}
        onChange={(event) => setTaskType(event.target.value as AcademicTaskType)}
        aria-label="学习事项类型"
      >
        {TASK_TYPES.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      <ChineseDateTimeInput
        value={taskDueAt}
        onChange={setTaskDueAt}
        ariaLabel="截止时间"
        disabled={busy || readOnly}
      />
      <select
        value={taskCourseId}
        onChange={(event) => setTaskCourseId(event.target.value)}
        aria-label="关联课程"
      >
        <option value="">不关联课程</option>
        {courses.map((course) => (
          <option key={course.id} value={course.id}>
            {course.name}
          </option>
        ))}
      </select>
      <button
        className="primary-button"
        type="submit"
        disabled={busy || readOnly || !semester || !taskTitle.trim() || !taskDueAt}
      >
        {editingTaskId ? "保存修改" : "添加事项"}
      </button>
      {editingTaskId && (
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setEditingTaskId(null);
            setTaskTitle("");
            setTaskDueAt("");
            setTaskCourseId("");
          }}
        >
          取消编辑
        </button>
      )}
    </form>
  );

  const examForm = (
    <form
      className="hub-inline-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!semester || !examTitle.trim() || !examStartsAt) return;
        const timestamp = stamp();
        void run(async () => {
          const existing = editingExamId
            ? exams.find((item) => item.id === editingExamId)
            : undefined;
          const saved = await saveExam({
            id: existing?.id ?? crypto.randomUUID(),
            semesterId: semester.id,
            courseId: examCourseId || null,
            title: examTitle.trim(),
            startsAt: `${examStartsAt}:00+08:00`,
            endsAt: existing?.endsAt ?? null,
            location: examLocation.trim() || null,
            seatInfo: existing?.seatInfo ?? null,
            note: existing?.note ?? null,
            status: existing?.status ?? "SCHEDULED",
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
          });
          setExams((current) =>
            existing
              ? current.map((item) => (item.id === saved.id ? saved : item))
              : [...current, saved],
          );
          setExamTitle("");
          setExamStartsAt("");
          setExamLocation("");
          setExamCourseId("");
          setEditingExamId(null);
        }, "考试已添加");
      }}
    >
      <input
        value={examTitle}
        onChange={(event) => setExamTitle(event.target.value)}
        placeholder="例如：大学物理期末考试"
        aria-label="考试名称"
      />
      <ChineseDateTimeInput
        value={examStartsAt}
        onChange={setExamStartsAt}
        ariaLabel="考试时间"
        disabled={busy || readOnly}
      />
      <input
        value={examLocation}
        onChange={(event) => setExamLocation(event.target.value)}
        placeholder="地点（可选）"
        aria-label="考试地点"
      />
      <select
        value={examCourseId}
        onChange={(event) => setExamCourseId(event.target.value)}
        aria-label="关联课程"
      >
        <option value="">不关联课程</option>
        {courses.map((course) => (
          <option key={course.id} value={course.id}>
            {course.name}
          </option>
        ))}
      </select>
      <button
        className="primary-button"
        type="submit"
        disabled={busy || readOnly || !semester || !examTitle.trim() || !examStartsAt}
      >
        {editingExamId ? "保存修改" : "添加考试"}
      </button>
      {editingExamId && (
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setEditingExamId(null);
            setExamTitle("");
            setExamStartsAt("");
            setExamLocation("");
            setExamCourseId("");
          }}
        >
          取消编辑
        </button>
      )}
    </form>
  );

  return (
    <section className="academic-hub" aria-label="学习中心">
      <div className="hub-tabs" role="tablist" aria-label="学习中心分区">
        {(
          [
            ["today", "今日"],
            ["changes", "课表变化"],
            ["tasks", "任务"],
            ["exams", "考试"],
            ["semesters", "学期管理"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "is-active" : ""}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="hub-content-viewport academic-page-shell">
        {message && (
          <p className="hub-message" role="status">
            {message}
          </p>
        )}
        {!semester && (
          <p className="hub-empty">请先在设置中确认第 1 教学周日期，才能使用学习中心。</p>
        )}
        {semester && tab === "today" && (
          <div className="hub-grid">
            <article className="hub-hero">
              <span>下一节课</span>
              <strong>
                {dashboard.nextOccurrence
                  ? (courseById.get(dashboard.nextOccurrence.courseId)?.name ?? "课程")
                  : "今天课程已经结束"}
              </strong>
              {dashboard.nextOccurrence && (
                <p>
                  {dashboard.nextOccurrence.startTime}–{dashboard.nextOccurrence.endTime} ·{" "}
                  {dashboard.nextOccurrence.room ?? "地点待定"}
                </p>
              )}
            </article>
            <article className="hub-card">
              <h2>今日课程</h2>
              {dashboard.todayOccurrences.length === 0 ? (
                <p>今天没有课程</p>
              ) : (
                dashboard.todayOccurrences.map((item) => (
                  <p key={item.occurrenceKey}>
                    <strong>{courseById.get(item.courseId)?.name ?? "课程"}</strong>{" "}
                    {item.startTime}–{item.endTime}{" "}
                    {item.status !== "NORMAL" && (
                      <em>
                        {item.status === "CANCELLED"
                          ? "停"
                          : item.status === "MAKEUP"
                            ? "补"
                            : "调"}
                      </em>
                    )}
                  </p>
                ))
              )}
            </article>
            <article className="hub-card">
              <h2>Deadline</h2>
              {dashboard.overdueTasks.map((task) => (
                <p className="hub-overdue" key={task.id}>
                  已逾期 · {task.title}
                </p>
              ))}
              {dashboard.dueToday.map((task) => (
                <p key={task.id}>今天 · {task.title}</p>
              ))}
              {dashboard.overdueTasks.length === 0 && dashboard.dueToday.length === 0 && (
                <p>近期没有待办</p>
              )}
            </article>
            <article className="hub-card">
              <h2>最近考试</h2>
              {dashboard.upcomingExam ? (
                <p>
                  <strong>{dashboard.upcomingExam.title}</strong>
                  <br />
                  {new Date(dashboard.upcomingExam.startsAt).toLocaleString("zh-CN")}
                  <br />
                  {dashboard.upcomingExam.location ?? "地点待定"} · 还有{" "}
                  {daysUntil(dashboard.upcomingExam.startsAt)} 天
                </p>
              ) : (
                <p>暂无已安排考试</p>
              )}
            </article>
          </div>
        )}
        {semester && tab === "changes" && (
          <div className="hub-card" data-testid="course-change-page">
            {!changeCourseId ? (
              <>
                <h2>课表变化</h2>
                <p className="hub-muted">
                  先选择课程，再选择具体日期；停课、调课、换教室和补课只影响选中的安排。
                </p>
                {readOnly && (
                  <p className="hub-muted">历史学期默认只读；恢复为当前学期后才能编辑。</p>
                )}
                <div className="hub-change-toolbar">
                  <input
                    value={changeSearch}
                    onChange={(event) => setChangeSearch(event.target.value)}
                    placeholder="搜索课程、教师或地点"
                    aria-label="搜索课程"
                  />
                  <select
                    value={changeFilter}
                    onChange={(event) => setChangeFilter(event.target.value as ChangeFilter)}
                    aria-label="课表变化筛选"
                  >
                    <option value="all">全部课程</option>
                    <option value="changed">有变化</option>
                  </select>
                </div>
                <div className="hub-course-list">
                  {visibleChangeSummaries.length === 0 ? (
                    <p className="hub-empty">没有匹配的课程。</p>
                  ) : (
                    visibleChangeSummaries.map((summary) => (
                      <article className="hub-course-card" key={summary.course.id}>
                        <div className="hub-course-card-main">
                          <h3>{summary.course.name}</h3>
                          <p className="hub-muted">
                            {summary.course.teacher ?? "教师待定"} ·{" "}
                            {summary.course.classroom ?? "地点待定"}
                          </p>
                          <p>
                            {summary.meetings.length === 0
                              ? "暂无固定安排"
                              : summary.meetings
                                  .slice(0, 2)
                                  .map((meeting) =>
                                    formatMeeting(
                                      meeting.weekday,
                                      meeting.startPeriod,
                                      meeting.endPeriod,
                                      meeting.startTime,
                                      meeting.endTime,
                                    ),
                                  )
                                  .join(" · ")}
                          </p>
                          <p className="hub-muted">共 {summary.occurrences.length} 次安排</p>
                        </div>
                        <div className="hub-course-card-actions">
                          {summary.changedCount > 0 && (
                            <span className="hub-change-count">{summary.changedCount} 项变化</span>
                          )}
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() => {
                              setChangeCourseId(summary.course.id);
                              setChangeOccurrenceKey(null);
                              setChangeEditor(null);
                            }}
                          >
                            管理变化
                          </button>
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="hub-detail-header">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setChangeCourseId(null);
                      setChangeOccurrenceKey(null);
                      setChangeEditor(null);
                    }}
                  >
                    返回课程列表
                  </button>
                  <div>
                    <h2>{selectedChangeSummary?.course.name ?? "课程变化"}</h2>
                    <p className="hub-muted">按日期选择要管理的单次课程安排。</p>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={readOnly || !selectedChangeTemplate}
                    onClick={() => {
                      if (!selectedChangeTemplate) return;
                      setChangeOccurrenceKey(selectedChangeTemplate.occurrenceKey);
                      openChangeEditor(selectedChangeTemplate, "MAKEUP");
                    }}
                  >
                    ＋ 添加补课
                  </button>
                </div>
                {selectedChangeSummary && (
                  <>
                    <p className="hub-muted">
                      {selectedChangeSummary.course.teacher ?? "教师待定"} ·{" "}
                      {selectedChangeSummary.course.classroom ?? "地点待定"}
                    </p>
                    <p
                      className="hub-week-status"
                      role="status"
                      aria-label="本周状态"
                      data-testid="course-change-week-status"
                    >
                      {!selectedCourseCurrentWeek || selectedCourseCurrentWeek.length === 0
                        ? "本周无课"
                        : selectedCourseCurrentWeek.every((item) => item.status === "CANCELLED")
                          ? "本周课程已停课"
                          : "本周"}
                    </p>
                    <div className="hub-occurrence-list">
                      {selectedChangeSummary.occurrences.map((item) => {
                        const applied = item.appliedOverrideId
                          ? overrides.find((value) => value.id === item.appliedOverrideId)
                          : undefined;
                        const statusLabel = changeStatusLabel(item);
                        const isSelected = item.occurrenceKey === changeOccurrenceKey;
                        const isOccurrenceBusy = occurrenceBusyKey === item.occurrenceKey;
                        return (
                          <div className="hub-occurrence-item-wrap" key={item.occurrenceKey}>
                            <button
                              type="button"
                              className={`hub-occurrence-item${isSelected ? " is-selected" : ""}`}
                              onClick={() => {
                                setChangeOccurrenceKey(isSelected ? null : item.occurrenceKey);
                                setChangeEditor(null);
                                setOccurrenceMessage("");
                              }}
                            >
                              <span>
                                <strong>{formatChineseDate(item.date)}</strong>
                                <small>
                                  {WEEKDAY_LABELS[item.weekday]} · 第 {item.teachingWeek} 周
                                </small>
                              </span>
                              <span>
                                {item.startTime}–{item.endTime} · {item.room ?? "地点待定"}
                                {item.status === "RESCHEDULED" && applied?.originalDate && (
                                  <small>
                                    原 {formatChineseDate(applied.originalDate)} → 已调至当前日期
                                  </small>
                                )}
                              </span>
                              {statusLabel && <em className="hub-status-badge">{statusLabel}</em>}
                            </button>
                            {isSelected && (
                              <section
                                className="hub-occurrence-actions"
                                aria-label={`${formatChineseDate(item.date)} 本次课程操作`}
                              >
                                <h3>本次课程操作</h3>
                                {occurrenceMessage && (
                                  <p className="hub-operation-message" role="status">
                                    {occurrenceMessage}
                                  </p>
                                )}
                                <p>
                                  {WEEKDAY_LABELS[item.weekday]} · 第 {item.teachingWeek} 周
                                  <br />
                                  原安排：{item.startTime}–{item.endTime} ·{" "}
                                  {item.room ?? "地点待定"}
                                </p>
                                <div className="hub-button-group">
                                  {item.status !== "CANCELLED" && (
                                    <button
                                      type="button"
                                      className="secondary-button"
                                      disabled={readOnly || isOccurrenceBusy}
                                      onClick={() => {
                                        if (
                                          !window.confirm(
                                            "确认只取消这一次课程吗？其他周课程不会受到影响。",
                                          )
                                        )
                                          return;
                                        void runOccurrence(
                                          "cancel",
                                          item.occurrenceKey,
                                          async () => {
                                            const saved = await saveCourseOverride(
                                              makeOverride(item, "CANCEL", null, null, null, null),
                                            );
                                            setOverrides((current) => [...current, saved]);
                                          },
                                          "已停课",
                                        );
                                      }}
                                    >
                                      {isOccurrenceBusy ? "正在停课…" : "本次停课"}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="secondary-button"
                                    disabled={
                                      readOnly || isOccurrenceBusy || item.status === "CANCELLED"
                                    }
                                    onClick={() => openChangeEditor(item, "RESCHEDULE")}
                                  >
                                    调课
                                  </button>
                                  <button
                                    type="button"
                                    className="secondary-button"
                                    disabled={
                                      readOnly || isOccurrenceBusy || item.status === "CANCELLED"
                                    }
                                    onClick={() => openChangeEditor(item, "MODIFY")}
                                  >
                                    换教室
                                  </button>
                                  {item.appliedOverrideId && (
                                    <button
                                      type="button"
                                      className="secondary-button"
                                      disabled={isOccurrenceBusy}
                                      onClick={() =>
                                        void runOccurrence(
                                          "revoke",
                                          item.occurrenceKey,
                                          async () => {
                                            await revokeCourseOverride(
                                              item.appliedOverrideId!,
                                              stamp(),
                                            );
                                            setOverrides((current) =>
                                              current.map((value) =>
                                                value.id === item.appliedOverrideId
                                                  ? { ...value, active: false }
                                                  : value,
                                              ),
                                            );
                                            setChangeEditor(null);
                                          },
                                          "已撤销本次变化",
                                        )
                                      }
                                    >
                                      {item.status === "CANCELLED" ? "撤销停课" : "撤销本次变化"}
                                    </button>
                                  )}
                                </div>
                                {changeEditor?.occurrenceKey === item.occurrenceKey && (
                                  <form
                                    className="hub-change-editor"
                                    onSubmit={(event) => {
                                      event.preventDefault();
                                      submitChangeEditor(item);
                                    }}
                                  >
                                    {changeEditor.kind !== "MODIFY" && (
                                      <ChineseDateInput
                                        value={changeEditor.targetDate}
                                        onChange={(value) =>
                                          updateChangeEditor({ targetDate: value })
                                        }
                                        ariaLabel={
                                          changeEditor.kind === "MAKEUP" ? "补课日期" : "调课日期"
                                        }
                                        disabled={isOccurrenceBusy}
                                      />
                                    )}
                                    {changeEditor.kind !== "MODIFY" && (
                                      <input
                                        type="time"
                                        value={changeEditor.startTime}
                                        onChange={(event) =>
                                          updateChangeEditor({ startTime: event.target.value })
                                        }
                                        aria-label={
                                          changeEditor.kind === "MAKEUP"
                                            ? "补课开始时间"
                                            : "调课开始时间"
                                        }
                                        disabled={isOccurrenceBusy}
                                      />
                                    )}
                                    {changeEditor.kind !== "MODIFY" && (
                                      <input
                                        type="time"
                                        value={changeEditor.endTime}
                                        onChange={(event) =>
                                          updateChangeEditor({ endTime: event.target.value })
                                        }
                                        aria-label={
                                          changeEditor.kind === "MAKEUP"
                                            ? "补课结束时间"
                                            : "调课结束时间"
                                        }
                                        disabled={isOccurrenceBusy}
                                      />
                                    )}
                                    <input
                                      value={changeEditor.room}
                                      onChange={(event) =>
                                        updateChangeEditor({ room: event.target.value })
                                      }
                                      placeholder={
                                        changeEditor.kind === "MODIFY" ? "新教室" : "教室（可选）"
                                      }
                                      aria-label={
                                        changeEditor.kind === "MODIFY" ? "新教室" : "教室"
                                      }
                                      disabled={isOccurrenceBusy}
                                    />
                                    <button
                                      type="submit"
                                      className="primary-button"
                                      disabled={
                                        isOccurrenceBusy ||
                                        (changeEditor.kind !== "MODIFY" &&
                                          (!changeEditor.targetDate ||
                                            !changeEditor.startTime ||
                                            !changeEditor.endTime)) ||
                                        (changeEditor.kind === "MODIFY" &&
                                          !changeEditor.room.trim())
                                      }
                                    >
                                      保存
                                      {changeEditor.kind === "RESCHEDULE"
                                        ? "调课"
                                        : changeEditor.kind === "MAKEUP"
                                          ? "补课"
                                          : "教室"}
                                    </button>
                                    <button
                                      type="button"
                                      className="secondary-button"
                                      disabled={isOccurrenceBusy}
                                      onClick={() => setChangeEditor(null)}
                                    >
                                      取消
                                    </button>
                                  </form>
                                )}
                              </section>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
        {semester && tab === "tasks" && (
          <div className="hub-card">
            <h2>学习事项</h2>
            {taskForm}
            <div className="hub-list">
              {tasks.map((task) => (
                <div
                  className={`hub-list-row${task.status === "COMPLETED" ? " is-complete" : ""}`}
                  key={task.id}
                >
                  <span>
                    <strong>{task.title}</strong>
                    <small>
                      {new Date(task.dueAt).toLocaleString("zh-CN")}
                      {task.courseId ? ` · ${courseById.get(task.courseId)?.name ?? "课程"}` : ""}
                    </small>
                  </span>
                  <span>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || readOnly}
                      onClick={() => {
                        setEditingTaskId(task.id);
                        setTaskTitle(task.title);
                        setTaskDueAt(localDateTimeValue(task.dueAt));
                        setTaskType(task.type);
                        setTaskCourseId(task.courseId ?? "");
                      }}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || readOnly}
                      onClick={() =>
                        void run(
                          async () => {
                            const saved = await saveAcademicTask({
                              ...task,
                              status: task.status === "COMPLETED" ? "TODO" : "COMPLETED",
                              completedAt: task.status === "COMPLETED" ? null : stamp(),
                              updatedAt: stamp(),
                            });
                            setTasks((current) =>
                              current.map((item) => (item.id === task.id ? saved : item)),
                            );
                          },
                          task.status === "COMPLETED" ? "已恢复待办" : "已完成",
                        )
                      }
                    >
                      {task.status === "COMPLETED" ? "恢复" : "完成"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || readOnly}
                      onClick={() =>
                        void run(async () => {
                          await deleteAcademicTask(task.id);
                          setTasks((current) => current.filter((item) => item.id !== task.id));
                        }, "已删除")
                      }
                    >
                      删除
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {semester && tab === "exams" && (
          <div className="hub-card">
            <h2>考试</h2>
            {examForm}
            <div className="hub-list">
              {exams.map((exam) => (
                <div className="hub-list-row" key={exam.id}>
                  <span>
                    <strong>{exam.title}</strong>
                    <small>
                      {new Date(exam.startsAt).toLocaleString("zh-CN")} ·{" "}
                      {exam.location ?? "地点待定"}
                      {exam.courseId ? ` · ${courseById.get(exam.courseId)?.name ?? "课程"}` : ""}
                    </small>
                  </span>
                  <span>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || readOnly}
                      onClick={() => {
                        setEditingExamId(exam.id);
                        setExamTitle(exam.title);
                        setExamStartsAt(localDateTimeValue(exam.startsAt));
                        setExamLocation(exam.location ?? "");
                        setExamCourseId(exam.courseId ?? "");
                      }}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy || readOnly}
                      onClick={() =>
                        void run(async () => {
                          await deleteExam(exam.id);
                          setExams((current) => current.filter((item) => item.id !== exam.id));
                        }, "已删除")
                      }
                    >
                      删除
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab === "semesters" && (
          <div className="hub-card">
            <h2>学期管理</h2>
            <p>当前学期：{semester?.name ?? "未配置"}</p>
            {semesters.map((item) => (
              <div className="hub-list-row" key={item.id}>
                <span>
                  {item.name} · {item.firstWeekMonday} ·{" "}
                  {item.status === "ACTIVE" ? "当前" : "历史归档"}
                </span>
                {item.status === "ACTIVE" ? (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await archiveSemester(item.id, stamp());
                        const archived = {
                          ...item,
                          status: "ARCHIVED" as const,
                          updatedAt: stamp(),
                        };
                        setSemesters((current) =>
                          current.map((value) => (value.id === item.id ? archived : value)),
                        );
                        setSemester(null);
                      }, "学期已归档")
                    }
                  >
                    归档
                  </button>
                ) : (
                  <span className="hub-button-group">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setSemester(item);
                        setTab("today");
                      }}
                    >
                      查看历史
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const restored = await saveSemester({
                            ...item,
                            status: "ACTIVE",
                            updatedAt: stamp(),
                          });
                          refreshSemester(restored);
                        }, "已恢复为当前学期")
                      }
                    >
                      恢复为当前
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
