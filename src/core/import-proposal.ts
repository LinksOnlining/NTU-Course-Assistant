import type { Course } from "../types/course.ts";
import type {
  ImportCandidate,
  ImportCandidateEdit,
  ImportIssue,
  ImportIssueCode,
  ImportIssueField,
} from "../types/import-candidate.ts";
import type {
  CandidateEvaluation,
  CourseProposal,
  ImportEvaluation,
  ImportPlan,
  ProposedCourse,
} from "../types/import-proposal.ts";
import type { PeriodTime } from "../types/time.ts";
import { validateCourseInput } from "./course-input.ts";
import { periodRangeToTimeRange } from "./period-time.ts";
import { coursesOverlap } from "./timetable-layout.ts";
import { formatWeeks } from "./weeks.ts";

function issue(
  code: ImportIssueCode,
  field: ImportIssueField,
  severity: ImportIssue["severity"],
  message: string,
): ImportIssue {
  return { code, field, severity, message };
}

function appendIssue(issues: ImportIssue[], next: ImportIssue): void {
  if (!issues.some((current) => current.code === next.code && current.field === next.field)) {
    issues.push(next);
  }
}

function evaluationStatus(issues: readonly ImportIssue[]): CandidateEvaluation["status"] {
  if (issues.some((current) => current.severity === "blocking")) return "blocking";
  return issues.some((current) => current.severity === "warning") ? "warning" : "ready";
}

/** Apply reviewed values without mutating or replacing the parser-owned source metadata. */
export function applyImportCandidateEdit(
  original: ImportCandidate,
  edit: ImportCandidateEdit | undefined,
): ImportCandidate {
  if (edit === undefined) return original;
  return {
    ...original,
    ...edit,
    resolvedTime: null,
  };
}

function validationIssues(errors: Readonly<Record<string, string | undefined>>): ImportIssue[] {
  const issues: ImportIssue[] = [];
  for (const [field, message] of Object.entries(errors)) {
    if (message === undefined) continue;
    const ownedField: ImportIssueField =
      field === "name" ||
      field === "teacher" ||
      field === "classroom" ||
      field === "weekday" ||
      field === "weeks"
        ? field
        : field === "startTime" || field === "endTime"
          ? "time"
          : "course";
    appendIssue(issues, issue("invalid-candidate", ownedField, "blocking", message));
  }
  return issues;
}

/**
 * Convert one reviewed candidate through the shared Course validation boundary.
 * The temporary validation ID is discarded and never becomes a persisted Course ID.
 */
