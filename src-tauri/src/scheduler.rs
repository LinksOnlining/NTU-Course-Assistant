use std::{
    collections::HashSet,
    sync::{mpsc, Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

// ponytail: one-minute wall-clock recheck bounds sleep/time-jump recovery without a busy loop.
const MAX_CLOCK_RECHECK_WAIT: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderNotificationPayload {
    pub course_name: String,
    pub start_time: String,
    pub classroom: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderPlan {
    pub occurrence_key: String,
    pub trigger_at_milliseconds: i64,
    pub course_start_milliseconds: i64,
    pub notification: ReminderNotificationPayload,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerStatus {
    pub enabled: bool,
    pub next_trigger_at_milliseconds: Option<i64>,
    pub next_occurrence_keys: Vec<String>,
    pub due_occurrence_keys: Vec<String>,
}

enum Command {
    Refresh {
        enabled: bool,
        plans: Vec<ReminderPlan>,
    },
    Stop,
}

pub trait DueHandler: Send + Sync + 'static {
    fn handle_due(&self, plan: &ReminderPlan) -> Result<(), String>;
}

pub trait HandledStore: Send + Sync + 'static {
    fn mark_handled(
        &self,
        occurrence_key: &str,
        handled_at_milliseconds: i64,
    ) -> Result<(), String>;
}

pub struct ReminderScheduler {
    sender: mpsc::Sender<Command>,
    status: Arc<Mutex<SchedulerStatus>>,
}

impl ReminderScheduler {
    pub fn new(handler: Arc<dyn DueHandler>, handled_store: Arc<dyn HandledStore>) -> Self {
        let (sender, receiver) = mpsc::channel();
        let status = Arc::new(Mutex::new(SchedulerStatus::default()));
        let worker_status = Arc::clone(&status);
        thread::spawn(move || run(receiver, worker_status, handler, handled_store));
        Self { sender, status }
    }

    pub fn refresh(&self, enabled: bool, plans: Vec<ReminderPlan>) -> Result<(), String> {
        self.sender
            .send(Command::Refresh { enabled, plans })
            .map_err(|_| "提醒调度器不可用".to_string())
    }

    pub fn status(&self) -> Result<SchedulerStatus, String> {
        self.status
            .lock()
            .map(|item| item.clone())
            .map_err(|_| "提醒调度器状态不可用".to_string())
    }
}

impl Drop for ReminderScheduler {
    fn drop(&mut self) {
        let _ = self.sender.send(Command::Stop);
    }
}

fn now_milliseconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis().try_into().unwrap_or(i64::MAX))
        .unwrap_or(0)
}

fn apply(
    status: &mut SchedulerStatus,
    enabled: bool,
    plans: Vec<ReminderPlan>,
    seen: &mut HashSet<String>,
) -> Option<Duration> {
    apply_at(status, enabled, plans, seen, now_milliseconds())
}

fn apply_at(
    status: &mut SchedulerStatus,
    enabled: bool,
    plans: Vec<ReminderPlan>,
    seen: &mut HashSet<String>,
    now: i64,
) -> Option<Duration> {
    status.enabled = enabled;
    status.due_occurrence_keys.clear();
    status.next_trigger_at_milliseconds = None;
    status.next_occurrence_keys.clear();
    if !enabled {
        return None;
    }
    let mut due: Vec<_> = plans
        .iter()
        .filter(|item| {
            item.trigger_at_milliseconds <= now
                && now < item.course_start_milliseconds
                && !seen.contains(&item.occurrence_key)
        })
        .collect();
    due.sort_by(|left, right| left.occurrence_key.cmp(&right.occurrence_key));
    if !due.is_empty() {
        for item in due {
            seen.insert(item.occurrence_key.clone());
            status.due_occurrence_keys.push(item.occurrence_key.clone());
        }
        return Some(Duration::ZERO);
    }
    let next = plans
        .iter()
        .filter(|item| item.trigger_at_milliseconds >= now && !seen.contains(&item.occurrence_key))
        .map(|item| item.trigger_at_milliseconds)
        .min()?;
    status.next_trigger_at_milliseconds = Some(next);
    status.next_occurrence_keys = plans
        .into_iter()
        .filter(|item| item.trigger_at_milliseconds == next)
        .map(|item| item.occurrence_key)
        .collect();
    Some(Duration::from_millis((next - now).try_into().unwrap_or(0)))
}

