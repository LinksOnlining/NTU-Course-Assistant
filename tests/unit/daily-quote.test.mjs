import assert from "node:assert/strict";
import test from "node:test";
import {
  formatHeaderDate,
  localDateKey,
  millisecondsUntilNextLocalMidnight,
  quoteForLocalDate,
  VERIFIED_QUOTES,
} from "../../src/shell/daily-quote.ts";

test("daily quote is stable for a local date and always comes from the verified library", () => {
  const date = new Date(2026, 8, 23, 12);
  assert.deepEqual(quoteForLocalDate(date), quoteForLocalDate(new Date(2026, 8, 23, 23, 59)));
  assert.ok(
    VERIFIED_QUOTES.some((quote) => quote.source.startsWith("《") && quote.author !== "原创短句"),
  );
  assert.ok(
    VERIFIED_QUOTES.some((quote) => quote.author === "原创短句" && quote.source === "本地寄语"),
  );
  assert.ok(VERIFIED_QUOTES.length >= 20);
  assert.ok(VERIFIED_QUOTES.includes(quoteForLocalDate(date)));
});

test("local date key and compact header date use the user's local calendar", () => {
  const date = new Date(2026, 8, 23, 12);
  assert.equal(localDateKey(date), "2026-09-23");
  const formatted = formatHeaderDate(date);
  assert.match(formatted, /9月23日/u);
  assert.match(formatted, /周/u);
});

test("next date refresh delay is positive and ends at local midnight", () => {
  const date = new Date(2026, 8, 23, 23, 59, 59, 500);
  assert.equal(millisecondsUntilNextLocalMidnight(date), 500);
  assert.ok(millisecondsUntilNextLocalMidnight(new Date(2026, 8, 23, 12)) > 0);
});
