import { localDateKey, quoteForLocalDate, type QuoteEntry } from "./daily-quote.ts";

export const DAILY_AI_QUOTE_STORAGE_KEY = "links-workplace.daily-ai-quote";
export const DAILY_QUOTE_UPDATED_EVENT = "links-workplace:daily-quote-updated";

interface QuoteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserQuoteStorage(): QuoteStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Treat generated text as untrusted; avoid multiline, markup and implausible length. */
export function normalizeGeneratedQuote(raw: string): string | null {
  const text = raw
    .trim()
    .replace(/^["“'「]+|["”'」]+$/gu, "")
    .trim();
  if (
    !text ||
    /[\r\n]/u.test(text) ||
    /[#*{}[\]<>]/u.test(text) ||
    Array.from(text).length > 56 ||
    Array.from(text).length < 4
  )
    return null;
  return text;
}

function readOverrideQuote(date: Date, storage: QuoteStorage | null): QuoteEntry | null {
  try {
    const raw = storage?.getItem(DAILY_AI_QUOTE_STORAGE_KEY);
    if (!raw) return null;
    const saved: unknown = JSON.parse(raw);
    if (
      typeof saved !== "object" ||
      saved === null ||
      !("date" in saved) ||
      saved.date !== localDateKey(date) ||
      !("text" in saved) ||
      typeof saved.text !== "string"
    )
      return null;
    const text = normalizeGeneratedQuote(saved.text);
    return text ? { text, author: "AI 生成", source: "DeepSeek · 用户按需生成" } : null;
  } catch {
    return null;
  }
}

export function saveDailyAiQuote(
  date: Date,
  generatedText: string,
  storage: QuoteStorage | null = browserQuoteStorage(),
): QuoteEntry | null {
  const text = normalizeGeneratedQuote(generatedText);
  if (!text || !storage) return null;
  try {
    storage.setItem(DAILY_AI_QUOTE_STORAGE_KEY, JSON.stringify({ date: localDateKey(date), text }));
    return { text, author: "AI 生成", source: "DeepSeek · 用户按需生成" };
  } catch {
    return null;
  }
}

export function resetDailyAiQuote(storage: QuoteStorage | null = browserQuoteStorage()): void {
  try {
    storage?.removeItem(DAILY_AI_QUOTE_STORAGE_KEY);
  } catch {
    // Offline quote rotation must survive denied local preference storage.
  }
}

export function displayQuoteForLocalDate(
  date: Date,
  storage: QuoteStorage | null = browserQuoteStorage(),
): QuoteEntry {
  return readOverrideQuote(date, storage) ?? quoteForLocalDate(date);
}
