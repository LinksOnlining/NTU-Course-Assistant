import type { InboxParseKind, InboxProposal } from "../../types/inbox.ts";

export const INBOX_PARSER_VERSION = "inbox-parser-v1";

interface ParsedDate {
  readonly value: string;
  readonly raw: string;
}

interface ParsedTime {
  readonly start: string;
  readonly end: string | null;
  readonly raw: string;
}

export interface InboxSemanticHints {
  readonly date: string | null;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly deadlineDate: string | null;
  readonly deadlineTime: string | null;
  readonly location: string | null;
  readonly datePhrase: string | null;
  readonly timePhrase: string | null;
  readonly locationPhrase: string | null;
  readonly uncertainties: readonly string[];
}

function dateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return dateKey(value);
}

function parseDateText(raw: string, capturedDate: string): string | null {
  if (raw === "今天") return capturedDate;
  if (raw === "明天") return shiftDate(capturedDate, 1);
  if (raw === "后天") return shiftDate(capturedDate, 2);

  const full = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(raw);
  const monthDay = /^(\d{1,2})月(\d{1,2})日?$/u.exec(raw);
  const year = full ? Number(full[1]) : Number(capturedDate.slice(0, 4));
  const month = full ? Number(full[2]) : Number(monthDay?.[1]);
  const day = full ? Number(full[3]) : Number(monthDay?.[2]);
  if (!month || !day) return null;
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return dateKey(date);
}

function findDate(text: string, capturedDate: string): ParsedDate | null {
  const match = /今天|明天|后天|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}日?/u.exec(text);
  if (!match) return null;
  const value = parseDateText(match[0], capturedDate);
  return value ? { raw: match[0], value } : null;
}

