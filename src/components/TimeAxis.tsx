import { minutesToTime, timeToMinutes } from "../core/time.ts";
import type { TimeRange } from "../types/time.ts";

interface TimeAxisProps {
  readonly axis: TimeRange;
  readonly height: number;
  readonly pxPerMinute: number;
}

export function TimeAxis({ axis, height, pxPerMinute }: TimeAxisProps) {
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
          <time key={minutes} dateTime={label} style={{ top: (minutes - start) * pxPerMinute }}>
            {label}
          </time>
        );
      })}
    </aside>
  );
}
