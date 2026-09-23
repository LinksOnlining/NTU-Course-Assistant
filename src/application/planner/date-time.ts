export function isValidPlannerDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]!;
}

export function isValidPlannerTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

export function isValidPlannerEndTime(value: string): boolean {
  return value === "24:00" || isValidPlannerTime(value);
}

export function validatePlannerDateRange(startDate: string, endDate: string): string | null {
  if (!isValidPlannerDate(startDate) || !isValidPlannerDate(endDate))
    return "请输入有效的日期范围。";
  if (startDate > endDate) return "结束日期不得早于开始日期。";
  return null;
}
