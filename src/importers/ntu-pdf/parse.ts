import { periodRangeToTimeRange } from "../../core/period-time.ts";
import { parseWeeks } from "../../core/weeks.ts";
import type { ImportCandidate, ImportIssue } from "../../types/import-candidate.ts";
import type { PdfExtraction, PdfTextItem } from "../../types/pdf.ts";
import type { PeriodTime } from "../../types/time.ts";

type Weekday = NonNullable<ImportCandidate["weekday"]>;
export type WeekdayAxis = "x" | "y";

export interface NtuPdfParseOptions {
  readonly periods: readonly PeriodTime[];
  readonly isUsingTestSchedule: boolean;
}

interface WeekdayColumn {
  readonly weekday: Weekday;
  readonly coordinate: number;
}

interface PageLayout {
  readonly columnAxis: WeekdayAxis;
  readonly columns: readonly WeekdayColumn[];
}

interface SourceCluster {
  readonly page: number;
  readonly weekday: Weekday | null;
  readonly columnAxis: WeekdayAxis;
  readonly sourceOrder: number;
  readonly items: readonly PdfTextItem[];
}

interface OrderedCandidate {
  readonly candidate: ImportCandidate;
  readonly kind: "fixed" | "practice";
  readonly sourceOrder: number;
}

const WEEKDAYS: Readonly<Record<string, Weekday>> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};

const PERIOD_PATTERN = /(?:第\s*)?(\d+)\s*(?:[-－–—~～至]\s*(\d+)\s*)?节/u;
const ROOM_PATTERN = /(?:[A-Z]{1,4}\d{1,3}-[A-Z]?\d{1,4}|\d{1,3}-[A-Z]\d{1,4})/u;
const WEEK_TOKEN_PATTERN =
  /(\d+(?:\s*[-－–—~～]\s*\d+)?(?:\s*[，,、]\s*\d+(?:\s*[-－–—~～]\s*\d+)?)*)(?:\s*周)(?:\s*[（(]\s*(单|双)\s*[）)])?/gu;
const PRACTICE_PATTERN = /(?:实习|实训|训练(?:[A-Z])?|劳动教育(?:[（(][^）)]+[）)])?)/u;
const PRACTICE_NAME_PATTERN =
  /^((?:.*?(?:实习|实训)|.*?训练(?:[A-Z])?|劳动教育(?:[（(][^）)]+[）)])?))/u;

function headerWeekday(text: string): Weekday | null {
  const normalized = text.trim().replace(/^星期/u, "").replace(/^周/u, "");
  return normalized.length === 1 ? (WEEKDAYS[normalized] ?? null) : null;
}

function coordinate(item: PdfTextItem, axis: WeekdayAxis): number {
  return axis === "x" ? item.x + item.width / 2 : item.y + item.height / 2;
}

function rowCoordinate(item: PdfTextItem, columnAxis: WeekdayAxis): number {
  return columnAxis === "x" ? item.y : item.x;
}

function uniqueHeaders(items: readonly PdfTextItem[]) {
  const byWeekday = new Map<Weekday, PdfTextItem>();
  for (const item of items) {
    const weekday = headerWeekday(item.text);
    if (weekday !== null && !byWeekday.has(weekday)) byWeekday.set(weekday, item);
  }
  return [...byWeekday.entries()].map(([weekday, item]) => ({ weekday, item }));
}

/** Detect the table column direction only when at least three weekday headers give clear evidence. */
export function detectWeekdayAxis(items: readonly PdfTextItem[]): WeekdayAxis | null {
  const headers = uniqueHeaders(items);
  if (headers.length < 3) return null;
  const xValues = headers.map(({ item }) => coordinate(item, "x"));
  const yValues = headers.map(({ item }) => coordinate(item, "y"));
  const xSpread = Math.max(...xValues) - Math.min(...xValues);
  const ySpread = Math.max(...yValues) - Math.min(...yValues);
  const medianHeaderSize = [...headers]
    .map(({ item }) => Math.max(item.width, item.height))
    .sort((left, right) => left - right)[Math.floor(headers.length / 2)];
  const tolerance = Math.max(1, medianHeaderSize * 0.75);
  if (Math.abs(xSpread - ySpread) <= tolerance) return null;
  return xSpread > ySpread ? "x" : "y";
}

function pageLayout(items: readonly PdfTextItem[]): PageLayout | null {
  const columnAxis = detectWeekdayAxis(items);
  if (columnAxis === null) return null;
  return {
    columnAxis,
    columns: uniqueHeaders(items)
      .map(({ weekday, item }) => ({ weekday, coordinate: coordinate(item, columnAxis) }))
      .sort((left, right) => left.coordinate - right.coordinate),
  };
}

