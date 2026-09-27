import type { ObjectRef } from "../../navigation/types.ts";
import { formatTimelineMinute, effectiveOccupancy } from "../timeline/planner-interactions.ts";
import type { TimelineItem } from "../timeline/types.ts";
import { weatherCodeLabel } from "../weather/weather.ts";
import type {
  AiAcademicSnapshot,
  AiContextModuleId,
  AiContextSourceRequest,
  AiDiarySnapshot,
  AiInboxSnapshot,
  AiJsonValue,
  AiPlannerSnapshot,
  AiRoutineSnapshot,
  AiWeatherSnapshot,
  AiWorkspaceSnapshot,
} from "./context.ts";

type Projector = (snapshot: unknown, request: AiContextSourceRequest) => AiJsonValue;

/** 固定 allowlist 投影；Domain entity 的额外字段永远不会被序列化。 */
export const AI_CONTEXT_PROJECTORS: Readonly<Record<AiContextModuleId, Projector>> = Object.freeze({
  workspace: (value, request) => projectWorkspace(value as AiWorkspaceSnapshot, request),
  academic: (value, request) => projectAcademic(value as AiAcademicSnapshot, request),
  planner: (value, request) => projectPlanner(value as AiPlannerSnapshot, request),
  routine: (value, request) => projectRoutine(value as AiRoutineSnapshot, request),
  weather: (value, request) => projectWeather(value as AiWeatherSnapshot, request),
  diary: (value, request) => projectDiary(value as AiDiarySnapshot, request),
  inbox: (value, request) => projectInbox(value as AiInboxSnapshot, request),
});

export function projectAiContextSnapshot(
  moduleId: AiContextModuleId,
  snapshot: unknown,
  request: AiContextSourceRequest,
): AiJsonValue {
  return AI_CONTEXT_PROJECTORS[moduleId](snapshot, request);
}

export function getSelectedItemsForModule(
  items: readonly ObjectRef[],
  moduleId: AiContextModuleId,
): readonly ObjectRef[] {
  return items.filter((item) => objectRefModule(item) === moduleId);
}

export function objectRefModule(item: ObjectRef): AiContextModuleId | null {
  switch (item.type) {
    case "course":
    case "academicOccurrence":
    case "academicTask":
    case "exam":
    case "semester":
    case "courseOverride":
      return "academic";
    case "personalTask":
    case "plannerEvent":
    case "timeBlock":
      return "planner";
    case "diaryEntry":
      return "diary";
    case "inboxItem":
      return "inbox";
  }
  return null;
}

export function objectRefKey(item: ObjectRef): string {
  return item.type === "academicOccurrence"
    ? `${item.type}:${item.courseId}:${item.date}`
    : `${item.type}:${item.id}`;
}

function projectWorkspace(
  input: AiWorkspaceSnapshot,
  _request: AiContextSourceRequest,
): AiJsonValue {
  const context = input.context;
  return {
    date: safeText(context.date),
    localTime: safeText(context.localTime),
    todayScheduleCount: safeNumber(context.todayItemCount),
    remainingScheduleCount: safeNumber(context.remainingItemCount),
    openTaskCount: safeNumber(context.openTaskCount),
    overdueTaskCount: safeNumber(context.overdueTaskCount),
    todayTaskCount: safeNumber(context.todayTaskCount),
    hasDiaryToday: context.hasDiaryToday === true,
    pendingInboxCount: safeNumber(context.pendingInboxCount),
    nextFreeTime: context.nextFreeSlot
      ? {
          date: safeText(context.nextFreeSlot.date),
          start: formatTimelineMinute(context.nextFreeSlot.startMinute),
          end: formatTimelineMinute(context.nextFreeSlot.endMinute),
          durationMinutes: safeNumber(context.nextFreeSlot.durationMinutes),
        }
      : null,
  };
}

