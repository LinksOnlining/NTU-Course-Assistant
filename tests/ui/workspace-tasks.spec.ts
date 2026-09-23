import { expect, test, type Page } from "@playwright/test";

const fixedNow = new Date("2026-09-23T12:00:00");

async function seedTasksRuntime(page: Page) {
  await page.clock.install({ time: fixedNow });
  await page.addInitScript(() => {
    const semester = {
      id: "tasks-semester",
      name: "测试学期",
      firstWeekMonday: "2026-09-21",
      totalWeeks: 16,
      timezone: "Asia/Shanghai",
      status: "ACTIVE",
      createdAt: "",
      updatedAt: "",
    };
    const academicTasks = [
      {
        id: "academic-task-1",
        semesterId: semester.id,
        courseId: null,
        type: "ASSIGNMENT",
        title: "学业事项示例",
        note: null,
        dueAt: "2026-09-25T17:00:00+08:00",
        priority: 0,
        status: "TODO",
        completedAt: null,
        createdAt: "",
        updatedAt: "",
      },
    ];
    const personalTasks: Array<Record<string, unknown>> = [];
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string, args?: Record<string, any>) => {
          if (command === "load_courses") return { courses: [], warnings: [] };
          if (command === "load_period_times") return [];
          if (command === "load_reminder_configuration") {
            return {
              termConfig: null,
              reminderSettings: { enabled: false, advanceMinutes: 15 },
              warnings: [],
            };
          }
          if (command === "load_widget_settings") {
            return {
              enabled: false,
              displayMode: "today",
              locked: false,
              x: null,
              y: null,
              width: null,
              height: null,
            };
          }
          if (command === "load_day_count") return 7;
          if (command === "load_semesters") return [semester];
          if (command === "load_course_overrides" || command === "load_exams") return [];
          if (command === "load_academic_tasks") return academicTasks;
          if (command === "load_personal_tasks") return [...personalTasks];
          if (command === "create_personal_task") {
            personalTasks.push(args?.task);
            return args?.task;
          }
          if (command === "update_personal_task") {
            const index = personalTasks.findIndex((task) => task.id === args?.task?.id);
            if (index < 0) throw new Error("个人任务不存在。");
            personalTasks[index] = args?.task;
            return args?.task;
          }
          if (command === "set_personal_task_completed") {
            const task = personalTasks.find((item) => item.id === args?.id);
            if (!task) throw new Error("个人任务不存在。");
            Object.assign(task, {
              status: args?.completed ? "completed" : "open",
              completedAt: args?.completed ? args?.updatedAt : null,
              updatedAt: args?.updatedAt,
            });
            return task;
          }
          if (command === "delete_personal_task") {
            const index = personalTasks.findIndex((task) => task.id === args?.id);
            if (index < 0) throw new Error("个人任务不存在。");
            personalTasks.splice(index, 1);
            return;
          }
          if (command === "load_handled_reminder_keys") return [];
          if (
            command === "refresh_reminder_schedule" ||
            command === "trace_runtime_event" ||
            command === "plugin:event|unlisten"
          ) {
            return;
          }
          if (command === "plugin:event|listen") return 1;
          if (command === "plugin:updater|check") return null;
          throw new Error("未预期的任务页面命令：" + command);
        },
      },
    });
  });
  await page.goto("/");
  await expect(page.getByTestId("workspace-dashboard")).toBeVisible();
  await page.getByRole("button", { name: /查看全部/u }).click();
  await expect(page.getByTestId("workspace-tasks")).toBeVisible();
}

test("Workspace Tasks creates, edits, completes, reopens and confirms deletion of PersonalTask", async ({
  page,
}) => {
  await seedTasksRuntime(page);
  await page.getByRole("button", { name: "新建任务" }).click();
  await page.getByLabel("标题").fill("整理资料");
  await page.getByLabel("描述").fill("准备提交附件");
  await page.getByLabel("优先级").selectOption("high");
  await page.getByLabel("截止日期").fill("2026-09-25");
  await page.getByLabel("截止时间").fill("17:00");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const row = page.locator(".workspace-task-row").filter({ hasText: "整理资料" });
  await expect(row).toBeVisible();
  await expect(row.getByText("高优先级")).toBeVisible();
  await expect(row.getByText("周五 17:00")).toBeVisible();

  await row.getByRole("button", { name: "编辑" }).click();
  await page.getByLabel("标题").fill("整理最终资料");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const editedRow = page.locator(".workspace-task-row").filter({ hasText: "整理最终资料" });
  await expect(editedRow).toBeVisible();

  await editedRow.getByRole("button", { name: "完成整理最终资料" }).click();
  await expect(editedRow).toHaveCount(0);
  await page.getByRole("button", { name: /已完成/u }).click();
  const completedRow = page.locator(".workspace-task-row").filter({ hasText: "整理最终资料" });
  await expect(completedRow).toBeVisible();
  await completedRow.getByRole("button", { name: "重新打开整理最终资料" }).click();
  await expect(completedRow).toHaveCount(0);

  await page.getByRole("button", { name: /未完成/u }).click();
  const reopenedRow = page.locator(".workspace-task-row").filter({ hasText: "整理最终资料" });
  await reopenedRow.getByRole("button", { name: "删除" }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("关联的时间块也会同时删除");
  await confirmation.getByRole("button", { name: "确认删除" }).click();
  await expect(reopenedRow).toHaveCount(0);
});

test("Task editor rejects a time without a date and AcademicTask remains read-only and navigates to Academic", async ({
  page,
}) => {
  await seedTasksRuntime(page);
  const academicRow = page
    .locator(".workspace-task-row--academic")
    .filter({ hasText: "学业事项示例" });
  await expect(academicRow).toBeVisible();
  await expect(academicRow.getByText("学业", { exact: true })).toBeVisible();
  await academicRow.getByRole("button", { name: "在课表中管理" }).click();
  await expect(page.getByRole("heading", { name: "学习事项" })).toBeVisible();

  await page.getByRole("button", { name: /工作台/u }).click();
  await page.getByRole("button", { name: /查看全部/u }).click();
  await page.getByRole("button", { name: "新建任务" }).click();
  await page.getByLabel("标题").fill("时间需要日期");
  await page.getByLabel("截止时间").fill("09:30");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("也需要选择日期");
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.locator(".workspace-task-row").filter({ hasText: "时间需要日期" })).toHaveCount(
    0,
  );
});
