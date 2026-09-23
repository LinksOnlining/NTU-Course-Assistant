import { expect, test } from "@playwright/test";

async function openApp(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Links Workplace" })).toBeVisible();
}

async function chooseTheme(page: import("@playwright/test").Page, preference: string) {
  await page.getByRole("button", { name: "设置" }).click();
  await page
    .getByRole("navigation", { name: "设置分类" })
    .getByRole("button", { name: "外观" })
    .click();
  await page.getByRole("dialog", { name: "设置" }).getByLabel("主题").selectOption(preference);
}

test("defaults to light and a manual theme choice applies and persists", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await chooseTheme(page, "dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const darkSettings = await page.evaluate(() => {
    const dialog = document.querySelector(".course-form-dialog");
    const heading = dialog?.querySelector("h2");
    return {
      surface: dialog ? getComputedStyle(dialog).backgroundColor : "",
      text: heading ? getComputedStyle(heading).color : "",
    };
  });
  expect(darkSettings.surface).toBe("rgb(40, 49, 46)");
  expect(darkSettings.text).toBe("rgb(238, 245, 242)");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await chooseTheme(page, "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("system preference follows live color-scheme changes", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openApp(page);
  await chooseTheme(page, "system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("dark schedule, Academic Hub, and settings retain readable surfaces", async ({ page }) => {
  await openApp(page);
  await chooseTheme(page, "dark");
  await page.getByRole("button", { name: "关闭设置" }).click();
  await page
    .getByRole("navigation", { name: "产品模式" })
    .getByRole("button", { name: "课表" })
    .click();
  const scheduleSurface = await page
    .locator(".timetable-scroll")
    .evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(scheduleSurface).toContain("rgb(27, 33, 31)");
  await expect(page.locator(".course-card").first()).toBeVisible();
  const cardColor = await page
    .locator(".course-card")
    .first()
    .evaluate((element) => getComputedStyle(element).color);
  expect(cardColor).not.toBe("rgb(0, 0, 0)");
  await page.getByRole("button", { name: "设置" }).click();
  await expect(page.locator(".course-form-dialog")).toHaveCSS(
    "background-color",
    "rgb(40, 49, 46)",
  );

  await page.getByRole("button", { name: "关闭设置" }).click();
  await page
    .getByRole("navigation", { name: "课表二级导航" })
    .getByRole("button", { name: "学业事项" })
    .click();
  await expect(page.locator(".academic-hub")).toBeVisible();
  const hubTextColor = await page
    .locator(".academic-hub")
    .evaluate((element) => getComputedStyle(element.querySelector(".hub-empty") ?? element).color);
  expect(hubTextColor).toBe("rgb(188, 201, 196)");
});
