import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyImportCandidateEdit,
  evaluateImportCandidates,
  materializeImportCourses,
  prepareCourseProposal,
  prepareImportPlan,
} from "../../src/core/import-proposal.ts";

const periods = Array.from({ length: 8 }, (_, index) => {
  const hour = 8 + index;
  return {
    period: index + 1,
    startTime: `${String(hour).padStart(2, "0")}:00`,
    endTime: `${String(hour).padStart(2, "0")}:45`,
  };
});

function candidate(changes = {}) {
  return {
    id: "candidate-1",
    kind: "fixed",
    name: "结构基础",
    teacher: "教师甲",
    classroom: "JX01-101",
    weekday: 1,
    startPeriod: 1,
    endPeriod: 2,
    weeks: [1, 2, 3, 4],
    resolvedTime: null,
    source: {
      page: 1,
      text: "结构基础 (1-2节)1-4周 场地:JX01-101",
      bounds: { x: 10, y: 20, width: 30, height: 40 },
      items: [],
    },
    issues: [],
    ...changes,
  };
}

test("a fixed candidate and confirmed periods produce a validated ID-free proposal", () => {
  const result = prepareCourseProposal(candidate(), periods, false);
  assert.equal(result.status, "ready");
  assert.deepEqual(result.proposal, {
    candidateId: "candidate-1",
    course: {
      name: "结构基础",
      teacher: "教师甲",
      classroom: "JX01-101",
      weekday: 1,
      startPeriod: 1,
      endPeriod: 2,
      startTime: "08:00",
      endTime: "09:45",
      weeks: [1, 2, 3, 4],
    },
  });
  assert.equal("id" in result.proposal.course, false);
});

test("test-only periods block readiness and never produce a proposal", () => {
  const result = prepareCourseProposal(candidate(), periods, true);
  assert.equal(result.status, "blocking");
  assert.equal(result.proposal, null);
  assert(result.issues.some((current) => current.code === "test-schedule"));
});

test("a non-fixed practice becomes ready only after explicit weekday and period edits", () => {
  const original = candidate({
    kind: "practice",
    weekday: null,
    startPeriod: null,
    endPeriod: null,
    weeks: [17],
  });
  assert.equal(prepareCourseProposal(original, periods, false).status, "blocking");
  const edited = applyImportCandidateEdit(original, {
    name: "生产实习",
    teacher: "教师甲",
    classroom: "实训中心",
    weekday: 3,
    startPeriod: 6,
    endPeriod: 8,
    weeks: [1, 2],
  });
  const result = prepareCourseProposal(edited, periods, false);
  assert.equal(result.status, "ready");
  assert.equal(result.proposal?.course.weekday, 3);
  assert.equal(result.proposal?.course.startTime, "13:00");
  assert.equal(result.proposal?.course.endTime, "15:45");
  assert.equal(original.weekday, null);
});

test("a missing classroom remains a warning but allows a proposal", () => {
  const result = prepareCourseProposal(candidate({ classroom: null }), periods, false);
  assert.equal(result.status, "warning");
  assert(result.proposal);
  assert(result.issues.some((current) => current.code === "missing-classroom"));
  const evaluation = evaluateImportCandidates([candidate({ classroom: null })], periods, false, []);
  assert.equal(evaluation.canContinue, true);
});

test("invalid candidate period and week values become blocking issues instead of throwing", () => {
  const result = prepareCourseProposal(candidate({ startPeriod: 0, weeks: [31] }), periods, false);
  assert.equal(result.status, "blocking");
  assert.equal(result.proposal, null);
  assert(result.issues.some((current) => current.field === "periods"));
  assert(result.issues.some((current) => current.code === "invalid-weeks"));
});

test("canceling an edit preserves the exact original candidate", () => {
  const original = candidate();
  const draft = applyImportCandidateEdit(original, {
    name: "临时名称",
    teacher: null,
    classroom: null,
    weekday: 3,
    startPeriod: 6,
    endPeriod: 8,
    weeks: [2],
  });
  assert.equal(draft.name, "临时名称");
  assert.strictEqual(applyImportCandidateEdit(original, undefined), original);
  assert.equal(original.name, "结构基础");
});

test("overlap with an existing course adds a non-blocking warning", () => {
  const existing = {
    id: "existing",
    name: "其他课程",
    teacher: null,
    classroom: null,
    weekday: 1,
    startPeriod: null,
    endPeriod: null,
    startTime: "09:00",
    endTime: "10:00",
    weeks: [1, 2],
  };
  const overlappingCandidate = candidate({ id: "candidate-2", name: "候选间冲突" });
  const result = evaluateImportCandidates([candidate(), overlappingCandidate], periods, false, [
    existing,
  ]);
  assert.equal(result.candidates[0].status, "warning");
  assert(result.candidates[0].issues.some((current) => current.code === "schedule-conflict"));
  assert(result.candidates[1].issues.some((current) => current.code === "schedule-conflict"));
});

