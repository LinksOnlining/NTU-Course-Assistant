export type WidgetDisplayMode = "today" | "week" | "next" | "deadlines";

export interface WidgetSettings {
  readonly enabled: boolean;
  readonly displayMode: WidgetDisplayMode;
  readonly locked: boolean;
  readonly x: number | null;
  readonly y: number | null;
  readonly width: number | null;
  readonly height: number | null;
}
