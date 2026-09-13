import { invoke } from "@tauri-apps/api/core";

export async function sendTestCourseNotification(): Promise<void> {
  try {
    await invoke("send_test_course_notification");
  } catch {
    throw new Error("无法发送测试提醒，请检查 Windows 通知设置后重试。");
  }
}
