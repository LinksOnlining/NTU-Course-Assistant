import assert from "node:assert/strict";
import test from "node:test";
import { quoteForLocalDate } from "../../src/shell/daily-quote.ts";
import {
  DAILY_AI_QUOTE_STORAGE_KEY,
  displayQuoteForLocalDate,
  normalizeGeneratedQuote,
  resetDailyAiQuote,
  saveDailyAiQuote,
} from "../../src/shell/daily-quote-override.ts";

function memoryStorage(map = new Map()) {
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

test("AI quote is opt-in, dated, persisted and never attributed to historical poets", () => {
  const records = new Map();
  const storage = memoryStorage(records);
  const today = new Date(2026, 9, 10, 12);
  const tomorrow = new Date(2026, 9, 11, 12);
  const local = quoteForLocalDate(today);
  assert.deepEqual(displayQuoteForLocalDate(today, storage), local);
  const saved = saveDailyAiQuote(today, "窗边的风在提醒你，今天也有好天气。", storage);
  assert.equal(saved?.author, "AI 生成");
  assert.match(saved?.source ?? "", /DeepSeek/u);
  assert.deepEqual(displayQuoteForLocalDate(today, storage), saved);
  assert.ok(records.has(DAILY_AI_QUOTE_STORAGE_KEY));
  assert.deepEqual(displayQuoteForLocalDate(tomorrow, storage), quoteForLocalDate(tomorrow));
  resetDailyAiQuote(storage);
  assert.deepEqual(displayQuoteForLocalDate(today, storage), local);
});

test("malformed, long, invalid, stale and inaccessible generated quotes keep offline fallback", () => {
  const date = new Date(2026, 9, 10, 12);
  const map = new Map();
  const storage = memoryStorage(map);
  const original = quoteForLocalDate(date);
  for (const invalid of ["", "短", "分行\n另起一行", "# 标题", "长".repeat(57)]) {
    assert.equal(normalizeGeneratedQuote(invalid), null);
    assert.equal(saveDailyAiQuote(date, invalid, storage), null);
    assert.deepEqual(displayQuoteForLocalDate(date, storage), original);
  }
  map.set(DAILY_AI_QUOTE_STORAGE_KEY, "{broken");
  assert.deepEqual(displayQuoteForLocalDate(date, storage), original);
  map.set(
    DAILY_AI_QUOTE_STORAGE_KEY,
    JSON.stringify({ date: "2026-10-09", text: "过期的一句话呀。" }),
  );
  assert.deepEqual(displayQuoteForLocalDate(date, storage), original);
  const denied = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
    removeItem() {
      throw new Error("denied");
    },
  };
  assert.deepEqual(displayQuoteForLocalDate(date, denied), original);
  assert.equal(saveDailyAiQuote(date, "下雨也没关系，慢慢走。", denied), null);
  assert.doesNotThrow(() => resetDailyAiQuote(denied));
});
