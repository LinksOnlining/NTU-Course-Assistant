import { useEffect, useRef, useState } from "react";

interface ChineseDateInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly ariaLabel: string;
  readonly disabled?: boolean;
}

interface ChineseDateTimeInputProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly ariaLabel: string;
  readonly disabled?: boolean;
}

interface DateParts {
  year: string;
  month: string;
  day: string;
}

function splitDate(value: string): DateParts {
  const [year = "", month = "", day = ""] = value.slice(0, 10).split("-");
  return { year, month, day };
}

function isValidDate(year: string, month: string, day: string): boolean {
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return false;
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  if (numericMonth < 1 || numericMonth > 12 || numericDay < 1 || numericDay > 31) return false;
  return new Date(Date.UTC(numericYear, numericMonth, 0)).getUTCDate() >= numericDay;
}

function normalizePart(value: string, maxLength: number): string {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

/**
 * A small, locale-independent date control. Native date inputs inherit the
 * Windows WebView locale and can expose an English yyyy/mm/dd placeholder;
 * these fields keep the visible language stable while the emitted value stays
 * ISO `YYYY-MM-DD` for storage.
 */
export function ChineseDateInput({
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: ChineseDateInputProps) {
  const [parts, setParts] = useState<DateParts>(() => splitDate(value));
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const next = splitDate(value);
    setParts((current) =>
      current.year === next.year && current.month === next.month && current.day === next.day
        ? current
        : next,
    );
  }, [value]);

  function updatePart(key: keyof DateParts, rawValue: string) {
    const next = { ...parts, [key]: normalizePart(rawValue, key === "year" ? 4 : 2) };
    setParts(next);
    if (isValidDate(next.year, next.month, next.day)) {
      onChange(`${next.year}-${next.month}-${next.day}`);
    }
  }

  function openPicker() {
    const picker = pickerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!picker) return;
    try {
      picker.showPicker?.();
    } catch {
      picker.click();
    }
  }

  return (
    <div className="localized-date-input">
      <input
        className="localized-date-part localized-date-year"
        value={parts.year}
        onChange={(event) => updatePart("year", event.target.value)}
        placeholder="年"
        inputMode="numeric"
        maxLength={4}
        aria-label={`${ariaLabel}年`}
        disabled={disabled}
      />
      <span aria-hidden="true">年</span>
      <input
        className="localized-date-part"
        value={parts.month}
        onChange={(event) => updatePart("month", event.target.value)}
        placeholder="月"
        inputMode="numeric"
        maxLength={2}
        aria-label={`${ariaLabel}月`}
        disabled={disabled}
      />
      <span aria-hidden="true">月</span>
      <input
        className="localized-date-part"
        value={parts.day}
        onChange={(event) => updatePart("day", event.target.value)}
        placeholder="日"
        inputMode="numeric"
        maxLength={2}
        aria-label={`${ariaLabel}日`}
        disabled={disabled}
      />
      <span aria-hidden="true">日</span>
      <button
        type="button"
        className="localized-date-picker-button"
        onClick={openPicker}
        disabled={disabled}
        aria-label={`打开${ariaLabel}日历`}
      >
        📅
      </button>
      <input
        ref={pickerRef}
        className="localized-date-picker"
        type="date"
        value={
          isValidDate(parts.year, parts.month, parts.day)
            ? `${parts.year}-${parts.month}-${parts.day}`
            : ""
        }
        onChange={(event) => {
          const next = splitDate(event.target.value);
          setParts(next);
          if (event.target.value) onChange(event.target.value);
        }}
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
      />
    </div>
  );
}

export function ChineseDateTimeInput({
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: ChineseDateTimeInputProps) {
  const [date, setDate] = useState(value.slice(0, 10));
  const [time, setTime] = useState(value.slice(11, 16));

  useEffect(() => {
    if (!value) {
      setDate("");
      setTime("");
      return;
    }
    setDate(value.slice(0, 10));
    setTime(value.slice(11, 16));
  }, [value]);

  function commit(nextDate: string, nextTime: string) {
    setDate(nextDate);
    setTime(nextTime);
    if (nextDate && nextTime) onChange(`${nextDate}T${nextTime}`);
  }

  return (
    <div className="localized-datetime-input">
      <ChineseDateInput
        value={date}
        onChange={(nextDate) => commit(nextDate, time)}
        ariaLabel={ariaLabel}
        disabled={disabled}
      />
      <input
        type="time"
        value={time}
        onChange={(event) => commit(date, event.target.value)}
        aria-label={`${ariaLabel}时间`}
        disabled={disabled}
      />
    </div>
  );
}
