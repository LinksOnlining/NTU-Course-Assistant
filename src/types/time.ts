/** Same-day local clock times. Runtime functions validate strict HH:mm values. */
export interface TimeRange {
  readonly startTime: string;
  readonly endTime: string;
}

export interface PeriodTime extends TimeRange {
  readonly period: number;
}
