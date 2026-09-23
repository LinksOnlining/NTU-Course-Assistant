import type {
  AcademicOccurrenceRef,
  AppRoute,
  NavigationTarget,
  ObjectRef,
} from "../../src/navigation/types.ts";

const route: AppRoute = { area: "academic", page: "tasks-legacy" };
const occurrence: AcademicOccurrenceRef = {
  type: "academicOccurrence",
  courseId: "course-1",
  date: "2026-09-23",
};
const objectRefs: readonly ObjectRef[] = [
  { type: "course", id: "course-1" },
  occurrence,
  { type: "academicTask", id: "task-1" },
  { type: "exam", id: "exam-1" },
  { type: "semester", id: "semester-1" },
  { type: "courseOverride", id: "override-1" },
  { type: "personalTask", id: "personal-task-1" },
  { type: "plannerEvent", id: "event-1" },
  { type: "timeBlock", id: "block-1" },
  { type: "diaryEntry", id: "diary-1" },
  { type: "inboxItem", id: "inbox-1" },
];
const target: NavigationTarget = {
  route,
  object: occurrence,
  date: "2026-09-23",
};

void objectRefs;
void target;
