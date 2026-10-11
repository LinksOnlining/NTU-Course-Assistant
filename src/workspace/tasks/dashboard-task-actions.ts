import { setPersonalTaskCompleted } from "../../application/planner/personal-tasks.ts";
import { saveAcademicTask } from "../../services/academic-storage.ts";
import type {
  WorkspaceDashboardSources,
  WorkspaceTaskListItem,
} from "../../application/workspace/types.ts";

/**
 * Persist one dashboard checkbox toggle through its existing task owner.
 * The dashboard itself only consumes the projection and this action.
 */
export async function toggleDashboardTaskState(
  task: WorkspaceTaskListItem,
  sources: WorkspaceDashboardSources,
  now = new Date(),
): Promise<void> {
  if (task.sourceLabel === "个人") {
    const current = sources.personalTasks?.find(
      (item) => item.id === task.id && (item.status === "completed") === task.completed,
    );
    if (!current) throw new Error("任务状态已变化，请重新加载后再试。");
    await setPersonalTaskCompleted(task.id, !task.completed);
    return;
  }

  const current = sources.tasks.find(
    (item) => item.id === task.id && (item.status === "COMPLETED") === task.completed,
  );
  if (!current) throw new Error("任务状态已变化，请重新加载后再试。");
  const timestamp = now.toISOString();
  await saveAcademicTask({
    ...current,
    status: task.completed ? "TODO" : "COMPLETED",
    completedAt: task.completed ? null : timestamp,
    updatedAt: timestamp,
  });
}
