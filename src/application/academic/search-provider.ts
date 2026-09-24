import {
  createAcademicTaskTarget,
  createCourseTarget,
  createExamTarget,
} from "../../navigation/navigation.ts";
import { createWorkspaceSearchRecord, searchDatePart } from "../../modules/search-record.ts";
import type { WorkspaceSearchRecord } from "../../modules/search-contract.ts";
import type { SearchProvider } from "../../modules/search-provider-registry.ts";
import { loadAcademicSearchData } from "./academic-application.ts";
import type { AcademicSearchData } from "./academic-application.ts";

export function buildAcademicSearchRecords(
  data: AcademicSearchData,
): readonly WorkspaceSearchRecord[] {
  const courseNames = new Map(data.schedule.courses.map((course) => [course.id, course.name]));
  const records: WorkspaceSearchRecord[] = [];
  let courseOrder = 0;
  for (const course of data.schedule.courses) {
    records.push(
      createWorkspaceSearchRecord({
        id: course.id,
        category: "course",
        categoryLabel: "课程",
        title: course.name,
        summary: [course.teacher, course.classroom].filter(Boolean).join(" · "),
        target: createCourseTarget(course.id),
        updatedAt: "",
        activeRank: 0,
        sourceRank: courseOrder++,
        metadata: [course.teacher, course.classroom, `周${course.weekday}`]
          .filter(Boolean)
          .join(" "),
      }),
    );
  }

  let taskOrder = 0;
  for (const task of data.tasks) {
    records.push(
      createWorkspaceSearchRecord({
        id: task.id,
        category: "academicTask",
        categoryLabel: "学业事项",
        title: task.title,
        summary: [courseNames.get(task.courseId ?? ""), searchDatePart(task.dueAt)]
          .filter(Boolean)
          .join(" · "),
        target: createAcademicTaskTarget(task.id),
        updatedAt: task.updatedAt,
        activeRank: task.status === "TODO" ? 0 : 1,
        sourceRank: 10_000 + taskOrder++,
        metadata: [courseNames.get(task.courseId ?? ""), task.type, task.dueAt]
          .filter(Boolean)
          .join(" "),
        body: task.note ?? "",
      }),
    );
  }

  let examOrder = 0;
  for (const exam of data.exams) {
    records.push(
      createWorkspaceSearchRecord({
        id: exam.id,
        category: "exam",
        categoryLabel: "考试",
        title: exam.title,
        summary: [searchDatePart(exam.startsAt), exam.location].filter(Boolean).join(" · "),
        target: createExamTarget(exam.id),
        updatedAt: exam.updatedAt,
        activeRank: exam.status === "SCHEDULED" ? 0 : 1,
        sourceRank: 50_000 + examOrder++,
        metadata: [
          courseNames.get(exam.courseId ?? ""),
          exam.startsAt,
          exam.location,
          exam.seatInfo,
        ]
          .filter(Boolean)
          .join(" "),
        body: exam.note ?? "",
      }),
    );
  }
  return records;
}

export const academicSearchProvider: SearchProvider = Object.freeze({
  id: "academic.search",
  moduleId: "academic",
  order: 10,
  async loadIndex() {
    return buildAcademicSearchRecords(await loadAcademicSearchData());
  },
});
