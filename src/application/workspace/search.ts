import { loadAcademicSearchData, type AcademicSearchData } from "../academic/index.ts";
import { loadPersonalTasks } from "../planner/personal-tasks.ts";
import { loadAllPlannerEventsForSearch } from "../../services/planner-storage.ts";
import { loadDiaryEntriesForSearch } from "../../services/diary-storage.ts";
import { loadInboxItems } from "../../services/inbox-storage.ts";
import {
  createAcademicTaskTarget,
  createCourseTarget,
  createDiaryEntryTarget,
  createExamTarget,
  createInboxItemTarget,
  createPlannerEventTarget,
  createPersonalTaskTarget,
} from "../../navigation/navigation.ts";
import type { NavigationTarget } from "../../navigation/types.ts";
import type { DiaryEntry } from "../../types/diary.ts";
import type { InboxItem } from "../../types/inbox.ts";
import type { PersonalTask } from "../../types/personal-task.ts";
import type { PlannerEvent } from "../../types/planner.ts";

export type WorkspaceSearchCategory =
  "course" | "academicTask" | "personalTask" | "plannerEvent" | "exam" | "diaryEntry" | "inboxItem";

export interface WorkspaceSearchItem {
  readonly id: string;
  readonly category: WorkspaceSearchCategory;
  readonly categoryLabel: string;
  readonly title: string;
  readonly summary: string;
  readonly target: NavigationTarget;
}

interface SearchRecord extends WorkspaceSearchItem {
  readonly updatedAt: string;
  readonly activeRank: number;
  readonly sourceRank: number;
  readonly titleText: string;
  readonly metadataText: string;
  readonly bodyText: string;
}

export interface WorkspaceSearchData {
  readonly academic: AcademicSearchData;
  readonly personalTasks: readonly PersonalTask[];
  readonly plannerEvents: readonly PlannerEvent[];
  readonly diaryEntries: readonly DiaryEntry[];
  readonly inboxItems: readonly InboxItem[];
}

export interface WorkspaceSearchReader {
  loadAcademic(): Promise<AcademicSearchData>;
  loadPersonalTasks(): Promise<readonly PersonalTask[]>;
  loadPlannerEvents(): Promise<readonly PlannerEvent[]>;
  loadDiaryEntries(): Promise<readonly DiaryEntry[]>;
  loadInboxItems(): Promise<readonly InboxItem[]>;
}

const defaultReader: WorkspaceSearchReader = {
  loadAcademic: loadAcademicSearchData,
  loadPersonalTasks,
  loadPlannerEvents: loadAllPlannerEventsForSearch,
  loadDiaryEntries: loadDiaryEntriesForSearch,
  loadInboxItems,
};

export async function loadWorkspaceSearchData(
  reader: WorkspaceSearchReader = defaultReader,
): Promise<WorkspaceSearchData> {
  const [academic, personalTasks, plannerEvents, diaryEntries, inboxItems] = await Promise.all([
    reader.loadAcademic(),
    reader.loadPersonalTasks(),
    reader.loadPlannerEvents(),
    reader.loadDiaryEntries(),
    reader.loadInboxItems(),
  ]);
  return { academic, personalTasks, plannerEvents, diaryEntries, inboxItems };
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN").replace(/\s+/gu, " ");
}

function snippet(value: string, maximum = 100): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  const characters = [...compact];
  return characters.length <= maximum ? compact : `${characters.slice(0, maximum).join("")}…`;
}

function datePart(value: string): string {
  return value.slice(0, 10);
}

function item(
  value: Omit<SearchRecord, "titleText" | "metadataText" | "bodyText"> & {
    readonly metadata?: string;
    readonly body?: string;
    readonly sourceRank: number;
  },
): SearchRecord {
  return {
    ...value,
    titleText: value.title,
    metadataText: value.metadata ?? "",
    bodyText: value.body ?? "",
  };
}