function projectAcademic(input: AiAcademicSnapshot, request: AiContextSourceRequest): AiJsonValue {
  const selected = getSelectedItemsForModule(request.selectedItems, "academic");
  const inSelectedCourse = (courseId: string, date: string) => {
    const refs = selected.filter(
      (item) => item.type === "course" || item.type === "academicOccurrence",
    );
    if (refs.length === 0) return true;
    return refs.some((item) =>
      item.type === "course"
        ? item.id === courseId
        : item.courseId === courseId && item.date === date,
    );
  };
  const selectedExamIds = selected
    .filter((item): item is Extract<ObjectRef, { type: "exam" }> => item.type === "exam")
    .map((item) => item.id);
  const selectedTaskIds = selected
    .filter(
      (item): item is Extract<ObjectRef, { type: "academicTask" }> => item.type === "academicTask",
    )
    .map((item) => item.id);
  const hasSelectedAcademicRef = selected.length > 0;
  const hasCourseRef = selected.some(
    (item) => item.type === "course" || item.type === "academicOccurrence",
  );
  const hasExamRef = selectedExamIds.length > 0;
  const hasTaskRef = selectedTaskIds.length > 0;

  const courses = input.occurrences
    .filter(
      (item) =>
        inDateRange(item.date, request) &&
        (!hasSelectedAcademicRef || (hasCourseRef && inSelectedCourse(item.courseId, item.date))),
    )
    .sort(
      (a, b) =>
        compareText(a.date, b.date) ||
        compareText(a.startTime, b.startTime) ||
        compareText(a.courseId, b.courseId),
    )
    .map((item) => ({
      id: safeText(item.courseId),
      title: safeText(input.courseNames[item.courseId] ?? "课程"),
      date: safeText(item.date),
      teachingWeek: safeNumber(item.teachingWeek),
      start: safeText(item.startTime),
      end: safeText(item.endTime),
      location: safeText(item.room),
      teacher: safeText(item.teacher),
      status: item.status,
    }));

  const exams = input.exams
    .filter((item) =>
      hasSelectedAcademicRef
        ? hasExamRef && selectedExamIds.includes(item.id)
        : inDateRange(datePart(item.startsAt), request),
    )
    .sort((a, b) => compareText(a.startsAt, b.startsAt) || compareText(a.id, b.id))
    .map((item) => ({
      id: safeText(item.id),
      title: safeText(item.title),
      startsAt: safeText(item.startsAt),
      endsAt: safeText(item.endsAt),
      location: safeText(item.location),
      status: item.status,
    }));

  const deadlines = input.deadlines
    .filter((item) =>
      hasSelectedAcademicRef
        ? hasTaskRef && selectedTaskIds.includes(item.id)
        : inDateRange(datePart(item.dueAt), request) ||
          (request.intent === "dailyBrief" &&
            isDatePart(datePart(item.dueAt)) &&
            datePart(item.dueAt) < request.timeRange.startDate),
    )
    .sort((a, b) => {
      if (request.intent === "dailyBrief") {
        const leftDate = datePart(a.dueAt);
        const rightDate = datePart(b.dueAt);
        const leftOverdue = leftDate < request.timeRange.startDate;
        const rightOverdue = rightDate < request.timeRange.startDate;
        if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
        if (leftOverdue) return compareText(b.dueAt, a.dueAt) || compareText(a.id, b.id);
      }
      return compareText(a.dueAt, b.dueAt) || compareText(a.id, b.id);
    })
    .map((item) => ({
      id: safeText(item.id),
      title: safeText(item.title),
      dueAt: safeText(item.dueAt),
      priority: safeNumber(item.priority),
      status: item.status,
      type: item.type,
    }));

  return {
    ...(input.truncated ? { truncated: true } : {}),
    courses,
    exams,
    deadlines,
  };
}

