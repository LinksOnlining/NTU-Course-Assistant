import { createPersonalTaskTarget, createPlannerEventTarget } from "../../navigation/navigation.ts";
import { createWorkspaceSearchRecord } from "../../modules/search-record.ts";
import type { WorkspaceSearchRecord } from "../../modules/search-contract.ts";
import type { SearchProvider } from "../../modules/search-provider-registry.ts";
import { loadPersonalTasks } from "./personal-tasks.ts";
import { loadPlannerEventsForSearch } from "./planner-schedule.ts";
import type { PlannerEvent } from "../../types/planner.ts";
import type { PersonalTask } from "../../types/personal-task.ts";

type PlannerSearchSource = {
  readonly personalTasks: readonly PersonalTask[];
  readonly plannerEvents: readonly PlannerEvent[];
};

async function loadPlannerSearchSource(): Promise<PlannerSearchSource> {
  const [personalTasks, plannerEvents] = await Promise.all([
    loadPersonalTasks(),
    loadPlannerEventsForSearch(),
  ]);
  return { personalTasks, plannerEvents };
}

export function buildPlannerSearchRecords(
  source: PlannerSearchSource,
): readonly WorkspaceSearchRecord[] {
  const records: WorkspaceSearchRecord[] = [];
  let taskOrder = 0;
  for (const task of source.personalTasks) {
    records.push(
      createWorkspaceSearchRecord({
        id: task.id,
        category: "personalTask",
        categoryLabel: "个人任务",
        title: task.title,
        summary: task.deadlineDate ? `截止 ${task.deadlineDate}` : "个人任务",
        target: createPersonalTaskTarget(task.id),
        updatedAt: task.updatedAt,
        activeRank: task.status === "open" ? 0 : 1,
        sourceRank: 20_000 + taskOrder++,
        metadata: [task.priority, task.deadlineDate, task.deadlineTime].filter(Boolean).join(" "),
        body: task.description ?? "",
      }),
    );
  }
  let eventOrder = 0;
  for (const event of source.plannerEvents) {
    records.push(
      createWorkspaceSearchRecord({
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
        sourceRank: 30_000 + eventOrder++,
        metadata: [event.date, event.startTime, event.endTime, event.location]
          .filter(Boolean)
          .join(" "),
        body: event.description ?? "",
      }),
    );
  }
  return records;
}

export const plannerSearchProvider: SearchProvider = Object.freeze({
  id: "planner.search",
  moduleId: "planner",
  order: 20,
  async loadIndex() {
    return buildPlannerSearchRecords(await loadPlannerSearchSource());
  },
});