fn run(
    receiver: mpsc::Receiver<Command>,
    status: Arc<Mutex<SchedulerStatus>>,
    handler: Arc<dyn DueHandler>,
    handled_store: Arc<dyn HandledStore>,
) {
    let mut enabled = false;
    let mut plans = Vec::new();
    let mut seen = HashSet::new();
    loop {
        let wait = status
            .lock()
            .ok()
            .and_then(|mut state| apply(&mut state, enabled, plans.clone(), &mut seen));
        let due_keys = status
            .lock()
            .map(|state| state.due_occurrence_keys.clone())
            .unwrap_or_default();
        dispatch_due(&plans, &due_keys, handler.as_ref(), handled_store.as_ref());
        let command = match wait.map(|duration| duration.min(MAX_CLOCK_RECHECK_WAIT)) {
            Some(duration) => match receiver.recv_timeout(duration) {
                Ok(command) => Some(command),
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => None,
            },
            None => receiver.recv().ok(),
        };
        match command {
            Some(Command::Refresh {
                enabled: next_enabled,
                plans: next_plans,
            }) => {
                enabled = next_enabled;
                plans = next_plans;
            }
            Some(Command::Stop) | None => break,
        }
    }
}

fn dispatch_due(
    plans: &[ReminderPlan],
    due_keys: &[String],
    handler: &dyn DueHandler,
    handled_store: &dyn HandledStore,
) {
    for key in due_keys {
        if let Some(plan) = plans.iter().find(|plan| plan.occurrence_key == *key) {
            eprintln!("Reminder due: {key}");
            if let Err(error) = handler.handle_due(plan) {
                eprintln!("Course notification failed for {key}: {error}");
            }
            if let Err(error) = handled_store.mark_handled(key, now_milliseconds()) {
                eprintln!("Reminder handled state failed for {key}: {error}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[derive(Default)]
    struct RecordingHandler {
        keys: Mutex<Vec<String>>,
        fail: bool,
    }

    impl DueHandler for RecordingHandler {
        fn handle_due(&self, plan: &ReminderPlan) -> Result<(), String> {
            self.keys.lock().unwrap().push(plan.occurrence_key.clone());
            if self.fail {
                Err("test failure".into())
            } else {
                Ok(())
            }
        }
    }

    #[derive(Default)]
    struct RecordingHandledStore {
        keys: Mutex<Vec<String>>,
        fail: bool,
    }

    impl HandledStore for RecordingHandledStore {
        fn mark_handled(&self, occurrence_key: &str, _: i64) -> Result<(), String> {
            self.keys.lock().unwrap().push(occurrence_key.into());
            if self.fail {
                Err("test persistence failure".into())
            } else {
                Ok(())
            }
        }
    }

    fn plan(key: &str, trigger: i64) -> ReminderPlan {
        ReminderPlan {
            occurrence_key: key.into(),
            trigger_at_milliseconds: trigger,
            course_start_milliseconds: trigger + 60_000,
            notification: ReminderNotificationPayload {
                course_name: "课程".into(),
                start_time: "08:00".into(),
                classroom: None,
            },
        }
    }
    #[test]
    fn disabled_and_stale_plans_are_idle() {
        let mut status = SchedulerStatus::default();
        let mut seen = HashSet::new();
        assert!(apply_at(&mut status, false, vec![], &mut seen, 1_000).is_none());
        assert!(!status.enabled);
    }

    #[test]
    fn refresh_supersedes_old_plan_and_keeps_simultaneous_occurrences() {
        let mut status = SchedulerStatus::default();
        let mut seen = HashSet::new();
        assert_eq!(
            apply_at(
                &mut status,
                true,
                vec![plan("old", 4_000)],
                &mut seen,
                1_000,
            ),
            Some(Duration::from_millis(3_000))
        );
        assert_eq!(status.next_occurrence_keys, vec!["old"]);
        assert_eq!(
            apply_at(
                &mut status,
                true,
                vec![plan("intermediate", 3_500)],
                &mut seen,
                1_000,
            ),
            Some(Duration::from_millis(2_500))
        );
        assert_eq!(status.next_occurrence_keys, vec!["intermediate"]);
        assert_eq!(
            apply_at(
                &mut status,
                true,
                vec![plan("a", 3_000), plan("b", 3_000), plan("next", 4_000)],
                &mut seen,
                1_000,
            ),
            Some(Duration::from_millis(2_000))
        );
        assert_eq!(status.next_occurrence_keys, vec!["a", "b"]);
        assert_eq!(
            apply_at(
                &mut status,
                true,
                vec![plan("a", 3_000), plan("b", 3_000), plan("next", 4_000)],
                &mut seen,
                3_000,
            ),
            Some(Duration::ZERO)
        );
        assert_eq!(status.due_occurrence_keys, vec!["a", "b"]);
        assert_eq!(
            apply_at(
                &mut status,
                true,
                vec![plan("next", 4_000)],
                &mut seen,
                3_000,
            ),
            Some(Duration::from_millis(1_000))
        );
        assert_eq!(status.next_occurrence_keys, vec!["next"]);
        assert_eq!(
            apply_at(
                &mut status,
                true,
                vec![plan("next", 4_000)],
                &mut seen,
                4_000,
            ),
            Some(Duration::ZERO)
        );
        assert_eq!(status.due_occurrence_keys, vec!["next"]);
    }

    #[test]
    fn clock_recheck_supports_catch_up_but_never_notifies_an_already_started_course() {
        let mut status = SchedulerStatus::default();
        let mut seen = HashSet::new();
        let wake_plan = ReminderPlan {
            course_start_milliseconds: 2_000,
            ..plan("wake", 1_000)
        };
        assert_eq!(
            apply_at(&mut status, true, vec![wake_plan.clone()], &mut seen, 1_500),
            Some(Duration::ZERO)
        );
        assert_eq!(status.due_occurrence_keys, vec!["wake"]);

        let mut after_start = SchedulerStatus::default();
        let mut fresh_session = HashSet::new();
        assert!(apply_at(
            &mut after_start,
            true,
            vec![wake_plan],
            &mut fresh_session,
            2_000
        )
        .is_none());
        assert!(after_start.due_occurrence_keys.is_empty());
    }

    #[test]
    fn handled_occurrence_stays_suppressed_after_a_clock_recheck() {
        let mut status = SchedulerStatus::default();
        let mut seen = HashSet::from(["handled".to_string()]);
        assert!(apply_at(
            &mut status,
            true,
            vec![plan("handled", 1_000)],
            &mut seen,
            1_500
        )
        .is_none());
        assert!(status.due_occurrence_keys.is_empty());
    }

    #[test]
    fn every_due_plan_dispatches_once_and_a_failure_does_not_stop_later_plans() {
        let failed = RecordingHandler {
            fail: true,
            ..Default::default()
        };
        let store = RecordingHandledStore::default();
        dispatch_due(&[plan("a", 1)], &["a".into()], &failed, &store);
        assert_eq!(*failed.keys.lock().unwrap(), vec!["a"]);
        assert_eq!(*store.keys.lock().unwrap(), vec!["a"]);

        let handler = RecordingHandler::default();
        let failed_store = RecordingHandledStore {
            fail: true,
            ..Default::default()
        };
        dispatch_due(
            &[plan("a", 1), plan("b", 1)],
            &["a".into(), "b".into()],
            &handler,
            &failed_store,
        );
        assert_eq!(*handler.keys.lock().unwrap(), vec!["a", "b"]);
        assert_eq!(*failed_store.keys.lock().unwrap(), vec!["a", "b"]);
    }
}
