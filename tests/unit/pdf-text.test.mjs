import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countPdfTextItems,
  hasPdfText,
  hasUsablePdfText,
  normalizePdfText,
} from "../../src/core/pdf-text.ts";

test("PDF text cleanup removes non-semantic timetable markers and preserves meaningful text", () => {
  assert.equal(normalizePdfText("大学英语\u0000 ■ ▲ ◆ @ (一)-1"), "大学英语 @ (一)-1");
});

test("PDF text helpers preserve page item boundaries", () => {
  const pages = [
    {
      page: 1,
      width: 595,
      height: 842,
      items: [{ page: 1, text: "周一", x: 10, y: 20, width: 16, height: 10 }],
    },
    {
      page: 2,
      width: 595,
      height: 842,
      items: [{ page: 2, text: "第1节", x: 12, y: 18, width: 20, height: 10 }],
    },
  ];
  assert.equal(countPdfTextItems(pages), 2);
  assert.equal(hasPdfText(pages.flatMap((page) => page.items)), true);
  assert.equal(hasPdfText([{ page: 1, text: "  ", x: 0, y: 0, width: 0, height: 0 }]), false);
  assert.equal(
    hasUsablePdfText([{ page: 1, text: "周一", x: 0, y: 0, width: 0, height: 0 }]),
    true,
  );
  assert.equal(
    hasUsablePdfText([
      { page: 1, text: "大学课程表 周一 第1节 工程力学", x: 0, y: 0, width: 0, height: 0 },
    ]),
    true,
  );
});
