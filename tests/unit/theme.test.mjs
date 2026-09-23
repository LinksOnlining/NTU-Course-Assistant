import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyTheme,
  getThemePreference,
  parseThemePreference,
  resolveTheme,
  saveThemePreference,
  subscribeToSystemTheme,
  THEME_PREFERENCE_STORAGE_KEY,
} from "../../src/theme/index.ts";

function memoryStorage(value = null) {
  let stored = value;
  return {
    getItem: (key) => (key === THEME_PREFERENCE_STORAGE_KEY ? stored : null),
    setItem: (key, next) => {
      if (key === THEME_PREFERENCE_STORAGE_KEY) stored = next;
    },
    value: () => stored,
  };
}

test("missing and invalid theme preferences fall back to light", () => {
  assert.equal(getThemePreference(memoryStorage()), "light");
  assert.equal(parseThemePreference("invalid"), "light");
  assert.equal(getThemePreference(memoryStorage("invalid")), "light");
});

test("saved light and dark preferences are read from the presentation setting key", () => {
  assert.equal(getThemePreference(memoryStorage("light")), "light");
  assert.equal(getThemePreference(memoryStorage("dark")), "dark");
});

test("system preference resolves to either current system scheme", () => {
  assert.equal(resolveTheme("system", "light"), "light");
  assert.equal(resolveTheme("system", "dark"), "dark");
  assert.equal(resolveTheme("light", "dark"), "light");
  assert.equal(resolveTheme("dark", "light"), "dark");
});

test("setting a preference persists immediately", () => {
  const storage = memoryStorage();
  saveThemePreference("dark", storage);
  assert.equal(storage.value(), "dark");
});

test("storage failures safely fall back and do not escape", () => {
  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(getThemePreference(broken), "light");
  assert.doesNotThrow(() => saveThemePreference("dark", broken));
});

test("system changes are forwarded and listener cleanup detaches", () => {
  const listeners = new Set();
  const query = {
    matches: false,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  const updates = [];
  const cleanup = subscribeToSystemTheme("system", query, (theme) => updates.push(theme));
  query.matches = true;
  for (const listener of listeners) listener();
  cleanup();
  query.matches = false;
  for (const listener of listeners) listener();
  assert.deepEqual(updates, ["dark"]);
  assert.equal(listeners.size, 0);
});

test("fixed preferences do not subscribe to system changes", () => {
  let attached = false;
  const query = {
    matches: true,
    addEventListener: () => (attached = true),
    removeEventListener: () => (attached = false),
  };
  const cleanup = subscribeToSystemTheme("light", query, () => assert.fail("unexpected update"));
  cleanup();
  assert.equal(attached, false);
});

test("applying a resolved theme updates the single document theme contract", () => {
  const root = { dataset: {}, style: {} };
  applyTheme("dark", root);
  assert.equal(root.dataset.theme, "dark");
  assert.equal(root.style.colorScheme, "dark");
});
