import {
  loadAcademicHubData,
  loadAcademicScheduleData,
  loadAcademicTermConfig,
  resolveAcademicOccurrences,
} from "../../application/academic/academic-application.ts";
import {
  loadWorkspaceDashboardSources,
  buildWorkspaceDashboardViewModel,
} from "../../application/workspace/workspace-dashboard.ts";
import { getShanghaiWeekday } from "../../core/reminder.ts";
import { loadPersonalTasks } from "../../application/planner/personal-tasks.ts";
import { loadPlannerEvents, loadTimeBlocks } from "../../application/planner/planner-schedule.ts";
import { loadRoutines } from "../../application/planner/routines.ts";
import { weatherLocationKey } from "../../application/weather/weather.ts";
import {
  loadWeatherCache,
  loadWeatherSettings,
} from "../../application/weather/weather-storage.ts";
import type { AiContextSources } from "../../application/ai/context.ts";

const LEGACY_SEMESTER_ID = "legacy-active-semester";
const MAX_CONTEXT_ITEMS = 50;

/** Context Engine source adapters use only module Application Query boundaries; never raw storage. */
export const todayAssistantContextSources: AiContextSources = Object.freeze({
  async workspace({ timeContext }) {
    const termConfig = await loadAcademicTermConfig();
    const dashboardSources = await loadWorkspaceDashboardSources(timeContext.localDate, termConfig);
    const context = buildWorkspaceDashboardViewModel(
      dashboardSources,
      timeContext.localTime,
    ).context;
    return { context };
  },
  async academic({ timeRange, intent, timeContext }) {
    const termConfig = await loadAcademicTermConfig();
    const [schedule, hub] = await Promise.all([
      loadAcademicScheduleData(),
      loadAcademicHubData({ fallbackSemesterId: termConfig ? LEGACY_SEMESTER_ID : undefined }),
    ]);
    const semester =
      hub.semesters.find((item) => item.status === "ACTIVE") ??
      (hub.semesters.length === 0 && termConfig
        ? {
            id: LEGACY_SEMESTER_ID,
            name: "当前学期",
            firstWeekMonday: termConfig.firstWeekMonday,
            totalWeeks: termConfig.totalWeeks,
            timezone: termConfig.timezone,
            status: "ACTIVE" as const,
            createdAt: "",
            updatedAt: "",
          }
        : null);
    const rangeOccurrences = semester
      ? resolveAcademicOccurrences(
          schedule.courses,
          semester,
          hub.overrides,
          { from: timeRange.startDate, to: timeRange.endDate },
          schedule.periodTimes ?? [],
        )
      : [];
    const occurrences =
      intent === "dailyBrief" || intent === "dailySummary"
        ? rangeOccurrences.filter((item) => item.date === timeRange.startDate)
        : rangeOccurrences;
    const scheduledExams = hub.exams
      .filter((item) => item.status === "SCHEDULED")
      .filter((item) => {
        const date = item.startsAt.slice(0, 10);
        return date >= timeRange.startDate && date <= timeRange.endDate;
      });
    const openDeadlines = hub.tasks
      .filter(
        (item) =>
          item.status !== "COMPLETED" ||
          (intent === "dailySummary" &&
            localTimestampDate(item.completedAt, timeContext.timeZone) === timeRange.startDate),
      )
      .filter((item) => {
        const date = item.dueAt.slice(0, 10);
        if (
          intent === "dailySummary" &&
          item.status === "COMPLETED" &&
          localTimestampDate(item.completedAt, timeContext.timeZone) === timeRange.startDate
        ) {
          return true;
        }
        return (
          /^\d{4}-\d{2}-\d{2}$/u.test(date) &&
          (intent === "dailyBrief"
            ? date <= timeRange.endDate
            : date >= timeRange.startDate && date <= timeRange.endDate)
        );
      })
      .sort((left, right) => {
        if (intent !== "dailyBrief") return 0;
        const leftDate = left.dueAt.slice(0, 10);
        const rightDate = right.dueAt.slice(0, 10);
        const leftOverdue = leftDate < timeRange.startDate;
        const rightOverdue = rightDate < timeRange.startDate;
        if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
        return (
          (leftOverdue
            ? right.dueAt.localeCompare(left.dueAt)
            : left.dueAt.localeCompare(right.dueAt)) || left.id.localeCompare(right.id)
        );
      });
    return {
      truncated:
        occurrences.length > (intent === "dailyBrief" ? 12 : MAX_CONTEXT_ITEMS) ||
        scheduledExams.length > (intent === "dailyBrief" ? 12 : MAX_CONTEXT_ITEMS) ||
        openDeadlines.length > (intent === "dailyBrief" ? 12 : MAX_CONTEXT_ITEMS),
      occurrences: occurrences
        .slice(0, intent === "dailyBrief" ? 12 : MAX_CONTEXT_ITEMS)
        .map((item) => ({
          courseId: item.courseId,
          date: item.date,
          teachingWeek: item.teachingWeek,
          startTime: item.startTime,
          endTime: item.endTime,
          room: item.room,
          teacher: item.teacher,
          status: item.status,
        })),
      exams: scheduledExams
        .slice(0, intent === "dailyBrief" ? 12 : MAX_CONTEXT_ITEMS)
        .map((item) => ({
          id: item.id,
          title: item.title,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          location: item.location,
          status: item.status,
        })),
      deadlines: openDeadlines
        .slice(0, intent === "dailyBrief" ? 12 : MAX_CONTEXT_ITEMS)
        .map((item) => ({
          id: item.id,
          title: item.title,
          dueAt: item.dueAt,
          priority: item.priority,
          status: item.status,
          completedAt: item.completedAt,
          type: item.type,
        })),
      courseNames: Object.freeze(
        Object.fromEntries(
          schedule.courses
            .filter((course) => occurrences.some((item) => item.courseId === course.id))
            .map((course) => [course.id, course.name]),
        ),
      ),
    };
  },
  async planner({ timeRange, intent, timeContext }) {
    const [tasks, events, timeBlocks] = await Promise.all([
      loadPersonalTasks(),
      loadPlannerEvents(timeRange.startDate, timeRange.endDate),
      loadTimeBlocks(timeRange.startDate, timeRange.endDate),
    ]);
    const dailyTimeBlocks =
      intent === "dailyBrief" || intent === "dailySummary"
        ? timeBlocks.filter((item) => item.date === timeRange.startDate)
        : timeBlocks;
    const scheduledTaskIds = new Set(dailyTimeBlocks.map((item) => item.personalTaskId));
    const openTasks = tasks
      .filter(
        (item) =>
          item.status !== "completed" ||
          (intent === "dailySummary" &&
            localTimestampDate(item.completedAt, timeContext.timeZone) === timeRange.startDate),
      )
      .filter(
        (item) =>
          intent !== "dailyBrief" ||
          scheduledTaskIds.has(item.id) ||
          (item.deadlineDate !== null && item.deadlineDate <= timeRange.endDate),
      )
      .sort((left, right) => {
        if (intent !== "dailyBrief") {
          return (
            (left.deadlineDate ?? "9999-12-31").localeCompare(right.deadlineDate ?? "9999-12-31") ||
            left.id.localeCompare(right.id)
          );
        }
        const leftDate = left.deadlineDate ?? "9999-12-31";
        const rightDate = right.deadlineDate ?? "9999-12-31";
        const leftOverdue = leftDate < timeRange.startDate;
        const rightOverdue = rightDate < timeRange.startDate;
        if (leftOverdue !== rightOverdue) return leftOverdue ? -1 : 1;
        return (
          (leftOverdue ? rightDate.localeCompare(leftDate) : leftDate.localeCompare(rightDate)) ||
          left.id.localeCompare(right.id)
        );
      });
    const dailyEvents =
      intent === "dailyBrief" || intent === "dailySummary"
        ? events.filter((item) => item.date === timeRange.startDate)
        : events;
    const itemLimit = intent === "dailyBrief" || intent === "dailySummary" ? 12 : MAX_CONTEXT_ITEMS;
    return {
      truncated:
        openTasks.length > itemLimit ||
        dailyEvents.length > itemLimit ||
        dailyTimeBlocks.length > itemLimit,
      tasks: openTasks.slice(0, itemLimit).map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        priority: item.priority,
        deadlineDate: item.deadlineDate,
        deadlineTime: item.deadlineTime,
        completedAt: item.completedAt,
      })),
      events: dailyEvents.slice(0, itemLimit).map((item) => ({
        id: item.id,
        title: item.title,
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        bufferBeforeMinutes: item.bufferBeforeMinutes,
        bufferAfterMinutes: item.bufferAfterMinutes,
      })),
      timeBlocks: dailyTimeBlocks.slice(0, itemLimit).map((item) => ({
        id: item.id,
        personalTaskId: item.personalTaskId,
        date: item.date,
        startTime: item.startTime,
        endTime: item.endTime,
        bufferBeforeMinutes: item.bufferBeforeMinutes,
        bufferAfterMinutes: item.bufferAfterMinutes,
      })),
    };
  },
  async routine({ timeContext }) {
    const weekday = getShanghaiWeekday(timeContext.localDate);
    const routines = await loadRoutines();
    return {
      routines: routines
        .filter((item) => item.enabled && (item.weekdaysMask & (1 << (weekday - 1))) !== 0)
        .slice(0, MAX_CONTEXT_ITEMS)
        .map((item) => ({
          id: item.id,
          title: item.title,
          targetDurationMinutes: item.targetDurationMinutes,
          weekdaysMask: item.weekdaysMask,
          preferredStartTime: item.preferredStartTime,
          preferredEndTime: item.preferredEndTime,
          enabled: item.enabled,
          lastScheduledDate: item.lastScheduledDate,
        })),
    };
  },
  async weather({ timeRange }) {
    const settings = loadWeatherSettings();
    const cached = loadWeatherCache();
    const snapshot =
      settings.enabled &&
      settings.location &&
      cached &&
      weatherLocationKey(cached.location) === weatherLocationKey(settings.location)
        ? cached
        : null;
    return {
      snapshot: snapshot
        ? {
            locationLabel: snapshot.location.displayName,
            current: {
              time: snapshot.current.time,
              weatherCode: snapshot.current.weatherCode,
              temperatureCelsius: snapshot.current.temperatureCelsius,
              humidityPercent: snapshot.current.humidityPercent,
            },
            hourly: snapshot.hourly
              .filter(
                (item) =>
                  item.time.slice(0, 10) >= timeRange.startDate &&
                  item.time.slice(0, 10) <= timeRange.endDate,
              )
              .slice(0, MAX_CONTEXT_ITEMS)
              .map((item) => ({
                time: item.time,
                weatherCode: item.weatherCode,
                temperatureCelsius: item.temperatureCelsius,
                precipitationProbability: item.precipitationProbability,
              })),
          }
        : null,
    };
  },
});

function localTimestampDate(value: string | null | undefined, timeZone: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value;
    const year = part("year");
    const month = part("month");
    const day = part("day");
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}
