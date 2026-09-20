import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import type { Course } from "../types/course.ts";
import type { PeriodTime } from "../types/time.ts";
import type { ReminderSettings, TermConfig } from "../types/reminder.ts";
import type { WidgetSettings } from "../types/widget-settings.ts";

export interface BackupData {
  courses: Course[];
  periods: PeriodTime[];
  termConfig: TermConfig | null;
  reminderSettings: ReminderSettings;
  widgetSettings: WidgetSettings;
  dayCount: 5 | 7;
}

interface BackupFile {
  formatVersion: 1;
  appVersion: string;
  exportedAt: string;
  data: BackupData;
}

export interface BackupPreview {
  readonly data: BackupData;
  readonly courses: number;
  readonly periods: number;
  readonly hasTermConfig: boolean;
  readonly remindersEnabled: boolean;
  readonly dayCount: 5 | 7;
}

function asBackupData(value: unknown): BackupData {
  if (!value || typeof value !== "object") throw new Error("备份文件格式不受支持。");
  const data = value as Partial<BackupData>;
  if (
    !Array.isArray(data.courses) ||
    !Array.isArray(data.periods) ||
    !data.reminderSettings ||
    !data.widgetSettings ||
    (data.dayCount !== 5 && data.dayCount !== 7)
  ) {
    throw new Error("备份文件缺少必要的数据。请确认文件来自 NTU Course Assistant。");
  }
  return data as BackupData;
}

function preview(data: BackupData): BackupPreview {
  return {
    data,
    courses: data.courses.length,
    periods: data.periods.length,
    hasTermConfig: data.termConfig !== null,
    remindersEnabled: data.reminderSettings.enabled,
    dayCount: data.dayCount,
  };
}

export async function exportBackup(): Promise<BackupPreview | null> {
  const path = await save({
    title: "导出课程数据备份",
    defaultPath: `NTU-Course-Assistant-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return null;
  const data = await invoke<BackupData>("export_backup");
  const file: BackupFile = {
    formatVersion: 1,
    appVersion: "1.2.0",
    exportedAt: new Date().toISOString(),
    data,
  };
  await writeTextFile(path, JSON.stringify(file, null, 2));
  return preview(data);
}

export async function selectBackup(): Promise<BackupPreview | null> {
  const path = await open({
    title: "导入课程数据备份",
    multiple: false,
    directory: false,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return null;
  const parsed: unknown = JSON.parse(await readTextFile(path));
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { formatVersion?: unknown }).formatVersion !== 1
  ) {
    throw new Error("备份文件格式不受支持。");
  }
  return preview(asBackupData((parsed as { data?: unknown }).data));
}

export async function restoreBackup(data: BackupData): Promise<void> {
  await invoke("restore_backup", { backup: data });
}
