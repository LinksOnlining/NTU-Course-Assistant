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
  assert.deepEqual(VERIFIED_QUOTES, [
    { text: "学而不思则罔，思而不学则殆。", author: "孔子", source: "《论语·为政》" },
    { text: "知之为知之，不知为不知，是知也。", author: "孔子", source: "《论语·为政》" },
    { text: "知者不惑，仁者不忧，勇者不惧。", author: "孔子", source: "《论语·子罕》" },
    { text: "路漫漫其修远兮，吾将上下而求索。", author: "屈原", source: "《离骚》" },
    { text: "纸上得来终觉浅，绝知此事要躬行。", author: "陆游", source: "《冬夜读书示子聿》" },
    { text: "山重水复疑无路，柳暗花明又一村。", author: "陆游", source: "《游山西村》" },
  ]);
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