function closestWeekday(item: PdfTextItem, layout: PageLayout | null): Weekday | null {
  if (layout === null || layout.columns.length < 2) return null;
  const value = coordinate(item, layout.columnAxis);
  const ordered = [...layout.columns].sort(
    (left, right) => Math.abs(value - left.coordinate) - Math.abs(value - right.coordinate),
  );
  const closest = ordered[0];
  const next = ordered[1];
  const neighborDistance = Math.abs(closest.coordinate - next.coordinate);
  return Math.abs(value - closest.coordinate) < neighborDistance / 2 ? closest.weekday : null;
}

function isNonFixedPractice(text: string): boolean {
  return PRACTICE_PATTERN.test(text);
}

function clusterColumnItems(
  page: number,
  weekday: Weekday | null,
  items: readonly PdfTextItem[],
  layout: PageLayout | null,
  pageItems: readonly PdfTextItem[],
): readonly SourceCluster[] {
  const columnAxis = layout?.columnAxis ?? "x";
  const lines = [...items].sort(
    (left, right) => rowCoordinate(left, columnAxis) - rowCoordinate(right, columnAxis),
  );
  const anchors = lines.filter(
    (item) => parsePeriod(item.text) !== null && /\d+\s*周/u.test(item.text),
  );
  if (anchors.length === 0) {
    return lines.length === 0
      ? []
      : [
          {
            page,
            weekday,
            columnAxis,
            sourceOrder: Math.min(...lines.map((item) => pageItems.indexOf(item))),
            items: lines,
          },
        ];
  }
  return anchors.map((anchor, index) => {
    const anchorRow = rowCoordinate(anchor, columnAxis);
    const before =
      index === 0
        ? Number.NEGATIVE_INFINITY
        : (rowCoordinate(anchors[index - 1], columnAxis) + anchorRow) / 2;
    const after =
      index === anchors.length - 1
        ? Number.POSITIVE_INFINITY
        : (anchorRow + rowCoordinate(anchors[index + 1], columnAxis)) / 2;
    const clusterItems = items.filter((item) => {
      const value = rowCoordinate(item, columnAxis);
      return value > before && value <= after;
    });
    return {
      page,
      weekday,
      columnAxis,
      sourceOrder: Math.min(...clusterItems.map((item) => pageItems.indexOf(item))),
      items: clusterItems,
    };
  });
}

function clustersForExtraction(extraction: PdfExtraction): readonly SourceCluster[] {
  const firstLayout = pageLayout(extraction.pages[0]?.items ?? []);
  return extraction.pages.flatMap((page) => {
    const layout = pageLayout(page.items) ?? firstLayout;
    const columnAxis = layout?.columnAxis ?? "x";
    const headers = new Set(page.items.filter((item) => headerWeekday(item.text) !== null));
    const practiceItems = new Set(
      page.items.filter((item) => isNonFixedPractice(item.text) && parsePeriod(item.text) === null),
    );
    const practices = [...practiceItems].map((item) => ({
      page: page.page,
      weekday: null,
      columnAxis,
      sourceOrder: page.items.indexOf(item),
      items: [item],
    }));
    const buckets = new Map<Weekday | null, PdfTextItem[]>();
    for (const item of page.items) {
      if (headers.has(item) || practiceItems.has(item)) continue;
      const weekday = closestWeekday(item, layout);
      const bucket = buckets.get(weekday) ?? [];
      bucket.push(item);
      buckets.set(weekday, bucket);
    }
    const fixed = [...buckets.entries()].flatMap(([weekday, columnItems]) =>
      clusterColumnItems(page.page, weekday, columnItems, layout, page.items),
    );
    return [...fixed, ...practices];
  });
}

function sourceText(items: readonly PdfTextItem[]): string {
  return items
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n");
}

function compactSourceText(items: readonly PdfTextItem[]): string {
  return items.map((item) => item.text.trim()).join("");
}

function parsePeriod(text: string): { startPeriod: number; endPeriod: number } | null {
  const match = text.match(PERIOD_PATTERN);
  if (!match) return null;
  const startPeriod = Number(match[1]);
  const endPeriod = Number(match[2] ?? match[1]);
  if (
    !Number.isInteger(startPeriod) ||
    !Number.isInteger(endPeriod) ||
    startPeriod < 1 ||
    endPeriod < startPeriod
  ) {
    return null;
  }
  return { startPeriod, endPeriod };
}