export function prepareCourseProposal(
  candidate: ImportCandidate,
  periods: readonly PeriodTime[],
  isUsingTestSchedule: boolean,
): CandidateEvaluation {
  const issues: ImportIssue[] = candidate.issues.filter(
    (current) => current.code === "ambiguous-source",
  );
  let resolvedTime = null;
  let weeksText: string | null = null;

  if (candidate.name === null || candidate.name.trim() === "") {
    appendIssue(issues, issue("missing-name", "name", "blocking", "请补充课程名称。"));
  }
  if (candidate.weekday === null) {
    appendIssue(issues, issue("missing-weekday", "weekday", "blocking", "请选择上课星期。"));
  }
  if (candidate.startPeriod === null || candidate.endPeriod === null) {
    appendIssue(
      issues,
      issue("missing-period", "periods", "blocking", "请选择完整的开始和结束节次。"),
    );
  } else if (
    !Number.isInteger(candidate.startPeriod) ||
    !Number.isInteger(candidate.endPeriod) ||
    candidate.startPeriod <= 0 ||
    candidate.endPeriod < candidate.startPeriod
  ) {
    appendIssue(
      issues,
      issue("invalid-candidate", "periods", "blocking", "节次必须是递增的正整数。"),
    );
  } else {
    resolvedTime = periodRangeToTimeRange(
      { startPeriod: candidate.startPeriod, endPeriod: candidate.endPeriod },
      periods,
    );
    if (resolvedTime === null) {
      appendIssue(
        issues,
        issue("period-not-mapped", "time", "blocking", "当前作息无法映射这段节次。"),
      );
    } else if (isUsingTestSchedule) {
      appendIssue(issues, issue("test-schedule", "time", "blocking", "请先确认并保存实际作息。"));
    }
  }
  if (candidate.weeks === null || candidate.weeks.length === 0) {
    appendIssue(issues, issue("invalid-weeks", "weeks", "blocking", "请填写有效上课周数。"));
  } else {
    try {
      weeksText = formatWeeks(candidate.weeks);
    } catch (caught: unknown) {
      appendIssue(
        issues,
        issue(
          "invalid-weeks",
          "weeks",
          "blocking",
          caught instanceof RangeError ? caught.message : "请填写有效上课周数。",
        ),
      );
    }
  }
  if (candidate.classroom === null || candidate.classroom.trim() === "") {
    appendIssue(
      issues,
      issue(
        candidate.source.text.includes("未排地点") ? "unassigned-classroom" : "missing-classroom",
        "classroom",
        "warning",
        candidate.source.text.includes("未排地点")
          ? "PDF 标记为未排地点，可稍后补充。"
          : "未填写教室，可继续但建议核对。",
      ),
    );
  }
  if (candidate.teacher === null || candidate.teacher.trim() === "") {
    appendIssue(
      issues,
      issue("missing-teacher", "teacher", "warning", "未填写教师，可继续但建议核对。"),
    );
  }

  let proposal: CourseProposal | null = null;
  if (
    candidate.name !== null &&
    candidate.weekday !== null &&
    candidate.startPeriod !== null &&
    candidate.endPeriod !== null &&
    candidate.weeks !== null &&
    weeksText !== null &&
    resolvedTime !== null &&
    !isUsingTestSchedule
  ) {
    const validation = validateCourseInput(
      {
        name: candidate.name,
        teacher: candidate.teacher ?? "",
        classroom: candidate.classroom ?? "",
        weekday: candidate.weekday,
        startTime: resolvedTime.startTime,
        endTime: resolvedTime.endTime,
        weeks: weeksText,
      },
      `proposal:${candidate.id}`,
    );
    if (validation.ok) {
      const { id: discardedId, ...validated } = validation.course;
      void discardedId;
      proposal = {
        candidateId: candidate.id,
        course: {
          ...validated,
          startPeriod: candidate.startPeriod,
          endPeriod: candidate.endPeriod,
        },
      };
    } else {
      for (const validationIssue of validationIssues(validation.errors)) {
        appendIssue(issues, validationIssue);
      }
    }
  }

  return {
    candidate,
    resolvedTime,
    proposal,
    issues,
    status: evaluationStatus(issues),
  };
}

function proposalAsCourse(proposal: CourseProposal): Course {
  return { id: `proposal:${proposal.candidateId}`, ...proposal.course };
}

function courseScheduleKey(course: ProposedCourse | Course): string {
  return [
    course.name,
    course.weekday,
    course.startTime,
    course.endTime,
    course.weeks.join(","),
  ].join("\u0000");
}

function duplicateKey(proposal: CourseProposal): string {
  return courseScheduleKey(proposal.course);
}

