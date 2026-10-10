import { invoke, isTauri } from "@tauri-apps/api/core";

export type ObsidianAction = "vault" | "daily" | "inbox";

export async function getObsidianVault(): Promise<string> {
  if (!isTauri()) {
    throw new Error("Obsidian 快捷入口仅在 Windows 桌面应用中可用。");
  }
  return await invoke<string>("get_obsidian_vault");
}

export async function openObsidian(action: ObsidianAction): Promise<void> {
  if (!isTauri()) {
    throw new Error("Obsidian 快捷入口仅在 Windows 桌面应用中可用。");
  }
  await invoke("open_obsidian", { action });
}
