export type SemesterStatus = "ACTIVE" | "ARCHIVED";

/** A named teaching period; archived semesters remain available for history. */
export interface Semester {
  readonly id: string;
  readonly name: string;
  readonly firstWeekMonday: string;
  readonly totalWeeks: number;
  readonly timezone: "Asia/Shanghai";
  readonly status: SemesterStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}
