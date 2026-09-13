use tauri::{AppHandle, Wry};
use tauri_plugin_notification::NotificationExt;

use crate::scheduler::{DueHandler, ReminderPlan};

pub struct WindowsNotificationAdapter {
    app: AppHandle<Wry>,
}

impl WindowsNotificationAdapter {
    pub fn new(app: AppHandle<Wry>) -> Self {
        Self { app }
    }
}

impl DueHandler for WindowsNotificationAdapter {
    fn handle_due(&self, plan: &ReminderPlan) -> Result<(), String> {
        self.app
            .notification()
            .builder()
            .title("课程即将开始")
            .body(notification_body(plan))
            .show()
            .map_err(|error| error.to_string())
    }
}

fn notification_body(plan: &ReminderPlan) -> String {
    let line = format!(
        "{} · {}",
        plan.notification.course_name, plan.notification.start_time
    );
    match &plan.notification.classroom {
        Some(classroom) => format!("{line}\n{classroom}"),
        None => line,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scheduler::ReminderNotificationPayload;

    fn plan(classroom: Option<&str>) -> ReminderPlan {
        ReminderPlan {
            occurrence_key: "course:2026-09-12:14:00".into(),
            trigger_at_milliseconds: 1,
            course_start_milliseconds: 2,
            notification: ReminderNotificationPayload {
                course_name: "机械设计基础".into(),
                start_time: "14:00".into(),
                classroom: classroom.map(str::to_owned),
            },
        }
    }

    #[test]
    fn body_keeps_chinese_and_omits_missing_classroom() {
        assert_eq!(
            notification_body(&plan(Some("JX02-407"))),
            "机械设计基础 · 14:00\nJX02-407"
        );
        assert_eq!(notification_body(&plan(None)), "机械设计基础 · 14:00");
    }
}
