import assert from "node:assert/strict";
import { test } from "node:test";
import {
  plainAssistantText,
  resolveTodayAssistantWorkflow,
} from "../../src/workspace/ai/today-assistant-routing.ts";

test("只有明确的安排时间块请求开放 today.plan；普通与含糊问题默认只读分析", () => {
  assert.equal(
    resolveTodayAssistantWorkflow(
      "为 AI验收测试任务安排一个 30 分钟时间块。如果没有合适时间就直接告诉我，不要虚构安排。",
    ),
    "today.plan",
  );
  assert.equal(resolveTodayAssistantWorkflow("今天安排如何？请看看风险"), "today.analyze");
  assert.equal(resolveTodayAssistantWorkflow("随便聊聊今天"), "today.analyze");
  assert.equal(resolveTodayAssistantWorkflow("不要安排时间块"), "today.analyze");
  assert.equal(resolveTodayAssistantWorkflow("帮我安排今天"), "today.plan");
});

test("Provider Markdown 标记转换为普通文本，不改变其余中文内容", () => {
  assert.equal(
    plainAssistantText("## 午后有空\n**可以安排复习。**\n- 记得预留休息"),
    "午后有空\n可以安排复习。\n记得预留休息",
  );
  assert.equal(plainAssistantText("##\n**"), "");
});
