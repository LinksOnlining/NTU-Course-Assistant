import type { DiaryEntry } from "../../types/diary.ts";

export type DiarySaveState = "idle" | "pending" | "saving" | "saved" | "failed";

export class DiaryAutosave {
  private entry: DiaryEntry | null = null;
  private revision = 0;
  private savedRevision = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<boolean> | null = null;
  private readonly save: (entry: DiaryEntry) => Promise<DiaryEntry>;
  private readonly onState: (state: DiarySaveState) => void;
  private readonly debounceMilliseconds: number;

  constructor(
    save: (entry: DiaryEntry) => Promise<DiaryEntry>,
    onState: (state: DiarySaveState) => void,
    debounceMilliseconds = 550,
  ) {
    this.save = save;
    this.onState = onState;
    this.debounceMilliseconds = debounceMilliseconds;
  }

  hydrate(date: string, entry: DiaryEntry | null): void {
    this.clearTimer();
    this.entry = entry ?? {
      id: "",
      entryDate: date,
      body: "",
      createdAt: "",
      updatedAt: "",
    };
    this.revision = 0;
    this.savedRevision = 0;
    this.onState(entry ? "saved" : "idle");
  }

  schedule(date: string, body: string): void {
    const now = new Date().toISOString();
    this.entry = {
      id: this.entry?.entryDate === date && this.entry.id ? this.entry.id : crypto.randomUUID(),
      entryDate: date,
      body,
      createdAt:
        this.entry?.entryDate === date && this.entry.createdAt ? this.entry.createdAt : now,
      updatedAt: now,
    };
    this.revision += 1;
    this.onState("pending");
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMilliseconds);
  }

  flush(): Promise<boolean> {
    this.clearTimer();
    if (this.flushPromise) {
      return this.flushPromise.then((success) =>
        success && this.hasPending() ? this.flush() : success,
      );
    }
    if (!this.hasPending()) return Promise.resolve(true);

    const operation = this.drain();
    this.flushPromise = operation;
    void operation.finally(() => {
      if (this.flushPromise === operation) this.flushPromise = null;
    });
    return operation;
  }

  private async drain(): Promise<boolean> {
    while (this.hasPending()) {
      this.clearTimer();
      const savingRevision = this.revision;
      const snapshot = this.entry;
      if (!snapshot) return false;
      this.onState("saving");
      try {
        const saved = await this.save(snapshot);
        this.savedRevision = savingRevision;
        if (savingRevision === this.revision) {
          this.entry = saved;
          this.onState("saved");
        } else {
          this.entry = {
            ...this.entry!,
            id: saved.id,
            createdAt: saved.createdAt,
          };
        }
      } catch {
        if (savingRevision < this.revision) continue;
        this.onState("failed");
        return false;
      }
    }
    return true;
  }

  private hasPending(): boolean {
    return this.entry !== null && this.revision > this.savedRevision;
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
