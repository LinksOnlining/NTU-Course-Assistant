import { validatePeriodTimes } from "../core/period-time.ts";
import { durationMinutes, minutesToTime, timeToMinutes } from "../core/time.ts";
import type { PeriodTime, TimeRange } from "../types/time.ts";

interface TimeAxisProps {
  readonly axis: TimeRange;
  readonly height: number;
  readonly pxPerMinute: number;
  readonly periods: readonly PeriodTime[];
}

export function TimeAxis({ axis, height, pxPerMinute, periods }: TimeAxisProps) {
  validatePeriodTimes(periods);
  const start = timeToMinutes(axis.startTime);
  const end = timeToMinutes(axis.endTime);
  const firstHour = Math.ceil(start / 60) * 60;
  const ticks = Array.from(
    { length: Math.floor((end - firstHour) / 60) + 1 },
    (_, index) => firstHour + index * 60,
  );

  return (
    <aside className="time-axis" data-testid="time-axis" aria-label="时间轴" style={{ height }}>
      {ticks.map((minutes) => {
        const label = minutesToTime(minutes);
        return (
          <time
            className="hour-tick"
            key={minutes}
            dateTime={label}
            style={{ top: (minutes - start) * pxPerMinute }}
          >
            {label}
          </time>
        );
      })}
      {periods.map((period) => {
        const top = (timeToMinutes(period.startTime) - start) * pxPerMinute;
        const periodHeight = durationMinutes(period) * pxPerMinute;
        if (top < 0 || top + periodHeight > height) return null;
        const density = periodHeight < 42 ? "compact" : "regular";
        return (
          <div
            className={`period-marker period-marker--${density}`}
            data-period={period.period}
            data-period-duration={periodHeight}
            data-testid="period-marker"
            key={period.period}
            style={{ top, height: periodHeight }}
            aria-label={`第${period.period}节，${period.startTime}至${period.endTime}`}
          >
            <strong>第{period.period}节</strong>
            <span className="period-start">{period.startTime}</span>
            <span className="period-end">{period.endTime}</span>
          </div>
        );
      })}
    </aside>
  );
}
