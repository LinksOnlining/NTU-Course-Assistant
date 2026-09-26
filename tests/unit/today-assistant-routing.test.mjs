import assert from "node:assert/strict";
import { test } from "node:test";
import { plainAssistantText } from "../../src/workspace/ai/today-assistant-routing.ts";

test("Provider Markdown 标记转换为普通文本，不改变其余中文内容", () => {
  assert.equal(
    plainAssistantText("## 午后有空\n**可以安排复习。**\n- 记得预留休息"),
    "午后有空\n可以安排复习。\n记得预留休息",
  );
  assert.equal(plainAssistantText("##\n**"), "");
});
