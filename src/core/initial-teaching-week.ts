import { getTeachingWeek } from "./reminder.ts";
import type { TermConfig } from "../types/reminder.ts";

/** Fixture weeks are only used in browser-only development previews. */
export function initialTeachingWeek(
  shanghaiDate: string,
  termConfig: TermConfig | null,
  fixtureWeek = 1,
): number {
  if (!termConfig) return fixtureWeek;
  return getTeachingWeek(shanghaiDate, termConfig) ?? 1;
}
