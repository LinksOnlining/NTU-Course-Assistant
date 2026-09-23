export interface QuoteEntry {
  readonly text: string;
  readonly author: string;
  readonly source: string;
}

export const VERIFIED_QUOTES: readonly QuoteEntry[] = [
  { text: "学而不思则罔，思而不学则殆。", author: "孔子", source: "《论语·为政》" },
  { text: "知之为知之，不知为不知，是知也。", author: "孔子", source: "《论语·为政》" },
  { text: "知者不惑，仁者不忧，勇者不惧。", author: "孔子", source: "《论语·子罕》" },
  { text: "路漫漫其修远兮，吾将上下而求索。", author: "屈原", source: "《离骚》" },
  { text: "纸上得来终觉浅，绝知此事要躬行。", author: "陆游", source: "《冬夜读书示子聿》" },
  { text: "山重水复疑无路，柳暗花明又一村。", author: "陆游", source: "《游山西村》" },
];

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function quoteForLocalDate(date: Date): QuoteEntry {
  const key = localDateKey(date);
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return VERIFIED_QUOTES[hash % VERIFIED_QUOTES.length];
}

export function formatHeaderDate(date: Date): string {
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`;
}

export function millisecondsUntilNextLocalMidnight(date: Date): number {
  const nextDay = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return Math.max(1, nextDay.getTime() - date.getTime());
}