test("only an exact name, schedule and weeks match is treated as a duplicate", () => {
  const first = candidate();
  const exact = candidate({ id: "candidate-2" });
  const differentWeeks = candidate({ id: "candidate-3", weeks: [5, 6] });
  const differentTime = candidate({ id: "candidate-4", startPeriod: 3, endPeriod: 3 });
  const evaluated = evaluateImportCandidates(
    [first, exact, differentWeeks, differentTime],
    periods,
    false,
    [],
  );
  assert(evaluated.candidates[0].issues.some((current) => current.code === "duplicate-course"));
  assert(evaluated.candidates[1].issues.some((current) => current.code === "duplicate-course"));
  assert(!evaluated.candidates[2].issues.some((current) => current.code === "duplicate-course"));
  assert(!evaluated.candidates[3].issues.some((current) => current.code === "duplicate-course"));
});

test("candidate evaluation is deterministic and leaves its inputs untouched", () => {
  const input = [candidate(), candidate({ id: "candidate-2", weekday: 3 })];
  const snapshot = structuredClone(input);
  assert.deepEqual(
    evaluateImportCandidates(input, periods, false, []),
    evaluateImportCandidates(input, periods, false, []),
  );
  assert.deepEqual(input, snapshot);
});

test("import plan skips exact existing and repeated proposal schedules deterministically", () => {
  const proposals = [
    prepareCourseProposal(candidate(), periods, false).proposal,
    prepareCourseProposal(candidate({ id: "candidate-2" }), periods, false).proposal,
    prepareCourseProposal(
      candidate({ id: "candidate-3", name: "同名不同时间", startPeriod: 3, endPeriod: 3 }),
      periods,
      false,
    ).proposal,
  ].filter(Boolean);
  const existing = [{ id: "existing", ...proposals[0].course }];
  const plan = prepareImportPlan(proposals, existing);
  assert.deepEqual(plan.summary, {
    total: 3,
    toInsert: 1,
    skippedDuplicates: 2,
    conflicts: 0,
  });
  assert.deepEqual(
    plan.entries.map((entry) => [entry.action, entry.duplicateSource]),
    [
      ["skip-duplicate", "existing"],
      ["skip-duplicate", "existing"],
      ["insert", null],
    ],
  );
  assert.deepEqual(prepareImportPlan(proposals, existing), plan);
});

test("same-name schedules at different times insert while real overlaps stay warnings", () => {
  const base = prepareCourseProposal(candidate(), periods, false).proposal;
  const overlap = prepareCourseProposal(
    candidate({ id: "candidate-2", startPeriod: 2, endPeriod: 3 }),
    periods,
    false,
  ).proposal;
  const separate = prepareCourseProposal(
    candidate({ id: "candidate-3", startPeriod: 4, endPeriod: 4 }),
    periods,
    false,
  ).proposal;
  const plan = prepareImportPlan([base, overlap, separate].filter(Boolean), []);
  assert.equal(plan.summary.toInsert, 3);
  assert.equal(plan.summary.conflicts, 1);
  assert.deepEqual(
    plan.entries.map((entry) => entry.hasConflict),
    [false, true, false],
  );
});

test("final materialization allocates one stable ID per insert and revalidates fields", () => {
  const proposal = prepareCourseProposal(candidate(), periods, false).proposal;
  const plan = prepareImportPlan([proposal].filter(Boolean), []);
  let calls = 0;
  const courses = materializeImportCourses(plan, () => `final-id-${++calls}`);
  assert.equal(calls, 1);
  assert.deepEqual(courses, [{ id: "final-id-1", ...proposal.course }]);
  assert.equal(courses[0].startPeriod, 1);
  assert.equal(courses[0].endPeriod, 2);
});

test("final materialization rejects duplicate generated IDs before persistence", () => {
  const first = prepareCourseProposal(candidate(), periods, false).proposal;
  const second = prepareCourseProposal(
    candidate({ id: "candidate-2", weekday: 2 }),
    periods,
    false,
  ).proposal;
  const plan = prepareImportPlan([first, second].filter(Boolean), []);
  assert.throws(() => materializeImportCourses(plan, () => "same-id"), /唯一 ID/u);
});