function createIndex(data: WorkspaceSearchData): readonly SearchRecord[] {
  const courseNames = new Map(
    data.academic.schedule.courses.map((course) => [course.id, course.name]),
  );
  const results: SearchRecord[] = [];
  let sourceRank = 0;

  for (const course of data.academic.schedule.courses) {
    results.push(
      item({
        id: course.id,
        category: "course",
        categoryLabel: "课程",
        title: course.name,
        summary: [course.teacher, course.classroom].filter(Boolean).join(" · "),
        target: createCourseTarget(course.id),
        updatedAt: "",
        activeRank: 0,
        sourceRank: sourceRank++,
        metadata: [course.teacher, course.classroom, `周${course.weekday}`]
          .filter(Boolean)
          .join(" "),
      }),
    );
  }

  for (const task of data.academic.tasks) {
    results.push(
      item({
        id: task.id,
        category: "academicTask",
        categoryLabel: "学业事项",
        title: task.title,
        summary: [courseNames.get(task.courseId ?? ""), datePart(task.dueAt)]
          .filter(Boolean)
          .join(" · "),
        target: createAcademicTaskTarget(task.id),
        updatedAt: task.updatedAt,
        activeRank: task.status === "TODO" ? 0 : 1,
        sourceRank: sourceRank++,
        metadata: [courseNames.get(task.courseId ?? ""), task.type, task.dueAt]
          .filter(Boolean)
          .join(" "),
        body: task.note ?? "",
      }),
    );
  }

  for (const task of data.personalTasks) {
    results.push(
      item({
        id: task.id,
        category: "personalTask",
        categoryLabel: "个人任务",
        title: task.title,
        summary: task.deadlineDate ? `截止 ${task.deadlineDate}` : "个人任务",
        target: createPersonalTaskTarget(task.id),
        updatedAt: task.updatedAt,
        activeRank: task.status === "open" ? 0 : 1,
        sourceRank: sourceRank++,
        metadata: [task.priority, task.deadlineDate, task.deadlineTime].filter(Boolean).join(" "),
        body: task.description ?? "",
      }),
    );
  }

  for (const event of data.plannerEvents) {
    results.push(
      item({
        id: event.id,
        category: "plannerEvent",
        categoryLabel: "日程",
        title: event.title,
        summary: [event.date, `${event.startTime}–${event.endTime}`, event.location]
          .filter(Boolean)
          .join(" · "),
        target: createPlannerEventTarget(event.id, event.date),
        updatedAt: event.updatedAt,
        activeRank: 0,
        sourceRank: sourceRank++,
        metadata: [event.date, event.startTime, event.endTime, event.location]
          .filter(Boolean)
          .join(" "),
        body: event.description ?? "",
      }),
    );
  }

  for (const exam of data.academic.exams) {
    results.push(
      item({
        id: exam.id,
        category: "exam",
        categoryLabel: "考试",
        title: exam.title,
        summary: [datePart(exam.startsAt), exam.location].filter(Boolean).join(" · "),
        target: createExamTarget(exam.id),
        updatedAt: exam.updatedAt,
        activeRank: exam.status === "SCHEDULED" ? 0 : 1,
        sourceRank: sourceRank++,
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

  for (const entry of data.diaryEntries) {
    results.push(
      item({
        id: entry.id,
        category: "diaryEntry",
        categoryLabel: "日记",
        title: `日记 · ${entry.entryDate}`,
        summary: snippet(entry.body),
        target: createDiaryEntryTarget(entry.id, entry.entryDate),
        updatedAt: entry.updatedAt,
        activeRank: 0,
        sourceRank: sourceRank++,
        metadata: entry.entryDate,
        body: entry.body,
      }),
    );
  }

  for (const entry of data.inboxItems) {
    results.push(
      item({
        id: entry.id,
        category: "inboxItem",
        categoryLabel: "收件箱",
        title: snippet(entry.rawText, 60) || "收件箱内容",
        summary: entry.status === "pending" ? "待整理" : "本地收集",
        target: createInboxItemTarget(entry.id),
        updatedAt: entry.updatedAt,
        activeRank: entry.status === "dismissed" || entry.status === "confirmed" ? 1 : 0,
        sourceRank: sourceRank++,
        metadata: [entry.status, entry.createdAt].join(" "),
        body: entry.rawText,
      }),
    );
  }

  return results;
}

function matchRank(query: string, entry: SearchRecord): number | null {
  const title = normalize(entry.titleText);
  if (title === query) return 0;
  if (title.startsWith(query)) return 1;
  if (title.includes(query)) return 2;
  if (normalize(entry.metadataText).includes(query)) return 3;
  if (normalize(entry.bodyText).includes(query)) return 4;
  return null;
}

export function searchWorkspace(
  query: string,
  data: WorkspaceSearchData,
  maximumResults = 50,
): readonly WorkspaceSearchItem[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];
  const limit = Number.isFinite(maximumResults)
    ? Math.max(0, Math.min(50, Math.floor(maximumResults)))
    : 50;
  return createIndex(data)
    .map((entry) => ({ entry, rank: matchRank(normalizedQuery, entry) }))
    .filter((match): match is { entry: SearchRecord; rank: number } => match.rank !== null)
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.entry.activeRank - right.entry.activeRank ||
        right.entry.updatedAt.localeCompare(left.entry.updatedAt) ||
        left.entry.sourceRank - right.entry.sourceRank ||
        left.entry.id.localeCompare(right.entry.id),
    )
    .slice(0, limit)
    .map(({ entry, rank }) => ({
      id: entry.id,
      category: entry.category,
      categoryLabel: entry.categoryLabel,
      title: entry.title,
      summary: rank === 4 ? snippet(entry.bodyText) : entry.summary || snippet(entry.bodyText),
      target: entry.target,
    }));
}