export function parsePdfWeeks(text: string): readonly number[] | null {
  const values = new Set<number>();
  let matched = false;
  const withoutDuration = text.replace(/[（(]\s*共\s*\d+\s*周\s*[）)]/gu, "");
  for (const match of withoutDuration.matchAll(WEEK_TOKEN_PATTERN)) {
    matched = true;
    const parity = match[2] === "单" ? 1 : match[2] === "双" ? 0 : null;
    try {
      for (const week of parseWeeks(
        match[1].replace(/[，、]/gu, ",").replace(/[－–—~～]/gu, "-"),
      )) {
        if (parity === null || week % 2 === parity) values.add(week);
      }
    } catch {
      return null;
    }
  }
  return matched && values.size > 0 ? [...values].sort((left, right) => left - right) : null;
}

function extractClassroom(text: string): string | null {
  if (/未排地点/u.test(text)) return null;
  return text.match(ROOM_PATTERN)?.[0] ?? null;
}

function isMetadata(text: string): boolean {
  return (
    /^\d+$/u.test(text.trim()) ||
    ROOM_PATTERN.test(text) ||
    /未排地点/u.test(text) ||
    /(?:啬园|启秀|钟秀)校区/u.test(text) ||
    /[/：:]|(?:总学时|学分|教学班|职称|主辅讲|考核方式|授课方式|课程性质)/u.test(text)
  );
}

function adjacentTitleItems(
  ordered: readonly PdfTextItem[],
  anchorIndex: number,
  direction: -1 | 1,
  columnAxis: WeekdayAxis,
): readonly PdfTextItem[] {
  const titleItems: PdfTextItem[] = [];
  let next = ordered[anchorIndex];
  for (
    let index = anchorIndex + direction;
    index >= 0 && index < ordered.length;
    index += direction
  ) {
    const current = ordered[index];
    const gap = Math.abs(rowCoordinate(next, columnAxis) - rowCoordinate(current, columnAxis));
    const tolerance = Math.max(next.height, 1) * 3.5;
    if (gap > tolerance || isMetadata(current.text)) break;
    titleItems.push(current);
    next = current;
  }
  return titleItems;
}

function extractFixedName(
  cluster: SourceCluster,
  period: { startPeriod: number; endPeriod: number },
): string | null {
  const ordered = [...cluster.items].sort(
    (left, right) =>
      rowCoordinate(left, cluster.columnAxis) - rowCoordinate(right, cluster.columnAxis),
  );
  const anchorIndex = ordered.findIndex((item) => {
    const candidate = parsePeriod(item.text);
    return (
      candidate?.startPeriod === period.startPeriod && candidate.endPeriod === period.endPeriod
    );
  });
  if (anchorIndex <= 0) return null;
  const before = adjacentTitleItems(ordered, anchorIndex, -1, cluster.columnAxis);
  const after = adjacentTitleItems(ordered, anchorIndex, 1, cluster.columnAxis);
  const titleItems = before.length >= after.length ? before : after;
  const name = [...titleItems]
    .sort((left, right) => cluster.items.indexOf(left) - cluster.items.indexOf(right))
    .map((item) => item.text.trim())
    .join("")
    .trim();
  return name === "" ? null : name;
}

