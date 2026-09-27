import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AiSensitiveConsent } from "../../../src/workspace/ai/AiSensitiveConsent.tsx";
import "../../../src/theme/theme.css";
import "../../../src/styles.css";

function Harness() {
  const [open, setOpen] = useState(false);
  const [isDiary, setIsDiary] = useState(true);
  const [requestCount, setRequestCount] = useState(0);
  const [status, setStatus] = useState("尚未请求");

  return (
    <main>
      <button type="button" onClick={() => setOpen(true)}>
        AI 帮我整理
      </button>
      <button type="button" onClick={() => setIsDiary((value) => !value)}>
        切换所选对象
      </button>
      <p data-testid="request-count">{requestCount}</p>
      <p data-testid="request-status">{status}</p>
      <AiSensitiveConsent
        open={open}
        title={isDiary ? "允许 AI 整理本篇日记？" : "允许 AI 识别这条收件箱内容？"}
        selectedDate={isDiary ? "2026-09-23" : "2026-09-23 12:00"}
        contentType={isDiary ? "日记正文" : "收件箱原文"}
        onDismiss={() => setOpen(false)}
        onAllowOnce={() => {
          setOpen(false);
          setRequestCount((value) => value + 1);
          setStatus("模拟网络失败；如需重试必须重新授权");
        }}
      />
    </main>
  );
}

if (new URLSearchParams(location.search).get("theme") === "dark") {
  document.documentElement.dataset.theme = "dark";
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing UI test root");
createRoot(root).render(<Harness />);
