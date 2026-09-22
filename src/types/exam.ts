export type ExamStatus = "SCHEDULED" | "CANCELLED";

export interface Exam {
  readonly id: string;
  readonly semesterId: string;
  readonly courseId: string | null;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly location: string | null;
  readonly seatInfo: string | null;
  readonly note: string | null;
  readonly status: ExamStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}
