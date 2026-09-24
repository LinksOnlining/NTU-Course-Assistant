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
