export interface PlannerEvent {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly location: string | null;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlannerEventDraft {
  readonly title: string;
  readonly description: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly location: string;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
}

export interface TimeBlock {
  readonly id: string;
  readonly personalTaskId: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TimeBlockDraft {
  readonly personalTaskId: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
}