/** Prepare all candidates and add non-blocking exact-duplicate and overlap diagnostics. */
export function evaluateImportCandidates(
  candidates: readonly ImportCandidate[],
  periods: readonly PeriodTime[],
  isUsingTestSchedule: boolean,
  existingCourses: readonly Course[],
): ImportEvaluation {
  const prepared = candidates.map((candidate) =>
    prepareCourseProposal(candidate, periods, isUsingTestSchedule),
  );
  const evaluations = prepared.map((entry, index): CandidateEvaluation => {
    if (entry.proposal === null) return entry;
    const issues = [...entry.issues];
    const current = proposalAsCourse(entry.proposal);
    const key = duplicateKey(entry.proposal);
    const exactExisting = existingCourses.some(
      (course) =>
        [
          course.name,
          course.weekday,
          course.startTime,
          course.endTime,
          course.weeks.join(","),
        ].join("\u0000") === key,
    );
    const exactCandidate = prepared.some(
      (other, otherIndex) =>
        otherIndex !== index && other.proposal !== null && duplicateKey(other.proposal) === key,
    );
    if (exactExisting || exactCandidate) {
      appendIssue(
        issues,
        issue("duplicate-course", "course", "warning", "存在名称、时间和周数完全相同的课程。"),
      );
    }
    const conflictsExisting = existingCourses.some((course) => {
      const courseKey = [
        course.name,
        course.weekday,
        course.startTime,
        course.endTime,
        course.weeks.join(","),
      ].join("\u0000");
      return courseKey !== key && coursesOverlap(current, course);
    });
    const conflictsCandidate = prepared.some((other, otherIndex) => {
      if (otherIndex === index || other.proposal === null || duplicateKey(other.proposal) === key) {
        return false;
      }
      return coursesOverlap(current, proposalAsCourse(other.proposal));
    });
    if (conflictsExisting || conflictsCandidate) {
      appendIssue(
        issues,
        issue("schedule-conflict", "course", "warning", "该安排与另一门课程时间重叠。"),
      );
    }
    return { ...entry, issues, status: evaluationStatus(issues) };
  });
  const count = (status: CandidateEvaluation["status"]) =>
    evaluations.filter((entry) => entry.status === status).length;
  const summary = {
    total: evaluations.length,
    fixed: evaluations.filter((entry) => entry.candidate.kind === "fixed").length,
    practice: evaluations.filter((entry) => entry.candidate.kind === "practice").length,
    ready: count("ready"),
    warning: count("warning"),
    blocking: count("blocking"),
    proposalCount: evaluations.filter((entry) => entry.proposal !== null).length,
  };
  return {
    candidates: evaluations,
    summary,
    canContinue: summary.total > 0 && summary.blocking === 0,
  };
}

/**
 * Decide exact duplicate skips and schedule conflicts without allocating IDs or mutating inputs.
 * The first occurrence of a repeated proposal wins, which keeps results stable across runs.
 */
export function prepareImportPlan(
  proposals: readonly CourseProposal[],
  existingCourses: readonly Course[],
): ImportPlan {
  const existingKeys = new Set(existingCourses.map(courseScheduleKey));
  const acceptedKeys = new Set<string>();
  const acceptedCourses: Course[] = [];
  const entries = proposals.map((proposal) => {
    const key = duplicateKey(proposal);
    const duplicateSource = existingKeys.has(key)
      ? ("existing" as const)
      : acceptedKeys.has(key)
        ? ("proposal" as const)
        : null;
    if (duplicateSource !== null) {
      return {
        proposal,
        action: "skip-duplicate" as const,
        duplicateSource,
        hasConflict: false,
      };
    }

    const current = proposalAsCourse(proposal);
    const hasConflict = [...existingCourses, ...acceptedCourses].some(
      (other) => courseScheduleKey(other) !== key && coursesOverlap(current, other),
    );
    acceptedKeys.add(key);
    acceptedCourses.push(current);
    return { proposal, action: "insert" as const, duplicateSource: null, hasConflict };
  });
  const toInsert = entries
    .filter((entry) => entry.action === "insert")
    .map((entry) => entry.proposal);
  return {
    entries,
    toInsert,
    summary: {
      total: entries.length,
      toInsert: toInsert.length,
      skippedDuplicates: entries.length - toInsert.length,
      conflicts: entries.filter((entry) => entry.action === "insert" && entry.hasConflict).length,
    },
  };
}

/** Allocate final IDs once and pass every proposal through the shared validation boundary again. */
export function materializeImportCourses(
  plan: ImportPlan,
  createId: () => string,
): readonly Course[] {
  const ids = new Set<string>();
  return plan.toInsert.map((proposal) => {
    const id = createId();
    if (id.trim() === "" || id.trim() !== id || ids.has(id)) {
      throw new RangeError("无法为导入课程生成唯一 ID。");
    }
    ids.add(id);
    const source = proposal.course;
    const validation = validateCourseInput(
      {
        name: source.name,
        teacher: source.teacher ?? "",
        classroom: source.classroom ?? "",
        weekday: source.weekday,
        startTime: source.startTime,
        endTime: source.endTime,
        weeks: formatWeeks(source.weeks),
      },
      id,
    );
    if (!validation.ok) {
      const message = Object.values(validation.errors).find(
        (current): current is string => current !== undefined,
      );
      throw new RangeError(message ?? "课程提案在最终校验中失败。");
    }
    return {
      ...validation.course,
      startPeriod: source.startPeriod,
      endPeriod: source.endPeriod,
    };
  });
}
