export const MAX_TEACHING_WEEK = 30;

/** Parse comma-separated weeks and inclusive ranges into sorted, unique weeks. */
export function parseWeeks(value: string, maximumWeek = MAX_TEACHING_WEEK): readonly number[] {
  if (!Number.isInteger(maximumWeek) || maximumWeek < 1) {
    throw new RangeError("最大教学周必须是正整数");
  }
  const source = value.trim();
  if (source === "") throw new RangeError("上课周数不能为空");

  const weeks = new Set<number>();
  for (const rawPart of source.split(",")) {
    const part = rawPart.trim();
    if (!/^\d+(?:\s*-\s*\d+)?$/.test(part)) {
      throw new RangeError("周数格式不正确，请使用 1-4,7,10-12");
    }
    const [startText, endText = startText] = part.split("-").map((item) => item.trim());
    const start = Number(startText);
    const end = Number(endText);
    if (start < 1 || end > maximumWeek) {
      throw new RangeError(`周数必须在 1-${maximumWeek} 之间`);
    }
    if (end < start) throw new RangeError("周数范围的结束周不能早于开始周");
    for (let week = start; week <= end; week += 1) weeks.add(week);
  }
  return [...weeks].sort((first, second) => first - second);
}

/** Compact validated week numbers for an editable text field. */
export function formatWeeks(values: readonly number[], maximumWeek = MAX_TEACHING_WEEK): string {
  if (values.length === 0) throw new RangeError("上课周数不能为空");
  const weeks = [...new Set(values)].sort((first, second) => first - second);
  if (
    !Number.isInteger(maximumWeek) ||
    maximumWeek < 1 ||
    weeks.some((week) => !Number.isInteger(week) || week < 1 || week > maximumWeek)
  ) {
    throw new RangeError(`周数必须是 1-${maximumWeek} 范围内的整数`);
  }

  const ranges: string[] = [];
  for (let index = 0; index < weeks.length;) {
    const start = weeks[index];
    let end = start;
    while (index + 1 < weeks.length && weeks[index + 1] === end + 1) {
      index += 1;
      end = weeks[index];
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    index += 1;
  }
  return ranges.join(",");
}
