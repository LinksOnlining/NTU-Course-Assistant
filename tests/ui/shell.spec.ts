import { expect, test } from "@playwright/test";

async function openApp(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Links Workplace" })).toBeVisible();
  await expect(page.getByRole("button", { name: "设置" })).toBeEnabled();
}

test("默认进入工作台并显示本地日期与已核验每日寄语", async ({ page }) => {
  await openApp(page);
  const mode = page.getByRole("navigation", { name: "产品模式" });
  await expect(mode.getByRole("button", { name: "工作台" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(mode.getByRole("button", { name: "课表" })).not.toHaveAttribute(
    "aria-current",
    "page",
  );
  const expectedDate = await page.evaluate(
    () =>
      `${new Date().getMonth() + 1}月${new Date().getDate()}日 ${new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(new Date())}`,
  );
  await expect(page.locator(".shell-date")).toHaveText(expectedDate);
  await expect(page.locator(".shell-date")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/u);

  const quote = await page.locator(".shell-daily-quote").textContent();
  expect(quote).toContain("·");
  expect(quote).toBeTruthy();
  expect(quote).not.toMatch(/学而不思则罔|知之为知之|知者不惑/u);
  await expect(page.getByRole("button", { name: "导入 PDF" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "添加课程" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "回到本周" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "课表二级导航" })).toHaveCount(0);
});

test("自定义左上角名称在设置中即时生效并在刷新后保留", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "设置" }).click();
  await page
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "外观" })
    .click();
  const nameInput = page.getByRole("textbox", { name: "左上角显示名称" });
  await expect(nameInput).toHaveAttribute("maxlength", "240");
  await nameInput.fill("我自己的学习工作台");
  await expect(page.locator(".shell-brand h1")).toHaveText("我自己的学习工作台");
  await page.reload();
  await expect(page.locator(".shell-brand h1")).toHaveText("我自己的学习工作台");
  await page.getByRole("button", { name: "设置" }).click();
  await page
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "外观" })
    .click();
  await page.getByRole("button", { name: "恢复默认名称" }).click();
  await expect(page.locator(".shell-brand h1")).toHaveText("Links Workplace");
});

test("Links 顶栏提供独立空白拖动区，交互控件不在拖动区内", async ({ page }) => {
  await openApp(page);
  const header = page.locator(".shell-header");
  const dragRegion = header.locator(".shell-drag-region");
  const actions = header.locator(".shell-header-actions");
  await expect(dragRegion).toHaveAttribute("data-tauri-drag-region", "");
  await expect(header.getByRole("button", { name: /最小化|最大化|关闭窗口/u })).toHaveCount(0);

  const [dragBox, actionsBox] = await Promise.all([
    dragRegion.boundingBox(),
    actions.boundingBox(),
  ]);
  expect(dragBox).not.toBeNull();
  expect(actionsBox).not.toBeNull();
  expect(dragBox!.width).toBeGreaterThan(0);
  expect(dragBox!.x + dragBox!.width).toBeLessThanOrEqual(actionsBox!.x);

  await header
    .getByRole("navigation", { name: "产品模式" })
    .getByRole("button", { name: "课表" })
    .click();
  await expect(page.getByRole("heading", { name: "课表" })).toBeVisible();
  await header.getByRole("button", { name: "设置" }).click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
});

test("课表模式显示 Academic 导航与控件，并记住离开前的 Academic 页面", async ({ page }) => {
  await openApp(page);
  const mode = page.getByRole("navigation", { name: "产品模式" });
  await mode.getByRole("button", { name: "课表" }).focus();
  await mode.getByRole("button", { name: "课表" }).press("Enter");
  await expect(page.getByRole("heading", { name: "课表" })).toBeVisible();
  const subnav = page.getByRole("navigation", { name: "课表二级导航" });
  await expect(subnav.getByRole("button")).toHaveText([
    "周课表",
    "课程变化",
    "考试",
    "学期管理",
    "学业事项",
  ]);
  await expect(page.getByRole("button", { name: "导入 PDF" })).toBeVisible();
  await expect(page.getByRole("button", { name: "添加课程" })).toBeVisible();
  await subnav.getByRole("button", { name: "课程变化" }).click();
  await expect(page.getByRole("heading", { name: "课程变化" })).toBeVisible();
  await mode.getByRole("button", { name: "工作台" }).click();
  await expect(page.getByRole("navigation", { name: "课表二级导航" })).toHaveCount(0);
  await mode.getByRole("button", { name: "课表" }).click();
  await expect(
    page.getByRole("navigation", { name: "课表二级导航" }).getByRole("button", {
      name: "课程变化",
    }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "该模块尚未开放" })).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "课表二级导航" })
    .getByRole("button", { name: "学业事项" })
    .click();
  await expect(page.getByRole("heading", { name: "学业事项" })).toBeVisible();
  await expect(page.locator(".academic-hub")).toBeVisible();
  await expect(page.getByRole("heading", { name: "该模块尚未开放" })).toHaveCount(0);
});