function projectPlanner(input: AiPlannerSnapshot, request: AiContextSourceRequest): AiJsonValue {
  const selected = getSelectedItemsForModule(request.selectedItems, "planner");
  const selectedTasks = selected
    .filter(
      (item): item is Extract<ObjectRef, { type: "personalTask" }> => item.type === "personalTask",
    )
    .map((item) => item.id);
  const selectedEvents = selected
    .filter(
      (item): item is Extract<ObjectRef, { type: "plannerEvent" }> => item.type === "plannerEvent",
    )
    .map((item) => item.id);
  const selectedBlocks = selected
    .filter((item): item is Extract<ObjectRef, { type: "timeBlock" }> => item.type === "timeBlock")
    .map((item) => item.id);
  const hasSelected = selected.length > 0;

  const timeBlocks = input.timeBlocks
    .filter((item) =>
      hasSelected
        ? selectedBlocks.includes(item.id) || selectedTasks.includes(item.personalTaskId)
        : inDateRange(item.date, request),
    )
    .sort(
      (a, b) =>
        compareText(a.date, b.date) ||
        compareText(a.startTime, b.startTime) ||
        compareText(a.id, b.id),
    );
  const scheduledTaskIds = new Set(timeBlocks.map((item) => item.personalTaskId));
  const tasks = input.tasks
    .filter((item) =>
      hasSelected
        ? selectedTasks.includes(item.id) || scheduledTaskIds.has(item.id)
        : item.status !== "completed" &&
          (item.deadlineDate === null ||
            inDateRange(item.deadlineDate, request) ||
            item.status === "open"),
    )
    .sort(
      (a, b) =>
        compareText(a.deadlineDate ?? "9999-12-31", b.deadlineDate ?? "9999-12-31") ||
        compareText(a.id, b.id),
    )
    .map((item) => ({
      id: safeText(item.id),
      title: safeText(item.title),
      status: item.status,
      priority: item.priority,
      deadlineDate: safeText(item.deadlineDate),
      deadlineTime: safeText(item.deadlineTime),
      hasTimeBlock: scheduledTaskIds.has(item.id),
    }));

  const events = input.events
    .filter((item) =>
      hasSelected ? selectedEvents.includes(item.id) : inDateRange(item.date, request),
    )
    .sort(
      (a, b) =>
        compareText(a.date, b.date) ||
        compareText(a.startTime, b.startTime) ||
        compareText(a.id, b.id),
    )
    .map((item) => ({
      id: safeText(item.id),
      title: safeText(item.title),
      date: safeText(item.date),
      start: safeText(item.startTime),
      end: safeText(item.endTime),
      occupiedStart: occupiedTime(item, "plannerEvent"),
      occupiedEnd: occupiedTime(item, "plannerEvent", true),
    }));

  return {
    ...(input.truncated ? { truncated: true } : {}),
    tasks,
    events,
    timeBlocks: timeBlocks.map((item) => ({
      id: safeText(item.id),
      taskId: safeText(item.personalTaskId),
      date: safeText(item.date),
      start: safeText(item.startTime),
      end: safeText(item.endTime),
      occupiedStart: occupiedTime(item, "timeBlock"),
      occupiedEnd: occupiedTime(item, "timeBlock", true),
    })),
  };
}

function occupiedTime(
  item: AiPlannerSnapshot["events"][number] | AiPlannerSnapshot["timeBlocks"][number],
  type: "plannerEvent" | "timeBlock",
  end = false,
): string | null {
  const sourceRef: ObjectRef =
    type === "plannerEvent" ? { type, id: item.id } : { type, id: item.id };
  const timelineItem: TimelineItem = {
    id: item.id,
    sourceType: type,
    sourceRef,
    date: item.date,
    startTime: item.startTime,
    endTime: item.endTime,
    title: "",
    location: null,
    status: "normal",
    editable: false,
    draggable: false,
    resizable: false,
    occupiesTime: true,
    bufferBeforeMinutes: item.bufferBeforeMinutes,
    bufferAfterMinutes: item.bufferAfterMinutes,
    warnings: [],
  };
  const occupancy = effectiveOccupancy(timelineItem);
  return occupancy ? formatTimelineMinute(end ? occupancy.endMinute : occupancy.startMinute) : null;
}

function projectRoutine(input: AiRoutineSnapshot, request: AiContextSourceRequest): AiJsonValue {
  const weekday = isoWeekday(request.timeContext.localDate);
  return {
    date: request.timeContext.localDate,
    goals: input.routines
      .filter(
        (routine) =>
          routine.enabled &&
          weekday !== null &&
          (routine.weekdaysMask & (1 << (weekday - 1))) !== 0,
      )
      .sort((a, b) => compareText(a.id, b.id))
      .map((routine) => ({
        id: safeText(routine.id),
        title: safeText(routine.title),
        targetDurationMinutes: safeNumber(routine.targetDurationMinutes),
        scheduledToday: routine.lastScheduledDate === request.timeContext.localDate,
        frequencyDaysPerWeek: [1, 2, 3, 4, 5, 6, 7].filter(
          (day) => (routine.weekdaysMask & (1 << (day - 1))) !== 0,
        ).length,
        preferredStartTime: safeText(routine.preferredStartTime),
        preferredEndTime: safeText(routine.preferredEndTime),
      })),
  };
}