function extractPracticeName(text: string): string | null {
  const prefix = text.replace(/^其他课程\s*[：:]/u, "").split(/[（(]\s*共\s*\d+\s*周/u)[0];
  const match = prefix.match(PRACTICE_NAME_PATTERN);
  return match?.[1]?.trim() || null;
}

function extractTeacher(items: readonly PdfTextItem[]): string | null {
  const match = compactSourceText(items).match(/教师[:：]([^/]+?)\/职称/u);
  const teacher = match?.[1]?.replace(/\s+/gu, "").trim() ?? "";
  return teacher === "" ? null : teacher;
}

function sourceSegments(cluster: SourceCluster): readonly string[] {
  const text = sourceText(cluster.items);
  if (!isNonFixedPractice(text) || parsePeriod(text) !== null) return [text];
  return text
    .replace(/^其他课程\s*[：:]/u, "")
    .split(/[；;]/u)
    .map((segment) => segment.trim())
    .filter(isNonFixedPractice);
}

function sourceBounds(items: readonly PdfTextItem[]) {
  const minX = Math.min(...items.map((item) => item.x));
  const maxX = Math.max(...items.map((item) => item.x + item.width));
  const minY = Math.min(...items.map((item) => item.y));
  const maxY = Math.max(...items.map((item) => item.y + item.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function appendIssue(issues: ImportIssue[], issue: ImportIssue): void {
  if (issues.some((current) => current.code === issue.code && current.field === issue.field))
    return;
  issues.push(issue);
}

function buildIssues(
  name: string | null,
  teacher: string | null,
  weekday: Weekday | null,
  period: { startPeriod: number; endPeriod: number } | null,
  weeks: readonly number[] | null,
  classroom: string | null,
  source: string,
  options: NtuPdfParseOptions,
  isPractice: boolean,
): readonly ImportIssue[] {
  const issues: ImportIssue[] = [];
  if (name === null)
    appendIssue(issues, {
      code: "missing-name",
      field: "name",
      severity: "blocking",
      message: "无法确定课程名称。",
    });
  if (weekday === null)
    appendIssue(issues, {
      code: "missing-weekday",
      field: "weekday",
      severity: "blocking",
      message: isPractice ? "该实践课程没有固定星期，需要人工补充。" : "无法根据课程列确定星期。",
    });
  if (period === null)
    appendIssue(issues, {
      code: "missing-period",
      field: "periods",
      severity: "blocking",
      message: isPractice ? "该实践课程没有固定节次，需要人工补充。" : "无法确定课程节次。",
    });
  if (weeks === null)
    appendIssue(issues, {
      code: "invalid-weeks",
      field: "weeks",
      severity: "blocking",
      message: "无法解析上课周数。",
    });
  if (classroom === null)
    appendIssue(issues, {
      code: /未排地点/u.test(source) ? "unassigned-classroom" : "missing-classroom",
      field: "classroom",
      severity: "warning",
      message: /未排地点/u.test(source) ? "PDF 标记为未排地点。" : "未识别到教室。",
    });
  if (teacher === null)
    appendIssue(issues, {
      code: "missing-teacher",
      field: "teacher",
      severity: "warning",
      message: "未可靠识别教师信息。",
    });
  if (period !== null) {
    const resolved = periodRangeToTimeRange(period, options.periods);
    if (resolved === null)
      appendIssue(issues, {
        code: "period-not-mapped",
        field: "time",
        severity: "blocking",
        message: "当前作息无法映射该节次。",
      });
    else if (options.isUsingTestSchedule)
      appendIssue(issues, {
        code: "test-schedule",
        field: "time",
        severity: "blocking",
        message: "当前使用测试作息，需要确认正式作息。",
      });
  }
  return issues;
}

function stableHash(text: string): string {
  let hash = 2166136261;
  for (const character of text) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function compareCandidates(left: OrderedCandidate, right: OrderedCandidate): number {
  if (left.kind !== right.kind) return left.kind === "fixed" ? -1 : 1;
  if (left.candidate.source.page !== right.candidate.source.page)
    return left.candidate.source.page - right.candidate.source.page;
  if (left.kind === "practice") return left.sourceOrder - right.sourceOrder;
  return (
    (left.candidate.weekday ?? 99) - (right.candidate.weekday ?? 99) ||
    (left.candidate.startPeriod ?? 99) - (right.candidate.startPeriod ?? 99) ||
    left.sourceOrder - right.sourceOrder
  );
}

/** Parse NTU timetable layout into review-only candidates; it never creates Course records. */
export function parseNtuPdfTimetable(
  extraction: PdfExtraction,
  options: NtuPdfParseOptions,
): readonly ImportCandidate[] {
  return clustersForExtraction(extraction)
    .flatMap((cluster) =>
      sourceSegments(cluster).map((text, segmentIndex) => ({ cluster, text, segmentIndex })),
    )
    .map(({ cluster, text, segmentIndex }): OrderedCandidate | null => {
      const period = parsePeriod(text);
      const isPractice = isNonFixedPractice(text) && period === null;
      if (period === null && !isPractice) return null;
      const weeks = parsePdfWeeks(text);
      const classroom = extractClassroom(text);
      const weekday = isPractice ? null : cluster.weekday;
      const name = period === null ? extractPracticeName(text) : extractFixedName(cluster, period);
      const teacher = period === null ? null : extractTeacher(cluster.items);
      const resolvedTime =
        period !== null && !options.isUsingTestSchedule
          ? periodRangeToTimeRange(period, options.periods)
          : null;
      const bounds = sourceBounds(cluster.items);
      const id = `ntu-pdf-${cluster.page}-${isPractice ? "practice" : "fixed"}-${cluster.sourceOrder}-${segmentIndex}-${stableHash(text)}`;
      return {
        kind: isPractice ? "practice" : "fixed",
        sourceOrder: cluster.sourceOrder + segmentIndex,
        candidate: {
          id,
          kind: isPractice ? "practice" : "fixed",
          name,
          teacher,
          classroom,
          weekday,
          startPeriod: period?.startPeriod ?? null,
          endPeriod: period?.endPeriod ?? null,
          weeks,
          resolvedTime,
          source: { page: cluster.page, text, bounds, items: cluster.items },
          issues: buildIssues(
            name,
            teacher,
            weekday,
            period,
            weeks,
            classroom,
            text,
            options,
            isPractice,
          ),
        },
      };
    })
    .filter((result): result is OrderedCandidate => result !== null)
    .sort(compareCandidates)
    .map(({ candidate }) => candidate);
}