test("设置可从两个产品模式打开和关闭，且保留当前页面与主题设置", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await expect(
    settings.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: "首页" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(settings.getByText("工作台首页采用当前默认布局。")).toBeVisible();
  await expect(
    settings.getByText(/Obsidian 与收件箱：从工作台进入；今日助手由你主动触发/u),
  ).toBeVisible();
  await expect(settings.locator(".settings-home-summary input")).toHaveCount(0);
  await settings
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "外观" })
    .click();
  await expect(settings.getByLabel("主题")).toHaveValue("light");
  await settings.getByRole("button", { name: "取消" }).click();
  await expect(settings).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "产品模式" }).getByRole("button", { name: "工作台" }),
  ).toHaveAttribute("aria-current", "page");

  const mode = page.getByRole("navigation", { name: "产品模式" });
  await mode.getByRole("button", { name: "课表" }).click();
  const subnav = page.getByRole("navigation", { name: "课表二级导航" });
  await subnav.getByRole("button", { name: "学期管理" }).click();
  await page.getByRole("button", { name: "设置" }).click();
  await expect(
    page.getByRole("navigation", { name: "设置分类" }).getByRole("button", { name: "作息" }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("dialog", { name: "设置" }).getByRole("button", { name: "取消" }).click();
  await expect(subnav.getByRole("button", { name: "学期管理" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("Shell 在浅色和深色下可见，并在桌面及最小窗口保持主要控件可用", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "设置" }).click();
  const settings = page.getByRole("dialog", { name: "设置" });
  await settings
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "外观" })
    .click();
  await settings.getByLabel("主题").selectOption("dark");
  await settings.getByRole("button", { name: "取消" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "Links Workplace" })).toBeVisible();

  const mode = page.getByRole("navigation", { name: "产品模式" });
  await mode.getByRole("button", { name: "课表" }).click();
  await expect(page.getByRole("navigation", { name: "课表二级导航" })).toBeVisible();
  await expect(page.getByRole("button", { name: "课程变化" })).toBeVisible();
  await expect(mode.getByRole("button", { name: "课表" })).toHaveAttribute("aria-current", "page");

  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1600, height: 900 },
    { width: 1366, height: 768 },
    { width: 720, height: 520 },
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>(".shell-header");
      const switcher = document.querySelector<HTMLElement>(".shell-mode-switch");
      const settingsButton = document.querySelector<HTMLElement>(".shell-settings-button");
      const subnav = document.querySelector<HTMLElement>(".academic-subnav");
      if (!header || !switcher || !settingsButton || !subnav) return null;
      const headerBox = header.getBoundingClientRect();
      const switchBox = switcher.getBoundingClientRect();
      const settingsBox = settingsButton.getBoundingClientRect();
      return {
        headerOverflow: header.scrollWidth > header.clientWidth,
        modeVisible: switchBox.width > 0 && switchBox.left >= headerBox.left,
        settingsVisible:
          settingsBox.width > 0 &&
          settingsBox.right <= headerBox.right &&
          settingsButton.disabled === false,
        subnavVisible: subnav.clientHeight > 0 && subnav.querySelectorAll("button").length === 5,
      };
    });
    expect(layout, `Shell viewport ${viewport.width}x${viewport.height}`).toEqual({
      headerOverflow: false,
      modeVisible: true,
      settingsVisible: true,
      subnavVisible: true,
    });
  }
});

test("课表导航重新进入定位到本周，手动切换期间不自动跳回", async ({ page }) => {
  await openApp(page);
  const mode = page.getByRole("navigation", { name: "产品模式" });
  await mode.getByRole("button", { name: "课表" }).click();
  const controls = page.locator(".week-controls");
  await expect(page.locator(".week-controls strong")).toHaveText("第 3 周");
  await page.getByRole("button", { name: "下一教学周" }).click();
  await expect(page.locator(".week-controls strong")).toHaveText("第 4 周");
  await page.waitForTimeout(50);
  await expect(page.locator(".week-controls strong")).toHaveText("第 4 周");
  await mode.getByRole("button", { name: "工作台" }).click();
  await mode.getByRole("button", { name: "课表" }).click();
  await expect(page.locator(".week-controls strong")).toHaveText("第 3 周");
  await expect(controls).toBeVisible();
});

test("顶部标题支持 60 个完整 emoji 并保持导航可点击", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "设置" }).click();
  await page
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "外观" })
    .click();
  const input = page.getByRole("textbox", { name: "左上角显示名称" });
  const title = "🌻".repeat(60);
  await input.fill("🌻".repeat(67));
  await expect(page.locator(".shell-brand h1")).toHaveText(title);
  await expect(page.getByText("当前 60/60 字。", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await page
    .getByRole("navigation", { name: "产品模式" })
    .getByRole("button", { name: "课表" })
    .click();
  await expect(page.getByRole("heading", { name: "课表", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".shell-brand h1")).toHaveText(title);
});

test("每日寄语离线可用，按日期缓存的 AI 短句可恢复本地库", async ({ page }) => {
  await openApp(page);
  const generated = "窗边有风，今天适合去看云。";
  await page.evaluate((text) => {
    const date = new Date();
    const key = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
    localStorage.setItem("links-workplace.daily-ai-quote", JSON.stringify({ date: key, text }));
    window.dispatchEvent(new Event("links-workplace:daily-quote-updated"));
  }, generated);
  await expect(page.locator(".shell-daily-quote")).toContainText(generated);
  await expect(page.locator(".shell-daily-quote")).toContainText("AI 生成");
  await page.reload();
  await expect(page.locator(".shell-daily-quote")).toContainText(generated);
  await page.getByRole("button", { name: "设置" }).click();
  await page
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "每日寄语" })
    .click();
  await expect(page.getByRole("button", { name: "使用 DeepSeek 生成今日短句" })).toBeVisible();
  await page.getByRole("button", { name: "恢复本地寄语" }).click();
  await expect(page.locator(".shell-daily-quote")).not.toContainText(generated);
  await page.reload();
  await expect(page.locator(".shell-daily-quote")).not.toContainText(generated);
});
