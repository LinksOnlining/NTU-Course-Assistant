import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WORKPLACE_TITLE,
  MAX_WORKPLACE_TITLE_LENGTH,
  WORKPLACE_TITLE_STORAGE_KEY,
  getWorkplaceTitle,
  normalizeWorkplaceTitle,
  saveWorkplaceTitle,
} from "../../src/shell/brand-title.ts";

test("title defaults, normalizes whitespace and limits characters", () => {
  assert.equal(normalizeWorkplaceTitle(null), DEFAULT_WORKPLACE_TITLE);
  assert.equal(normalizeWorkplaceTitle("   "), DEFAULT_WORKPLACE_TITLE);
  assert.equal(normalizeWorkplaceTitle("  我的   小天地  "), "我的 小天地");
  assert.equal(normalizeWorkplaceTitle("a".repeat(100)).length, MAX_WORKPLACE_TITLE_LENGTH);
});
test("saved custom title persists across preference reads", () => {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  assert.equal(getWorkplaceTitle(storage), DEFAULT_WORKPLACE_TITLE);
  assert.equal(saveWorkplaceTitle("我的学习工作台", storage), "我的学习工作台");
  assert.equal(data.get(WORKPLACE_TITLE_STORAGE_KEY), "我的学习工作台");
  assert.equal(getWorkplaceTitle(storage), "我的学习工作台");
});
test("disabled local storage does not prevent rendering", () => {
  const storage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(getWorkplaceTitle(storage), DEFAULT_WORKPLACE_TITLE);
  assert.equal(saveWorkplaceTitle("喜欢的名字", storage), "喜欢的名字");
});
