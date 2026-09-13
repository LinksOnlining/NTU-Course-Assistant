import { expect, test, type Locator, type Page } from "@playwright/test";

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return value!;
}

interface CourseFields {
  readonly name: string;
  readonly teacher?: string;
  readonly classroom?: string;
  readonly weekday?: string;
  readonly startTime?: string;
  readonly endTime?: string;
  readonly weeks?: string;
}

function createTextPdf(text = "Schedule"): Buffer {
  const stream =
    text === "" ? "BT /F1 12 Tf 20 160 Td ET" : `BT /F1 12 Tf 20 160 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(source, "ascii"));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(source, "ascii");
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    source += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, "ascii");
}

async function selectPdf(page: Page, name: string, buffer: Buffer) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入 PDF" }).click();
  await (await chooser).setFiles({ name, mimeType: "application/pdf", buffer });
}

async function selectPdfPath(page: Page, path: string) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入 PDF" }).click();
  await (await chooser).setFiles(path);
}

async function openTimetable(page: Page) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/");
    try {
      await expect(page.getByRole("heading", { name: "大学课程表" })).toBeVisible({
        timeout: 10_000,
      });
      return;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
}

async function addUserCourse(page: Page, fields: CourseFields) {
  await page.getByRole("button", { name: "添加课程" }).click();
  const dialog = page.getByRole("dialog", { name: "添加课程" });
  await dialog.getByLabel("课程名称", { exact: true }).fill(fields.name);
  await dialog.getByLabel("教师（可选）").fill(fields.teacher ?? "测试教师");
  await dialog.getByLabel("教室（可选）").fill(fields.classroom ?? "测试教室");
  await dialog.getByLabel("星期").selectOption(fields.weekday ?? "3");
  await dialog.getByLabel("开始时间").fill(fields.startTime ?? "14:00");
  await dialog.getByLabel("结束时间").fill(fields.endTime ?? "15:30");
  await dialog.getByLabel("上课周数").fill(fields.weeks ?? "1-16");
  await dialog.getByRole("button", { name: "保存课程" }).click();
  return page.locator('[data-source="user"]').filter({ hasText: fields.name }).first();
}

async function openUserCourseEditor(card: Locator) {
  await card.focus();
  await card.press("Enter");
}

async function completePracticeCandidates(preview: Locator) {
  for (let index = 0; index < 3; index += 1) {
    const practice = preview.locator('[data-candidate-kind="practice"]').nth(index);
    await practice.getByRole("button", { name: /^编辑 /u }).click();
    const editor = preview.locator(".candidate-editor");
    await editor.getByLabel("教师").fill(`实践教师${index + 1}`);
    await editor.getByLabel("教室").fill(`实训中心${index + 1}`);
    await editor.getByLabel("星期").selectOption(String(index + 3));
    await editor.getByLabel("开始节次").selectOption("6");
    await editor.getByLabel("结束节次").selectOption("8");
    await editor.getByRole("button", { name: "保存候选" }).click();
  }
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await openTimetable(page);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(errors).toEqual([]);
  await expect(page.getByText("测试数据", { exact: true })).toBeVisible();
});

test("development opener keeps the widget prototype separate from the timetable", async ({
  page,
}) => {
  await page.getByRole("button", { name: "打开小组件原型" }).click();
  await expect(page.getByTestId("schedule-notice")).toHaveText("桌面课程小组件原型已打开。");
  await expect(page.getByRole("heading", { name: "大学课程表" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "课程小组件" })).toHaveCount(0);
});

test("widget route provides Today and Week controls without mounting the timetable", async ({
  page,
}) => {
  await page.goto("/?widget");
  await expect(page.getByLabel("桌面课程小组件原型")).toBeVisible();
  await expect(page.getByRole("tab", { name: "今日" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "本周" }).click();
  await expect(page.getByRole("tab", { name: "本周" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "大学课程表" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开课程表" })).toBeVisible();
});

test("seven fixed days and teaching-week filter", async ({ page }) => {
  await expect(page.getByTestId("day-column")).toHaveCount(7);
  await expect(page.locator(".day-header")).toHaveText([
    "周一",
    "周二",
    "周三",
    "周四",
    "周五",
    "周六",
    "周日",
  ]);
  await expect(page.locator('[data-course-id="sunday-course"]')).toBeVisible();
  await expect(page.locator('[data-course-id="other-week-hidden"]')).toHaveCount(0);
  await expect(page.locator('[data-weekday="5"] .course-card')).toHaveCount(0);
  await expect(page.locator('[data-weekday="6"] .course-card')).toHaveCount(0);
});

test("text PDF extraction keeps page dimensions and coordinate-bearing text in memory", async ({
  page,
}) => {
  await selectPdf(page, "sample.pdf", createTextPdf("Schedule"));
  const preview = page.getByRole("dialog", { name: "检查导入候选" });
  await expect(preview).toContainText("sample.pdf · 1 页 · 当前只生成提案，不会写入课程表");
  await expect(page.getByTestId("pdf-candidate-summary")).toContainText("识别到 0 个候选");
  await expect(page.getByTestId("pdf-candidate-summary")).toContainText("固定安排 0");
  await expect(page.getByTestId("pdf-candidate-summary")).toContainText("非固定实践 0");
  const finalReviewButton = preview.getByRole("button", { name: "进入最终确认" });
  await expect(finalReviewButton).toBeDisabled();
  await expect(finalReviewButton).toBeVisible();
  const footer = await box(preview.locator(".pdf-preview-footer"));
  expect(footer.y + footer.height).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerHeight),
  );
  await preview.getByRole("button", { name: "取消本次导入", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator('[data-source="user"]')).toHaveCount(0);
});

test("invalid, damaged and textless PDFs report errors without changing courses", async ({
  page,
}) => {
  await selectPdf(page, "not-pdf.pdf", Buffer.from("not a PDF", "utf8"));
  await expect(page.getByRole("alert")).toHaveText("所选文件不是有效的 PDF。");
  await selectPdf(page, "damaged.pdf", Buffer.from("%PDF-1.7\nbroken", "ascii"));
  await expect(page.getByRole("alert")).toHaveText("无法解析该 PDF，请确认文件未损坏后重试。");
  await selectPdf(page, "scan.pdf", createTextPdf(""));
  await expect(page.getByRole("alert")).toHaveText("当前 PDF 可能是扫描版，首版暂不支持。");
  await expect(page.locator('[data-source="user"]')).toHaveCount(0);
});

test("real PDF import supports final review, rollback-safe retry, duplicates and cancel", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "1280-100", "real sample interaction runs once");
  const samplePath = process.env.NTU_COURSE_PDF_SAMPLE;
  test.skip(!samplePath, "set NTU_COURSE_PDF_SAMPLE to the private local sample");

  const initialCourseCount = await page.locator('[data-source="user"]').count();
  await selectPdfPath(page, samplePath!);
  const preview = page.getByRole("dialog", { name: "检查导入候选" });
  await expect(preview).toBeVisible();
  await expect(page.getByTestId("pdf-candidate-summary")).toContainText("识别到 18 个候选");
  await expect(page.getByTestId("pdf-candidate-summary")).toContainText("固定安排 15");
  await expect(page.getByTestId("pdf-candidate-summary")).toContainText("非固定实践 3");
  await expect(preview.locator('[data-candidate-kind="fixed"]')).toHaveCount(15);
  await expect(preview.locator('[data-candidate-kind="practice"]')).toHaveCount(3);
  await expect(preview.getByRole("button", { name: "进入最终确认" })).toBeDisabled();

  const fixed = preview.locator('[data-candidate-kind="fixed"]').first();
  const originalName = await fixed.locator(".candidate-card-heading strong").textContent();
  await fixed.getByRole("button", { name: /^编辑 /u }).click();
  const editor = preview.locator(".candidate-editor");
  await editor.getByLabel("课程名称").fill("不会保存的名称");
  await editor.getByRole("button", { name: "取消修改" }).click();
  await expect(fixed.locator(".candidate-card-heading strong")).toHaveText(originalName!);

  await preview.getByRole("button", { name: "打开作息设置" }).click();
  const settings = page.getByRole("dialog", { name: "作息时间" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "添加节次" }).click();
  await settings.getByRole("button", { name: "保存作息" }).click();
  await expect(settings).toHaveCount(0);
  await expect(preview.getByRole("button", { name: "打开作息设置" })).toHaveCount(0);
  await expect(preview.getByText(/已生成 15\/18 条课程提案/u)).toBeVisible();

  await completePracticeCandidates(preview);
  await expect(preview.getByText(/已生成 18\/18 条课程提案/u)).toBeVisible();
  await expect(preview.getByRole("button", { name: "进入最终确认" })).toBeEnabled();
  await preview.getByRole("button", { name: "进入最终确认" }).click();
  let finalReview = page.getByRole("dialog", { name: "确认导入课程" });
  await expect(finalReview).toBeVisible();
  await expect(page.getByTestId("pdf-final-summary")).toContainText("提案 18");
  await finalReview.getByRole("button", { name: "返回修改" }).click();
  await expect(preview.locator('[data-candidate-kind="practice"]')).toHaveCount(3);
  await expect(preview.getByText(/已生成 18\/18 条课程提案/u)).toBeVisible();
  await preview.getByRole("button", { name: "进入最终确认" }).click();
  finalReview = page.getByRole("dialog", { name: "确认导入课程" });
  await finalReview.getByRole("button", { name: "取消本次导入", exact: true }).click();
  await expect(finalReview).toHaveCount(0);
  await expect(page.locator('[data-source="user"]')).toHaveCount(initialCourseCount);

  await selectPdfPath(page, samplePath!);
  const secondPreview = page.getByRole("dialog", { name: "检查导入候选" });
  await completePracticeCandidates(secondPreview);
  await secondPreview.getByRole("button", { name: "进入最终确认" }).click();
  finalReview = page.getByRole("dialog", { name: "确认导入课程" });
  await expect(page.getByTestId("pdf-final-summary")).toContainText("重复 0");

  await page.evaluate(() => {
    const host = window as Window & { __rejectCourseImport?: () => void };
    let attempts = 0;
    let rejectImport: ((reason: string) => void) | undefined;
    host.__rejectCourseImport = () => rejectImport?.("模拟批量写入失败，数据库已回滚。");
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: (command: string, args: { courses?: unknown }) => {
          if (command !== "import_courses") throw new Error(`未预期的命令：${command}`);
          attempts += 1;
          if (attempts === 1) {
            return new Promise((_, reject) => {
              rejectImport = reject;
            });
          }
          return Promise.resolve(args.courses);
        },
      },
    });
  });
  await finalReview.getByRole("button", { name: "确认导入 18 条课程" }).click();
  await expect(finalReview.getByRole("button", { name: "返回修改" })).toBeDisabled();
  await expect(
    finalReview.getByRole("button", { name: "取消本次导入", exact: true }),
  ).toBeDisabled();
  await expect(finalReview.getByRole("button", { name: "正在导入…" })).toBeDisabled();
  await page.evaluate(() => {
    (window as Window & { __rejectCourseImport?: () => void }).__rejectCourseImport?.();
  });
  await expect(finalReview.getByRole("alert")).toContainText("模拟批量写入失败");
  await expect(page.locator('[data-source="user"]')).toHaveCount(initialCourseCount);
  await finalReview.getByRole("button", { name: "确认导入 18 条课程" }).click();
  await expect(finalReview).toHaveCount(0);
  await expect(page.getByText("已导入 18 条课程安排，跳过 0 条重复课程。")).toBeVisible();
  const importedVisibleCount = await page.locator('[data-source="user"]').count();
  expect(importedVisibleCount).toBeGreaterThan(initialCourseCount);
  await page.evaluate(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  await selectPdfPath(page, samplePath!);
  const duplicatePreview = page.getByRole("dialog", { name: "检查导入候选" });
  await completePracticeCandidates(duplicatePreview);
  await duplicatePreview.getByRole("button", { name: "进入最终确认" }).click();
  finalReview = page.getByRole("dialog", { name: "确认导入课程" });
  await expect(page.getByTestId("pdf-final-summary")).toContainText("重复 18");
  await expect(finalReview.locator('[data-plan-action="skip-duplicate"]')).toHaveCount(18);
  await finalReview.getByRole("button", { name: "确认导入 0 条课程" }).click();
  await expect(page.getByText("已导入 0 条课程安排，跳过 18 条重复课程。")).toBeVisible();
  await expect(page.locator('[data-source="user"]')).toHaveCount(importedVisibleCount);
});

test("actual minutes determine top, height and four-hour blank space", async ({ page }) => {
  const monday = await box(page.locator('[data-weekday="1"]'));
  const morning = await box(page.locator('[data-course-id="monday-morning"]'));
  const afternoon = await box(page.locator('[data-course-id="monday-afternoon"]'));
  expect(morning.y - monday.y).toBeCloseTo(60, 0);
  expect(morning.height).toBeCloseTo(120, 0);
  expect(afternoon.y - monday.y).toBeCloseTo(420, 0);
  expect(afternoon.height).toBeCloseTo(120, 0);
  expect(afternoon.y - (morning.y + morning.height)).toBeCloseTo(240, 0);

  const short = await box(page.locator('[data-course-id="wednesday-first"]'));
  expect(short.height).toBeCloseTo(45, 0);
});

test("period markers use real start times and preserve breaks", async ({ page }) => {
  const axis = await box(page.getByTestId("time-axis"));
  const first = page.locator('[data-period="1"]');
  const second = page.locator('[data-period="2"]');
  const third = page.locator('[data-period="3"]');
  const sixth = page.locator('[data-period="6"]');
  await expect(first).toContainText("第1节");
  await expect(first.locator(".period-start")).toHaveText("08:00");
  await expect(first.locator(".period-end")).toHaveText("08:45");
  const firstBox = await box(first);
  const secondBox = await box(second);
  const thirdBox = await box(third);
  const sixthBox = await box(sixth);
  expect(firstBox.y - axis.y).toBeCloseTo(60, 0);
  expect(secondBox.y - axis.y).toBeCloseTo(110, 0);
  expect(secondBox.y - (firstBox.y + firstBox.height)).toBeCloseTo(5, 0);
  expect(thirdBox.y - (secondBox.y + secondBox.height)).toBeCloseTo(20, 0);
  expect(sixthBox.y - axis.y).toBeCloseTo(420, 0);
  const wednesday = await box(page.locator('[data-weekday="3"]'));
  const exactCourse = await box(page.locator('[data-course-id="wednesday-first"]'));
  expect(exactCourse.y - wednesday.y).toBeCloseTo(firstBox.y - axis.y, 0);
  expect(exactCourse.height).toBeCloseTo(firstBox.height, 0);
  await expect(page.locator(".period-guide")).toHaveCount(0);
  await expect(page.locator('[data-weekday="3"]')).toHaveCSS("background-image", /linear-gradient/);
  await expect(page.locator('[data-course-id="wednesday-first"] .course-time')).toContainText(
    "第1节 · 08:00–08:45",
  );
});

test("a user course without stored periods shows time without a fabricated period", async ({
  page,
}) => {
  const card = await addUserCourse(page, { name: "无节次用户课程" });
  await expect(card.locator(".course-time")).toHaveText("14:00–15:30");
  await expect(card.locator(".course-time")).not.toContainText("节");
});

test("period settings save custom proportions and can add a twelfth period", async ({ page }) => {
  await page.getByRole("button", { name: "设置" }).click();
  const dialog = page.getByRole("dialog", { name: "作息时间" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("period-row")).toHaveCount(11);
  await dialog.getByLabel("第1节结束时间").fill("08:30");
  await dialog.getByLabel("第2节开始时间").fill("08:45");
  await dialog.getByRole("button", { name: "保存作息" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("schedule-notice")).toHaveText("已使用自定义作息。");
  await expect(page.locator('[data-period="1"]')).toHaveCSS("height", "30px");
  const axis = await box(page.getByTestId("time-axis"));
  const first = await box(page.locator('[data-period="1"]'));
  const firstLabel = await box(page.locator('[data-period="1"] strong'));
  const firstStart = await box(page.locator('[data-period="1"] .period-start'));
  const firstEnd = await box(page.locator('[data-period="1"] .period-end'));
  const second = await box(page.locator('[data-period="2"]'));
  expect(first.y - axis.y).toBeCloseTo(60, 0);
  expect(second.y - (first.y + first.height)).toBeCloseTo(15, 0);
  expect(firstStart.y).toBeGreaterThan(firstLabel.y);
  expect(firstEnd.y).toBeGreaterThan(firstStart.y);
  const unchangedCourse = page.locator('[data-course-id="wednesday-first"]');
  await expect(unchangedCourse).toHaveCSS("height", "45px");
  await expect(unchangedCourse.locator(".course-time")).toHaveText("08:00–08:45");

  await page.getByRole("button", { name: "设置" }).click();
  const secondDialog = page.getByRole("dialog", { name: "作息时间" });
  await secondDialog.getByRole("button", { name: "添加节次" }).click();
  await expect(secondDialog.getByTestId("period-row")).toHaveCount(12);
  await secondDialog.getByRole("button", { name: "保存作息" }).click();
  await expect(page.locator('[data-period="12"]')).toBeVisible();
});

test("term and reminder settings validate and persist with the schedule", async ({ page }) => {
  await page.getByRole("button", { name: "设置" }).click();
  const dialog = page.getByRole("dialog", { name: "作息时间" });
  await expect(dialog.getByText("学期与课程提醒")).toBeVisible();
  await dialog.getByLabel("启用课程提醒").check();
  await dialog.getByRole("button", { name: "保存作息" }).click();
  await expect(dialog.getByRole("alert")).toContainText("第 1 教学周");
  await dialog.getByLabel("第 1 教学周星期一").fill("2026-09-07");
  await dialog.getByLabel("总教学周数").fill("18");
  await dialog.getByLabel("提前提醒分钟").fill("60");
  await dialog.getByRole("button", { name: "保存作息" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "设置" }).click();
  const reopened = page.getByRole("dialog", { name: "作息时间" });
  await expect(reopened.getByLabel("第 1 教学周星期一")).toHaveValue("2026-09-07");
  await expect(reopened.getByLabel("启用课程提醒")).toBeChecked();
  await expect(reopened.getByLabel("提前提醒分钟")).toHaveValue("60");
});

test("Windows 登录启动开关默认关闭且能立即启用或关闭", async ({ page }) => {
  await page.getByRole("button", { name: "设置" }).click();
  const dialog = page.getByRole("dialog", { name: "作息时间" });
  const toggle = dialog.getByLabel("登录 Windows 后自动启动应用");
  await expect(dialog.getByText("启动设置")).toBeVisible();
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(toggle).not.toBeChecked();
});

test("Windows 登录启动失败和系统状态不一致不会显示伪成功", async ({ page }) => {
  await page.addInitScript(() => {
    let enabled = false;
    let enableAttempts = 0;
    let disableAttempts = 0;
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string) => {
          if (command === "load_courses") return { courses: [], warnings: [] };
          if (command === "load_period_times") return null;
          if (command === "load_reminder_configuration") {
            return {
              termConfig: null,
              reminderSettings: { enabled: false, advanceMinutes: 15 },
              warnings: [],
            };
          }
          if (command === "load_handled_reminder_keys") return [];
          if (command === "refresh_reminder_schedule") return undefined;
          if (command === "plugin:autostart|is_enabled") return enabled;
          if (command === "plugin:autostart|enable") {
            enableAttempts += 1;
            if (enableAttempts === 1) throw "开启失败";
            if (enableAttempts === 2) {
              enabled = true;
              return undefined;
            }
            return undefined;
          }
          if (command === "plugin:autostart|disable") {
            disableAttempts += 1;
            if (disableAttempts === 1) throw "关闭失败";
            enabled = false;
            return undefined;
          }
          throw "未预期的命令";
        },
      },
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "设置" }).click();
  const dialog = page.getByRole("dialog", { name: "作息时间" });
  const toggle = dialog.getByLabel("登录 Windows 后自动启动应用");
  await expect(toggle).not.toBeChecked();

  await toggle.click();
  await expect(dialog.getByRole("alert")).toContainText("开启失败");
  await expect(toggle).not.toBeChecked();

  await toggle.click();
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(dialog.getByRole("alert")).toContainText("关闭失败");
  await expect(toggle).toBeChecked();

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(dialog.getByRole("alert")).toContainText("系统未确认已开启");
  await expect(toggle).not.toBeChecked();
});

test("invalid period settings are blocked and cancel keeps the previous schedule", async ({
  page,
}) => {
  await page.getByRole("button", { name: "设置" }).click();
  const dialog = page.getByRole("dialog", { name: "作息时间" });
  await dialog.getByLabel("第1节结束时间").fill("09:00");
  await dialog.getByRole("button", { name: "保存作息" }).click();
  await expect(dialog.getByRole("alert")).toContainText("时间重叠");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(page.locator('[data-period="12"]')).toHaveCount(0);
  await expect(page.locator('[data-period="1"]')).toHaveCSS("height", "45px");
});

test("failed schedule save keeps the old timeline", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string) => {
          if (command === "load_courses") return { courses: [], warnings: [] };
          if (command === "load_period_times") {
            return [
              { period: 1, startTime: "08:00", endTime: "08:45" },
              { period: 2, startTime: "08:50", endTime: "09:35" },
            ];
          }
          if (command === "load_reminder_configuration") {
            return {
              termConfig: null,
              reminderSettings: { enabled: false, advanceMinutes: 15 },
              warnings: [],
            };
          }
          if (command === "save_app_settings") throw "保存设置失败，请稍后重试。";
          if (command === "plugin:autostart|is_enabled") return false;
          throw "未预期的存储命令";
        },
      },
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "设置" }).click();
  const dialog = page.getByRole("dialog", { name: "作息时间" });
  await dialog.getByLabel("第1节结束时间").fill("08:30");
  await dialog.getByRole("button", { name: "保存作息" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("保存设置失败，请稍后重试。");
  await expect(page.locator('[data-period="1"]')).toHaveCSS("height", "45px");
});

test("overlap chain is visible in two lanes", async ({ page }) => {
  const first = await box(page.locator('[data-course-id="tuesday-overlap-a"]'));
  const second = await box(page.locator('[data-course-id="tuesday-overlap-b"]'));
  const third = await box(page.locator('[data-course-id="tuesday-overlap-chain"]'));
  expect(first.x).not.toBeCloseTo(second.x, 0);
  expect(first.width).toBeCloseTo(second.width, 0);
  expect(first.x).toBeCloseTo(third.x, 0);
  await expect(page.locator('[data-course-id="tuesday-overlap-a"]')).toHaveAttribute(
    "data-lane-count",
    "2",
  );
  await expect(page.locator('[data-course-id="tuesday-overlap-chain"]')).toHaveAttribute(
    "data-lane-count",
    "2",
  );
  const chain = page.locator('[data-course-id="tuesday-overlap-chain"]');
  await expect(chain).toHaveAttribute("data-text-density", "micro");
  await expect(chain.locator(".course-classroom")).toContainText("测试室 103");
  await expect(chain.locator(".course-teacher")).toContainText("测试教师己");
});

test("long title stays inside its fixed-height card", async ({ page }) => {
  const card = page.locator('[data-course-id="thursday-long-name"]');
  await expect(card).toContainText("毛泽东思想和中国特色社会主义理论体系概论");
  const cardBox = await box(card);
  const titleBox = await box(card.locator(".course-name"));
  const overflow = await card.evaluate((element) => getComputedStyle(element).overflow);
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
  expect(overflow).toBe("hidden");
});

test("desktop columns and cards keep readable horizontal space", async ({ page }) => {
  const monday = await box(page.locator('[data-weekday="1"]'));
  const card = page.locator('[data-course-id="monday-morning"]');
  const name = card.locator(".course-name");
  expect(monday.width).toBeGreaterThanOrEqual(154);
  await expect(card).toHaveCSS("border-radius", "12px");
  await expect(name).toHaveCSS("writing-mode", "horizontal-tb");
  await expect(name).toHaveCSS("font-size", "14px");
});

test("short cards retain course details with a smaller type scale", async ({ page }) => {
  const card = page.locator('[data-course-id="wednesday-first"]');
  await expect(card).toHaveAttribute("data-density", "compact");
  await expect(card).toHaveAttribute("data-text-density", "micro");
  await expect(card.locator(".course-name")).toBeVisible();
  await expect(card.locator(".course-time")).toBeVisible();
  await expect(card.locator(".course-classroom")).toBeVisible();
  await expect(card.locator(".course-teacher")).toBeVisible();
  await expect(card.locator(".course-classroom")).toContainText("测试楼 C-101");
  await expect(card.locator(".course-teacher")).toContainText("测试教师庚");
  await expect(card.locator(".course-name")).toHaveCSS("font-size", "8px");
  await expect(card.locator(".course-time")).toHaveCSS("font-size", "7px");
  expect((await box(card)).height).toBeCloseTo(45, 0);
});

test("overlap lanes have distinct fixed visual treatments", async ({ page }) => {
  const first = page.locator('[data-course-id="tuesday-overlap-a"]');
  const second = page.locator('[data-course-id="tuesday-overlap-b"]');
  const colors = await Promise.all(
    [first, second].map((card) =>
      card.evaluate((element) => ({
        background: getComputedStyle(element).backgroundColor,
        border: getComputedStyle(element).borderLeftColor,
      })),
    ),
  );
  expect(colors[0]).not.toEqual(colors[1]);
});

test("first and last hour labels stay inside the time axis", async ({ page }) => {
  const axis = await box(page.getByTestId("time-axis"));
  const ticks = page.locator(".time-axis time");
  const first = await box(ticks.first());
  const last = await box(ticks.last());
  expect(first.y).toBeGreaterThanOrEqual(axis.y);
  expect(last.y + last.height).toBeLessThanOrEqual(axis.y + axis.height);
});

test("one scroll area keeps headers and time axis aligned", async ({ page }) => {
  const scroll = page.getByTestId("timetable-scroll");
  const before = await box(scroll);
  const axisBefore = await box(page.getByTestId("time-axis"));
  await scroll.evaluate((element) => {
    element.scrollTop = 300;
    element.scrollLeft = 180;
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const header = await box(page.locator(".day-header").first());
  const axisAfter = await box(page.getByTestId("time-axis"));
  expect(header.y).toBeCloseTo(before.y + 1, 0);
  expect(axisAfter.x).toBeCloseTo(axisBefore.x, 0);
  const state = await scroll.evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollLeft: element.scrollLeft,
    vertical: element.scrollHeight > element.clientHeight,
    horizontal: element.scrollWidth > element.clientWidth,
  }));
  expect(state.scrollTop).toBeGreaterThan(0);
  if (state.horizontal) expect(state.scrollLeft).toBeGreaterThan(0);
  else expect(state.scrollLeft).toBe(0);
  expect(state.vertical).toBe(true);
  const pageOverflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    vertical: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  }));
  expect(pageOverflow).toEqual({ horizontal: false, vertical: false });
});

test("small window scrolls horizontally instead of crushing cards", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("900-"), "small viewport project only");
  const scroll = page.getByTestId("timetable-scroll");
  const dimensions = await scroll.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
  const day = await box(page.locator('[data-weekday="1"]'));
  expect(day.width).toBeGreaterThanOrEqual(149);
});

test("course form opens, reports field errors and cancel makes no change", async ({ page }) => {
  await page.getByRole("button", { name: "添加课程" }).click();
  const dialog = page.getByRole("dialog", { name: "添加课程" });
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "保存课程" }).click();
  await expect(page.getByText("课程名称不能为空")).toBeVisible();
  await expect(page.getByText("请输入有效的开始时间")).toBeVisible();
  await expect(page.getByText("请输入有效的结束时间")).toBeVisible();
  await expect(page.getByText("上课周数不能为空")).toBeVisible();
  await expect(page.locator('[data-source="user"]')).toHaveCount(0);
  await page.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-source="user"]')).toHaveCount(0);
});

test("validated course appears on the correct day with real-time geometry", async ({ page }) => {
  await page.getByRole("button", { name: "添加课程" }).click();
  const dialog = page.getByRole("dialog", { name: "添加课程" });
  await dialog.getByLabel("课程名称", { exact: true }).fill(" 机械设计基础 ");
  await dialog.getByLabel("教师（可选）").fill("测试教师");
  await dialog.getByLabel("教室（可选）").fill("JX02-407");
  await dialog.getByLabel("星期").selectOption("3");
  await dialog.getByLabel("开始时间").fill("14:00");
  await dialog.getByLabel("结束时间").fill("15:30");
  await dialog.getByLabel("上课周数").fill("1-16");
  await page.getByRole("button", { name: "保存课程" }).click();

  await expect(page.getByRole("dialog", { name: "添加课程" })).toHaveCount(0);
  const card = page.locator('[data-weekday="3"] [data-source="user"]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("机械设计基础");
  await expect(card).toContainText("用户添加");
  await expect(card).toHaveAttribute("data-duration-minutes", "90");
  const day = await box(page.locator('[data-weekday="3"]'));
  const cardBox = await box(card);
  expect(cardBox.y - day.y).toBeCloseTo(420, 0);
  expect(cardBox.height).toBeCloseTo(90, 0);
});

test("invalid course stays in the form with errors beside its fields", async ({ page }) => {
  await page.getByRole("button", { name: "添加课程" }).click();
  const dialog = page.getByRole("dialog", { name: "添加课程" });
  await dialog.getByLabel("课程名称", { exact: true }).fill("测试课程");
  await dialog.getByLabel("开始时间").fill("15:30");
  await dialog.getByLabel("结束时间").fill("14:00");
  await dialog.getByLabel("上课周数").fill("1-4,,7");
  await page.getByRole("button", { name: "保存课程" }).click();
  await expect(page.getByText("结束时间必须晚于开始时间，且不能跨午夜")).toBeVisible();
  await expect(page.getByText("周数格式不正确，请使用 1-4,7,10-12")).toBeVisible();
  await expect(page.locator('[data-source="user"]')).toHaveCount(0);
});

test("long Chinese user course name remains inside its real-height card", async ({ page }) => {
  const longName = "高等工程数学与现代制造系统综合设计实验课程长名称可读性测试";
  await page.getByRole("button", { name: "添加课程" }).click();
  const dialog = page.getByRole("dialog", { name: "添加课程" });
  await dialog.getByLabel("课程名称", { exact: true }).fill(longName);
  await dialog.getByLabel("星期").selectOption("5");
  await dialog.getByLabel("开始时间").fill("10:00");
  await dialog.getByLabel("结束时间").fill("10:45");
  await dialog.getByLabel("上课周数").fill("3");
  await page.getByRole("button", { name: "保存课程" }).click();
  const card = page.locator('[data-weekday="5"] [data-source="user"]');
  await expect(card).toHaveAttribute("data-density", "compact");
  const cardBox = await box(card);
  const nameBox = await box(card.locator(".course-name"));
  expect(cardBox.height).toBeCloseTo(45, 0);
  expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  expect(nameBox.y + nameBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height);
  await expect(card).toHaveAttribute("title", new RegExp(longName));
});

test("only user courses are keyboard editable and edit keeps ID while moving geometry", async ({
  page,
}) => {
  await expect(page.locator(".course-edit-button")).toHaveCount(0);
  const original = await addUserCourse(page, { name: "机械设计基础" });
  const originalId = await original.getAttribute("data-course-id");
  await openUserCourseEditor(original);

  const dialog = page.getByRole("dialog", { name: "编辑课程" });
  await expect(dialog.getByLabel("课程名称", { exact: true })).toHaveValue("机械设计基础");
  await expect(dialog.getByLabel("教师（可选）")).toHaveValue("测试教师");
  await expect(dialog.getByLabel("教室（可选）")).toHaveValue("测试教室");
  await expect(dialog.getByLabel("星期")).toHaveValue("3");
  await expect(dialog.getByLabel("开始时间")).toHaveValue("14:00");
  await expect(dialog.getByLabel("结束时间")).toHaveValue("15:30");
  await expect(dialog.getByLabel("上课周数")).toHaveValue("1-16");

  await dialog.getByLabel("课程名称", { exact: true }).fill("机械原理");
  await dialog.getByLabel("教室（可选）").fill("JX03-201");
  await dialog.getByLabel("星期").selectOption("4");
  await dialog.getByLabel("开始时间").fill("09:00");
  await dialog.getByLabel("结束时间").fill("10:30");
  await dialog.getByRole("button", { name: "保存修改" }).click();

  await expect(page.locator('[data-weekday="3"] [data-source="user"]')).toHaveCount(0);
  const edited = page.locator('[data-weekday="4"] [data-source="user"]');
  await expect(edited).toHaveCount(1);
  await expect(edited).toContainText("机械原理");
  await expect(edited).toContainText("JX03-201");
  await expect(edited).toHaveAttribute("data-course-id", originalId!);
  const day = await box(page.locator('[data-weekday="4"]'));
  const editedBox = await box(edited);
  expect(editedBox.y - day.y).toBeCloseTo(120, 0);
  expect(editedBox.height).toBeCloseTo(90, 0);
});

test("editing weeks can hide a course without deleting it", async ({ page }) => {
  const card = await addUserCourse(page, { name: "周数调整课程" });
  await openUserCourseEditor(card);
  const dialog = page.getByRole("dialog", { name: "编辑课程" });
  await dialog.getByLabel("上课周数").fill("4-8,10,12-15");
  await dialog.getByRole("button", { name: "保存修改" }).click();
  await expect(page.locator('[data-source="user"]')).toHaveCount(0);
});

test("invalid edit is blocked and cancel preserves the original course", async ({ page }) => {
  const card = await addUserCourse(page, { name: "不可破坏课程" });
  const originalId = await card.getAttribute("data-course-id");
  const originalTitle = await card.getAttribute("title");
  await openUserCourseEditor(card);
  const dialog = page.getByRole("dialog", { name: "编辑课程" });
  await dialog.getByLabel("课程名称", { exact: true }).fill("");
  await dialog.getByLabel("开始时间").fill("15:30");
  await dialog.getByLabel("结束时间").fill("14:00");
  await dialog.getByLabel("上课周数").fill("abc");
  await dialog.getByRole("button", { name: "保存修改" }).click();
  await expect(dialog.getByText("课程名称不能为空")).toBeVisible();
  await expect(dialog.getByText("结束时间必须晚于开始时间，且不能跨午夜")).toBeVisible();
  await expect(dialog.getByText("周数格式不正确，请使用 1-4,7,10-12")).toBeVisible();

  await dialog.getByLabel("课程名称", { exact: true }).fill("越界修改");
  await dialog.getByLabel("开始时间").fill("06:00");
  await dialog.getByLabel("结束时间").fill("07:00");
  await dialog.getByLabel("上课周数").fill("1-16");
  await dialog.getByRole("button", { name: "保存修改" }).click();
  await expect(dialog.getByText("课程时间超出当前显示范围（07:00–22:00）")).toBeVisible();
  await dialog.getByRole("button", { name: "取消" }).click();

  const unchanged = page.locator(`[data-course-id="${originalId}"]`);
  await expect(unchanged).toHaveCount(1);
  await expect(unchanged).toHaveAttribute("title", originalTitle!);
  await expect(page.getByText("越界修改", { exact: true })).toHaveCount(0);
});

test("edit cancel discards every changed field without creating a copy", async ({ page }) => {
  const card = await addUserCourse(page, { name: "保持原样课程", classroom: "原教室" });
  const id = await card.getAttribute("data-course-id");
  await openUserCourseEditor(card);
  const dialog = page.getByRole("dialog", { name: "编辑课程" });
  await dialog.getByLabel("课程名称", { exact: true }).fill("不应保存");
  await dialog.getByLabel("星期").selectOption("6");
  await dialog.getByLabel("开始时间").fill("08:00");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(page.locator('[data-source="user"]')).toHaveCount(1);
  await expect(page.locator(`[data-course-id="${id}"]`)).toContainText("保持原样课程");
  await expect(page.locator(`[data-course-id="${id}"]`)).toContainText("原教室");
  await expect(page.getByText("不应保存", { exact: true })).toHaveCount(0);
});

test("delete confirmation supports cancel and then removes by course ID", async ({ page }) => {
  let card = await addUserCourse(page, { name: "待删除课程" });
  await openUserCourseEditor(card);
  let dialog = page.getByRole("dialog", { name: "编辑课程" });
  await dialog.getByRole("button", { name: "删除 待删除课程" }).click();
  await expect(dialog.getByText("确定删除“待删除课程”吗？")).toBeVisible();
  await dialog.getByRole("button", { name: "保留课程" }).click();
  await expect(dialog.getByText("确定删除“待删除课程”吗？")).toHaveCount(0);
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(page.locator('[data-source="user"]')).toHaveCount(1);

  card = page.locator('[data-source="user"]');
  await openUserCourseEditor(card);
  dialog = page.getByRole("dialog", { name: "编辑课程" });
  await dialog.getByRole("button", { name: "删除 待删除课程" }).click();
  await dialog.getByRole("button", { name: "确认删除 待删除课程" }).click();
  await expect(page.locator('[data-source="user"]')).toHaveCount(0);
});

test("deleting an overlap recalculates the remaining course to one lane", async ({ page }) => {
  const first = await addUserCourse(page, {
    name: "用户重叠 A",
    weekday: "6",
    startTime: "08:00",
    endTime: "09:30",
    weeks: "3",
  });
  const second = await addUserCourse(page, {
    name: "用户重叠 B",
    weekday: "6",
    startTime: "09:00",
    endTime: "10:00",
    weeks: "3",
  });
  await expect(first).toHaveAttribute("data-lane-count", "2");
  await expect(second).toHaveAttribute("data-lane-count", "2");
  await openUserCourseEditor(second);
  const dialog = page.getByRole("dialog", { name: "编辑课程" });
  await dialog.getByRole("button", { name: "删除 用户重叠 B" }).click();
  await dialog.getByRole("button", { name: "确认删除 用户重叠 B" }).click();
  await expect(page.locator('[data-source="user"]')).toHaveCount(1);
  await expect(first).toHaveAttribute("data-lane", "0");
  await expect(first).toHaveAttribute("data-lane-count", "1");
});

test("storage failures keep the original UI state and show a clear error", async ({ page }) => {
  await page.addInitScript(() => {
    const storedCourse = {
      id: "storage-failure-course",
      name: "数据库原课程",
      teacher: null,
      classroom: null,
      weekday: 3,
      startPeriod: null,
      endPeriod: null,
      startTime: "14:00",
      endTime: "15:30",
      weeks: [1, 2, 3],
    };
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string) => {
          if (command === "load_courses") return { courses: [storedCourse], warnings: [] };
          if (command === "load_period_times") return null;
          if (command === "load_reminder_configuration") {
            return {
              termConfig: null,
              reminderSettings: { enabled: false, advanceMinutes: 15 },
              warnings: [],
            };
          }
          if (command === "update_course") throw "更新课程失败，请稍后重试。";
          if (command === "delete_course") throw "删除课程失败，请稍后重试。";
          throw "未预期的存储命令";
        },
      },
    });
  });
  await page.reload();
  const original = page.locator('[data-course-id="storage-failure-course"]');
  await openUserCourseEditor(original);
  let dialog = page.getByRole("dialog", { name: "编辑课程" });
  await dialog.getByLabel("课程名称", { exact: true }).fill("不应保存的修改");
  await dialog.getByRole("button", { name: "保存修改" }).click();
  await expect(dialog.getByText("更新课程失败，请稍后重试。")).toBeVisible();
  await expect(original).toContainText("数据库原课程");
  await dialog.getByRole("button", { name: "取消" }).click();

  await openUserCourseEditor(original);
  dialog = page.getByRole("dialog", { name: "编辑课程" });
  await dialog.getByRole("button", { name: "删除 数据库原课程" }).click();
  await dialog.getByRole("button", { name: "确认删除 数据库原课程" }).click();
  await expect(dialog.getByText("删除课程失败，请稍后重试。")).toBeVisible();
  await expect(original).toHaveCount(1);
});

test("a failed insert does not create a course in the UI", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string) => {
          if (command === "load_courses") return { courses: [], warnings: [] };
          if (command === "load_period_times") return null;
          if (command === "load_reminder_configuration") {
            return {
              termConfig: null,
              reminderSettings: { enabled: false, advanceMinutes: 15 },
              warnings: [],
            };
          }
          if (command === "insert_course") throw "保存课程失败，请稍后重试。";
          throw "未预期的存储命令";
        },
      },
    });
  });
  await page.reload();
  await addUserCourse(page, { name: "不应出现的课程" });
  const dialog = page.getByRole("dialog", { name: "添加课程" });
  await expect(dialog.getByText("保存课程失败，请稍后重试。")).toBeVisible();
  await expect(page.locator('[data-source="user"]')).toHaveCount(0);
});

test("a stored course outside the current axis is skipped without crashing", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string) => {
          if (command === "load_period_times") return null;
          if (command === "load_reminder_configuration") {
            return {
              termConfig: null,
              reminderSettings: { enabled: false, advanceMinutes: 15 },
              warnings: [],
            };
          }
          if (command !== "load_courses") throw "未预期的存储命令";
          return {
            courses: [
              {
                id: "outside-axis",
                name: "轴外损坏课程",
                teacher: null,
                classroom: null,
                weekday: 3,
                startPeriod: null,
                endPeriod: null,
                startTime: "06:00",
                endTime: "07:00",
                weeks: [3],
              },
            ],
            warnings: [],
          };
        },
      },
    });
  });
  await page.reload();
  await expect(
    page.getByText("课程“轴外损坏课程”超出当前显示范围，已跳过且未修改原数据。"),
  ).toBeVisible();
  await expect(page.locator('[data-course-id="outside-axis"]')).toHaveCount(0);
  await expect(page.getByTestId("day-column")).toHaveCount(7);
});

test("unsupported database version leaves the app usable but disables writes", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: async (command: string) => {
          if (command === "load_courses") {
            throw "本地课程数据暂时无法加载：数据库来自较新版本，请升级应用后重试。";
          }
          throw "存储不可用";
        },
      },
    });
  });
  await page.reload();
  await expect(
    page.getByText("本地课程数据暂时无法加载：数据库来自较新版本，请升级应用后重试。"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "添加课程" })).toBeDisabled();
  await expect(page.getByTestId("day-column")).toHaveCount(7);
});
