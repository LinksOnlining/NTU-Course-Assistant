import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("theme types and logic stay independent from application and UI layers", () => {
  for (const file of ["src/theme/types.ts", "src/theme/theme.ts"]) {
    assert.doesNotMatch(
      source(file),
      /from\s+["'][^"']*(?:react|tauri|services|application|components|academic|sqlite|database)/iu,
      `${file} must only use the browser platform and theme types`,
    );
  }
});

test("theme stylesheet declares the core semantic design tokens", () => {
  const css = source("src/theme/theme.css");
  for (const token of [
    "accent-primary",
    "accent-hover",
    "accent-pressed",
    "accent-subtle",
    "accent-border",
    "accent-text",
    "focus-ring",
    "current-time",
    "surface-app",
    "surface-primary",
    "text-primary",
    "text-secondary",
    "border-default",
  ]) {
    assert.match(css, new RegExp(`--${token}:`, "u"), `missing --${token}`);
  }
  assert.match(css, /:root\[data-theme="dark"\]/u);
});

test("main Academic styles consume semantic accent tokens instead of brand literals", () => {
  assert.doesNotMatch(
    source("src/styles.css"),
    /#(?:2f7b68|266b5a|286b5b|2e7d6e|5a9d8a|91bfb2|5a9382|e5f2ed|21614e)\b/iu,
  );
});

test("the desktop widget does not subscribe to the main window theme preference", () => {
  assert.doesNotMatch(source("src/components/WidgetPrototype.tsx"), /themePreference|applyTheme/iu);
});