function validTime(hour: number, minute: number): string | null {
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function findTime(text: string): ParsedTime | null {
  const range = /(\d{1,2}):(\d{2})\s*(?:-|–|—|~|至)\s*(\d{1,2}):(\d{2})/u.exec(text);
  if (range) {
    const start = validTime(Number(range[1]), Number(range[2]));
    const end = validTime(Number(range[3]), Number(range[4]));
    if (start && end) return { start, end: start < end ? end : null, raw: range[0] };
  }
  const single = /(\d{1,2}):(\d{2})/u.exec(text);
  if (!single) return null;
  const start = validTime(Number(single[1]), Number(single[2]));
  return start ? { start, end: null, raw: single[0] } : null;
}

const WEEKDAY_OFFSETS: Readonly<Record<string, number>> = Object.freeze({
  一: 0,
  二: 1,
  三: 2,
  四: 3,
  五: 4,
  六: 5,
  日: 6,
  天: 6,
});

function chineseInteger(value: string): number | null {
  if (/^\d+$/u.test(value)) return Number(value);
  const digits: Readonly<Record<string, number>> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (value === "十") return 10;
  const ten = value.indexOf("十");
  if (ten >= 0) {
    const tens = ten === 0 ? 1 : (digits[value[ten - 1]] ?? -1);
    const ones = ten === value.length - 1 ? 0 : (digits[value[ten + 1]] ?? -1);
    return tens < 0 || ones < 0 ? null : tens * 10 + ones;
  }
  return value.length === 1 ? (digits[value] ?? null) : null;
}

function addDaysUtc(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function parseNaturalDate(
  text: string,
  capturedDate: string,
): { readonly value: string; readonly raw: string; readonly index: number } | null {
  const weekday =
    /本周[一二三四五六日天]|这周[一二三四五六日天]|下周[一二三四五六日天]|星期[一二三四五六日天]|周[一二三四五六日天]|今天|明天|后天|(?:\d{1,2}|[一二两三四五六七八九十〇零]+)月(?:\d{1,2}|[一二两三四五六七八九十〇零]+)日?/u.exec(
      text,
    );
  if (!weekday) return null;
  const raw = weekday[0];
  const index = weekday.index;
  const dayPhrase = /^(本周|这周|下周|星期|周)([一二三四五六日天])$/u.exec(raw);
  if (dayPhrase) {
    const captured = new Date(`${capturedDate}T12:00:00Z`).getUTCDay();
    const currentMondayOffset = (captured + 6) % 7;
    const targetMondayOffset = WEEKDAY_OFFSETS[dayPhrase[2]];
    let days = targetMondayOffset - currentMondayOffset;
    if (dayPhrase[1] === "下周") days += 7;
    else if (dayPhrase[1] === "周" || dayPhrase[1] === "星期") {
      if (days < 0) days += 7;
    }
    return { value: addDaysUtc(capturedDate, days), raw, index };
  }
  if (raw === "今天") return { value: capturedDate, raw, index };
  if (raw === "明天") return { value: addDaysUtc(capturedDate, 1), raw, index };
  if (raw === "后天") return { value: addDaysUtc(capturedDate, 2), raw, index };

  const monthDay = /^(.+?)月(.+?)(?:日|号)?$/u.exec(raw);
  if (!monthDay) return null;
  const month = chineseInteger(monthDay[1]);
  const day = chineseInteger(monthDay[2]);
  if (!month || !day) return null;
  const year = Number(capturedDate.slice(0, 4));
  const value = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  )
    return null;
  return { value: value.toISOString().slice(0, 10), raw, index };
}

function parseNaturalTime(text: string): {
  readonly value: string | null;
  readonly raw: string | null;
  readonly dayPart: string | null;
} {
  const expression =
    /(明晚|今晚|凌晨|早上|上午|中午|下午|傍晚|晚上)?\s*(?:(\d{1,2}|[一二两三四五六七八九十〇零]+)\s*(?:点|时)(半|\d{1,2}分?)?)/u;
  const match = expression.exec(text);
  const dayPartMatch = /明晚|今晚|凌晨|早上|上午|中午|下午|傍晚|晚上/u.exec(text);
  const dayPart = match?.[1] ?? dayPartMatch?.[0] ?? null;
  if (!match) return { value: null, raw: null, dayPart };
  let hour = chineseInteger(match[2]);
  if (hour === null || hour > 23 || hour < 0) return { value: null, raw: match[0].trim(), dayPart };
  const minuteText = match[3];
  const minute = minuteText === "半" ? 30 : minuteText ? Number.parseInt(minuteText, 10) : 0;
  if (minute > 59) return { value: null, raw: match[0].trim(), dayPart };
  if (["下午", "傍晚", "晚上", "今晚", "明晚"].includes(dayPart ?? "") && hour < 12) hour += 12;
  if (["凌晨", "早上", "上午"].includes(dayPart ?? "") && hour === 12) hour = 0;
  if (dayPart === "中午" && hour < 11) hour += 12;
  return {
    value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    raw: match[0].trim(),
    dayPart,
  };
}

function parseDurationMinutes(text: string): number | null {
  if (/半小时/u.test(text)) return 30;
  const match = /(?:预计|大约|约|持续)?\s*([一二两三四五六七八九十\d]+)\s*小时/u.exec(text);
  if (match) {
    const hours = chineseInteger(match[1]);
    if (hours !== null && hours > 0 && hours <= 24) return hours * 60;
  }
  const minutes = /(?:预计|大约|约|持续)?\s*([一二两三四五六七八九十\d]+)\s*分钟/u.exec(text);
  if (minutes) {
    const value = chineseInteger(minutes[1]);
    if (value !== null && value > 0 && value <= 24 * 60) return value;
  }
  return null;
}

/** Extract only locally checkable date/time/location facts from untrusted Inbox text. */
export function parseInboxSemanticHints(rawText: string, capturedDate: string): InboxSemanticHints {
  const date = parseNaturalDate(rawText, capturedDate);
  const time = parseNaturalTime(rawText);
  const duration = parseDurationMinutes(rawText);
  const locationMatch =
    /在\s*([^，,。；;\s]{1,24}?)(?=讨论|开会|会议|举办|举行|进行|见面|集合|上课|吃饭|交流|学习|预计|约\d|，|,|。|；|;|$)/u.exec(
      rawText,
    );
  const afterDate = date
    ? rawText.slice(date.index + date.raw.length, date.index + date.raw.length + 24)
    : "";
  const deadlineMarker =
    /(?:前|之前|截止|截止日期|截止时间)/u.test(afterDate) ||
    /(?:截止|DDL)\s*[:：]?/iu.test(rawText);
  const timeRange = findTime(rawText);
  const startTime = time.value ?? timeRange?.start ?? null;
  const inferredEnd = startTime && duration ? addMinutes(startTime, duration) : null;
  const endTime = timeRange?.end ?? inferredEnd;
  const isDeadline = Boolean(date && deadlineMarker);
  const uncertainties = /这两天|近两天|最近/u.test(rawText)
    ? ["“这两天”没有足够精确的截止时间。"]
    : time.dayPart && !time.value
      ? [`“${time.dayPart}”未明确具体时刻。`]
      : [];
  return Object.freeze({
    date: date && !isDeadline ? date.value : null,
    startTime: isDeadline ? null : startTime,
    endTime: isDeadline ? null : endTime,
    deadlineDate: isDeadline ? (date?.value ?? null) : null,
    deadlineTime: isDeadline ? startTime : null,
    location: locationMatch?.[1]?.trim() || null,
    datePhrase: date?.raw ?? null,
    timePhrase: time.raw ?? time.dayPart,
    locationPhrase: locationMatch ? `在${locationMatch[1]}` : null,
    uncertainties: Object.freeze(uncertainties),
  });
}

function addMinutes(time: string, minutes: number): string | null {
  const [hour, minute] = time.split(":").map(Number);
  const total = hour * 60 + minute + minutes;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function stripEdges(value: string): string {
  return value.replace(/^[\s,，、:：;；.。\-–—]+|[\s,，、:：;；.。\-–—]+$/gu, "").trim();
}

function intentAndBody(rawText: string): { kind: InboxParseKind; body: string } {
  const task = /^\s*(?:任务|待办)\s*[:：]\s*/u.exec(rawText);
  if (task) return { kind: "task", body: rawText.slice(task[0].length) };
  const event = /^\s*(?:日程|安排)\s*[:：]\s*/u.exec(rawText);
  if (event) return { kind: "event", body: rawText.slice(event[0].length) };
  return { kind: "unknown", body: rawText.trim() };
}

export function parseInboxText(rawText: string, capturedDate: string): InboxProposal {
  const { kind, body } = intentAndBody(rawText);
  let remaining = body;
  let date: string | null = null;
  let startTime: string | null = null;
  let endTime: string | null = null;
  let deadlineDate: string | null = null;
  let deadlineTime: string | null = null;

  const deadline =
    /(?:截止|DDL)\s*[:：]?\s*(今天|明天|后天|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}日?)?\s*(\d{1,2}:\d{2})?/iu.exec(
      remaining,
    );
  if (deadline) {
    if (deadline[1]) deadlineDate = parseDateText(deadline[1], capturedDate);
    if (deadline[2]) {
      const time = findTime(deadline[2]);
      deadlineTime = time?.start ?? null;
    }
    remaining = remaining.replace(deadline[0], " ");
  }

  const parsedDate = findDate(remaining, capturedDate);
  if (parsedDate) {
    date = parsedDate.value;
    remaining = remaining.replace(parsedDate.raw, " ");
  }

  const parsedTime = findTime(remaining);
  if (parsedTime) {
    startTime = parsedTime.start;
    endTime = parsedTime.end;
    remaining = remaining.replace(parsedTime.raw, " ");
  }

  // A deadline marker is the only signal that turns a task date/time into a deadline.
  // The generic date/time fields remain available for explicit user review.
  const title = stripEdges(remaining);
  return { kind, title, date, startTime, endTime, deadlineDate, deadlineTime };
}
