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
  expect(
    [
      "学而不思则罔，思而不学则殆。",
      "知之为知之，不知为不知，是知也。",
      "知者不惑，仁者不忧，勇者不惧。",
      "路漫漫其修远兮，吾将上下而求索。",
      "纸上得来终觉浅，绝知此事要躬行。",
      "山重水复疑无路，柳暗花明又一村。",
    ].some((text) => quote?.includes(text)),
  ).toBe(true);
  await expect(page.getByRole("button", { name: "导入 PDF" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "添加课程" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "回到本周" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "课表二级导航" })).toHaveCount(0);
});

test("课表模式显示 Academic 导航与控件，并记住离开前的 Academic 页面", async ({ page }) => {
  await openApp(page);
  const mode = page.getByRole("navigation", { name: "产品模式" });
  await mode.getByRole("button", { name: "课表" }).focus();
  await mode.getByRole("button", { name: "课表" }).press("Enter");
  await expect(page.getByRole("heading", { name: "大学课程表" })).toBeVisible();
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
  await expect(settings.getByText(/日记、收件箱与 AI：目前仅保留未开放入口/u)).toBeVisible();
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