function projectWeather(input: AiWeatherSnapshot, request: AiContextSourceRequest): AiJsonValue {
  const snapshot = input.snapshot;
  if (!snapshot) return { current: null, forecast: [] };
  const forecast = snapshot.hourly
    .filter(
      (item) =>
        inDateRange(datePart(item.time), request) &&
        (datePart(item.time) > request.timeContext.localDate ||
          item.time.slice(11, 16) >= request.timeContext.localTime),
    )
    .sort((a, b) => compareText(a.time, b.time))
    .slice(0, 50)
    .map((item) => ({
      time: safeText(item.time),
      condition: safeText(weatherCodeLabel(item.weatherCode)),
      temperatureCelsius: safeNumber(item.temperatureCelsius),
      precipitationProbability: nullableNumber(item.precipitationProbability),
    }));
  const current =
    snapshot.current && datePart(snapshot.current.time) === request.timeContext.localDate
      ? snapshot.current
      : null;
  return {
    location: safeText(snapshot.locationLabel ?? "已选地点"),
    current: current
      ? {
          time: safeText(current.time),
          condition: safeText(weatherCodeLabel(current.weatherCode)),
          temperatureCelsius: safeNumber(current.temperatureCelsius),
          humidityPercent: nullableNumber(current.humidityPercent),
        }
      : null,
    forecast,
  };
}

function projectDiary(input: AiDiarySnapshot, request: AiContextSourceRequest): AiJsonValue {
  const selectedIds = getSelectedItemsForModule(request.selectedItems, "diary")
    .filter((item) => item.type === "diaryEntry")
    .map((item) => item.id);
  return {
    entries: input.entries
      .filter((item) => selectedIds.includes(item.id))
      .sort((a, b) => compareText(a.date, b.date) || compareText(a.id, b.id))
      .map((item) =>
        fitUntrustedEnvelope(
          {
            sourceType: "diary",
            sourceId: safeText(item.id),
            date: safeText(item.date),
            content: safeText(item.body),
            trust: "untrusted-user-content",
            truncated: item.truncated === true,
            omittedBytes: safeOptionalNumber(item.omittedBytes),
          },
          18 * 1024,
        ),
      ),
  };
}

function projectInbox(input: AiInboxSnapshot, request: AiContextSourceRequest): AiJsonValue {
  const selectedIds = getSelectedItemsForModule(request.selectedItems, "inbox")
    .filter((item) => item.type === "inboxItem")
    .map((item) => item.id);
  return {
    items: input.items
      .filter((item) => selectedIds.includes(item.id))
      .sort((a, b) => compareText(a.capturedAt, b.capturedAt) || compareText(a.id, b.id))
      .map((item) =>
        fitUntrustedEnvelope(
          {
            sourceType: "inbox",
            sourceId: safeText(item.id),
            capturedAt: safeText(item.capturedAt),
            content: safeText(item.rawText),
            trust: "untrusted-user-content",
            truncated: item.truncated === true,
            omittedBytes: safeOptionalNumber(item.omittedBytes),
          },
          18 * 1024,
        ),
      ),
  };
}

function fitUntrustedEnvelope<
  T extends {
    readonly content: string | null;
    readonly truncated: boolean;
    readonly omittedBytes: number;
  },
>(envelope: T, maxBytes: number): T {
  const content = envelope.content ?? "";
  const characters = Array.from(content);
  const serialize = (length: number) =>
    JSON.stringify({
      ...envelope,
      content: characters.slice(0, length).join(""),
      truncated: envelope.truncated || length < characters.length,
      omittedBytes:
        envelope.omittedBytes + new TextEncoder().encode(characters.slice(length).join("")).length,
    });
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (new TextEncoder().encode(serialize(middle)).length <= maxBytes) low = middle;
    else high = middle - 1;
  }
  const finalContent = characters.slice(0, low).join("");
  return Object.freeze({
    ...envelope,
    content: finalContent,
    truncated: envelope.truncated || low < characters.length,
    omittedBytes:
      envelope.omittedBytes + new TextEncoder().encode(characters.slice(low).join("")).length,
  });
}

function safeOptionalNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function inDateRange(date: string, request: AiContextSourceRequest): boolean {
  const part = datePart(date);
  return part >= request.timeRange.startDate && part <= request.timeRange.endDate;
}

function datePart(value: string): string {
  return value.slice(0, 10);
}

function isDatePart(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function isoWeekday(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return null;
  const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function nullableNumber(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

const WINDOWS_PATH = /(?:\b[A-Za-z]:\\[^\r\n"'<>|,;]*|\\\\[^\\\s]+\\[^\r\n"'<>|,;]*)/gu;
const SECRET_VALUE =
  /\b(?:sk-[A-Za-z0-9_-]{20,}|(?:api[_ -]?key|password|token)\s*[:=]\s*[^\s,;]+|bearer\s+[A-Za-z0-9._~+-]{12,})/giu;

function safeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return sanitizeAiText(value);
}

export function sanitizeAiText(value: string): string {
  return value.replace(WINDOWS_PATH, "[本地路径已省略]").replace(SECRET_VALUE, "[敏感值已省略]");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
