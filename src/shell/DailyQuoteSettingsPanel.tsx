import { useState } from "react";
import { aiSettingsService } from "../workspace/ai/ai-settings-service.ts";
import { DeepSeekNativeBridge } from "../services/deepseek-native-bridge.ts";
import {
  DAILY_QUOTE_UPDATED_EVENT,
  displayQuoteForLocalDate,
  resetDailyAiQuote,
  saveDailyAiQuote,
} from "./daily-quote-override.ts";

/** No user data is sent; a network call happens only after an explicit click. */
export function DailyQuoteSettingsPanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);
  const quote = displayQuoteForLocalDate(new Date());
  const publish = () => {
    setRevision((value) => value + 1);
    window.dispatchEvent(new Event(DAILY_QUOTE_UPDATED_EVENT));
  };

  async function generate() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const bridge = new DeepSeekNativeBridge();
      if (!(await bridge.getCredentialStatus())) {
        setMessage("尚未设置 DeepSeek API Key，请先到 AI 设置中配置；本地寄语仍正常显示。");
        return;
      }
      const settings = aiSettingsService.loadSettings();
      const result = await bridge.generateText({
        id: "daily-quote-" + Date.now(),
        intent: "suggest",
        prompt:
          "请原创一句适合作为桌面工作台每日寄语的简体中文生活短句。自然、轻松、有画面感，可以俏皮但不说教；不引用、不模仿诗词，不署名，不使用 Markdown、换行或引号。只输出一句 8 到 30 个汉字的短句，不要解释。不包含任何用户数据。",
        model: settings.selectedModel,
        reasoningEffort: "none",
        requestTimeoutSeconds: Math.min(settings.requestTimeoutSeconds, 20),
      });
      const saved = saveDailyAiQuote(new Date(), result.content);
      if (!saved) {
        setMessage("返回内容不符合短句规范或本地存储不可用，已继续使用本地寄语。");
        return;
      }
      publish();
      setMessage("今日短句已更新并保存在本机；明天自动恢复按日期选择的本地寄语。");
    } catch {
      setMessage("DeepSeek 暂不可用，已保留本地寄语；可稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section" aria-label="每日寄语选项">
      <p className="settings-domain-note">
        默认每日从本地诗词与原创短句中选择；离线可用，古诗标注作者和篇名。 只有点击生成按钮才会调用
        DeepSeek，发送固定的创作要求，不发送课程或日记等个人数据。
      </p>
      <p aria-live="polite" data-testid="daily-quote-preview" data-revision={revision}>
        今日：{quote.text} · {quote.author}
      </p>
      <div className="form-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => void generate()}
        >
          {busy ? "生成中…" : "使用 DeepSeek 生成今日短句"}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            resetDailyAiQuote();
            publish();
            setMessage("已恢复按日期轮换的本地寄语。");
          }}
        >
          恢复本地寄语
        </button>
      </div>
      {message && (
        <p className="settings-domain-note" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
