mod ai;
mod autostart;
mod db;
mod geocoding;
mod models;
mod notification;
mod scheduler;
mod secure_credentials;

use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};

use db::CourseDatabase;
use models::{
    AcademicTask, Course, CourseOverride, DiaryEntry, Exam, InboxConfirmation, InboxItem,
    PeriodTime, PersonalTask, PlannerEvent, ReminderSettings, Routine, Semester, TermConfig,
    TimeBlock, WidgetSettings, WidgetSettingsPatch,
};
use serde::Serialize;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};

const TRAY_OPEN_MAIN: &str = "tray-open-main";
const TRAY_TOGGLE_WIDGET: &str = "tray-toggle-widget";
const TRAY_QUIT: &str = "tray-quit";

static RUNTIME_OPERATION_ID: AtomicU64 = AtomicU64::new(1);

fn database_path_for_mode(app_local_data_dir: &Path, debug_build: bool) -> PathBuf {
    if debug_build {
        app_local_data_dir.join("dev-v2").join("courses.sqlite3")
    } else {
        app_local_data_dir.join("courses.sqlite3")
    }
}

fn database_path_for_build(app_local_data_dir: &Path) -> PathBuf {
    database_path_for_mode(app_local_data_dir, cfg!(debug_assertions))
}

#[cfg(debug_assertions)]
fn trace_runtime(stage: &str, request_id: u64, elapsed: std::time::Duration) {
    eprintln!(
        "[runtime] request={request_id} stage={stage} elapsed_ms={} thread={:?}",
        elapsed.as_millis(),
        std::thread::current().id()
    );
}

#[cfg(not(debug_assertions))]
fn trace_runtime(_stage: &str, _request_id: u64, _elapsed: std::time::Duration) {}

#[tauri::command]
#[allow(dead_code)]
fn trace_runtime_event(stage: String, generation: u64, elapsed_ms: u64) {
    #[cfg(debug_assertions)]
    eprintln!(
        "[frontend] generation={generation} stage={stage} elapsed_ms={elapsed_ms} thread={:?}",
        std::thread::current().id()
    );
    #[cfg(not(debug_assertions))]
    let _ = (stage, generation, elapsed_ms);
}

#[cfg(debug_assertions)]
fn debug_widget(message: &str) {
    eprintln!("[widget] {message}");
}

#[cfg(not(debug_assertions))]
fn debug_widget(_message: &str) {}

#[derive(Clone, Copy)]
struct ScreenRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn restored_widget_position(
    position: Option<(i32, i32)>,
    size: (u32, u32),
    screens: &[ScreenRect],
    fallback: Option<ScreenRect>,
) -> Option<(i32, i32)> {
    let (x, y) = position?;
    let visible = screens.iter().any(|screen| {
        let right = x.saturating_add(size.0 as i32);
        let bottom = y.saturating_add(size.1 as i32);
        right > screen.x
            && bottom > screen.y
            && x < screen.x.saturating_add(screen.width as i32)
            && y < screen.y.saturating_add(screen.height as i32)
    });
    if visible {
        Some((x, y))
    } else {
        fallback.map(|screen| (screen.x.saturating_add(40), screen.y.saturating_add(40)))
    }
}

fn available_screen_rects(app: &tauri::AppHandle) -> Vec<ScreenRect> {
    app.available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|monitor| {
            let area = monitor.work_area();
            ScreenRect {
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
            }
        })
        .collect()
}

#[derive(Clone)]
struct CourseState {
    database_path: Option<Arc<PathBuf>>,
    unavailable_message: Option<Arc<String>>,
}

struct SchedulerState(scheduler::ReminderScheduler);

struct SqliteHandledStore(CourseState);

impl CourseState {
    fn ready(path: PathBuf) -> Self {
        Self {
            database_path: Some(Arc::new(path)),
            unavailable_message: None,
        }
    }

    fn unavailable(message: String) -> Self {
        Self {
            database_path: None,
            unavailable_message: Some(Arc::new(message)),
        }
    }

    fn open_database(&self, operation: &str) -> Result<CourseDatabase, String> {
        if let Some(path) = &self.database_path {
            return CourseDatabase::connect(path).map_err(|error| {
                eprintln!("Course database {operation} open failed: {error}");
                format!("{operation}失败，请稍后重试。")
            });
        }
        Err(self
            .unavailable_message
            .as_deref()
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| "课程存储当前不可用，请重新启动应用。".into()))
    }

    fn run<T>(
        &self,
        operation: &str,
        action: impl FnOnce(&CourseDatabase) -> Result<T, db::StorageError>,
    ) -> Result<T, String> {
        let request_id = RUNTIME_OPERATION_ID.fetch_add(1, Ordering::Relaxed);
        let started = Instant::now();
        trace_runtime(&format!("{operation}.start"), request_id, started.elapsed());
        let database = self.open_database(operation)?;
        trace_runtime(
            &format!("{operation}.db-opened"),
            request_id,
            started.elapsed(),
        );
        let result = action(&database);
        drop(database);
        trace_runtime(
            &format!("{operation}.db-released"),
            request_id,
            started.elapsed(),
        );
        match result {
            Ok(value) => {
                trace_runtime(
                    &format!("{operation}.success"),
                    request_id,
                    started.elapsed(),
                );
                Ok(value)
            }
            Err(error) => {
                eprintln!("Course database {operation} failed: {error}");
                trace_runtime(&format!("{operation}.error"), request_id, started.elapsed());
                Err(format!("{operation}失败，请稍后重试。"))
            }
        }
    }

    async fn run_in_background<T: Send + 'static>(
        &self,
        operation: &'static str,
        action: impl FnOnce(&CourseDatabase) -> Result<T, db::StorageError> + Send + 'static,
    ) -> Result<T, String> {
        let state = self.clone();
        tauri::async_runtime::spawn_blocking(move || state.run(operation, action))
            .await
            .map_err(|_| format!("{operation}失败，请稍后重试。"))?
    }
}

impl scheduler::HandledStore for SqliteHandledStore {
    fn mark_handled(
        &self,
        occurrence_key: &str,
        handled_at_milliseconds: i64,
    ) -> Result<(), String> {
        self.0.run("记录提醒状态", |database| {
            database.mark_reminder_handled(occurrence_key, handled_at_milliseconds)
        })
    }
}

fn initialization_message(error: &db::StorageError) -> String {
    match error {
        db::StorageError::UnsupportedSchema(_) => {
            "本地数据库格式不受支持（当前仅支持 schema 8）；数据库未被修改。请使用兼容版本处理该文件。".into()
        }
        _ => "本地课程数据暂时无法加载，请检查应用数据目录权限或文件状态后重启。".into(),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadCoursesResponse {
    courses: Vec<Course>,
    warnings: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WidgetDataResponse {
    courses: Vec<Course>,
    periods: Option<Vec<PeriodTime>>,
    term_config: Option<TermConfig>,
    settings: WidgetSettings,
}

#[tauri::command]
async fn load_courses(state: State<'_, CourseState>) -> Result<LoadCoursesResponse, String> {
    state
        .run_in_background("读取课程", |database| {
            let result = database.load_courses()?;
            Ok(LoadCoursesResponse {
                courses: result.courses,
                warnings: result.warnings,
            })
        })
        .await
}

#[tauri::command]
async fn insert_course(state: State<'_, CourseState>, course: Course) -> Result<(), String> {
    state
        .run_in_background("保存课程", move |database| {
            database.insert_course(&course)
        })
        .await
}

#[tauri::command]
async fn import_courses(
    state: State<'_, CourseState>,
    courses: Vec<Course>,
) -> Result<Vec<Course>, String> {
    state
        .run_in_background("批量导入课程", move |database| {
            database.import_courses(&courses)
        })
        .await
}

#[tauri::command]
async fn clear_all_courses(state: State<'_, CourseState>) -> Result<(), String> {
    state
        .run_in_background("清空全部课程", CourseDatabase::clear_all_courses)
        .await
}

#[tauri::command]
async fn update_course(state: State<'_, CourseState>, course: Course) -> Result<(), String> {
    state
        .run_in_background("更新课程", move |database| {
            database.update_course(&course)
        })
        .await
}

#[tauri::command]
async fn delete_course(state: State<'_, CourseState>, id: String) -> Result<(), String> {
    state
        .run_in_background("删除课程", move |database| database.delete_course(&id))
        .await
}

#[tauri::command]
async fn load_semesters(state: State<'_, CourseState>) -> Result<Vec<Semester>, String> {
    state
        .run_in_background("读取学期", CourseDatabase::load_semesters)
        .await
}

#[tauri::command]
async fn save_semester(
    state: State<'_, CourseState>,
    semester: Semester,
) -> Result<Semester, String> {
    state
        .run_in_background("保存学期", move |database| {
            database.save_semester(&semester)
        })
        .await
}

#[tauri::command]
async fn archive_semester(
    state: State<'_, CourseState>,
    id: String,
    updated_at: String,
) -> Result<(), String> {
    state
        .run_in_background("归档学期", move |database| {
            database.archive_semester(&id, &updated_at)
        })
        .await
}

#[tauri::command]
async fn load_course_overrides(
    state: State<'_, CourseState>,
    semester_id: String,
) -> Result<Vec<CourseOverride>, String> {
    state
        .run_in_background("读取课表变更", move |database| {
            database.load_course_overrides(&semester_id)
        })
        .await
}

#[tauri::command]
async fn save_course_override(
    state: State<'_, CourseState>,
    value: CourseOverride,
) -> Result<CourseOverride, String> {
    state
        .run_in_background("保存课表变更", move |database| {
            database.save_course_override(&value)
        })
        .await
}

#[tauri::command]
async fn revoke_course_override(
    state: State<'_, CourseState>,
    id: String,
    updated_at: String,
) -> Result<(), String> {
    state
        .run_in_background("撤销课表变更", move |database| {
            database.revoke_course_override(&id, &updated_at)
        })
        .await
}

#[tauri::command]
async fn load_academic_tasks(
    state: State<'_, CourseState>,
    semester_id: String,
) -> Result<Vec<AcademicTask>, String> {
    state
        .run_in_background("读取学习事项", move |database| {
            database.load_academic_tasks(&semester_id)
        })
        .await
}

#[tauri::command]
async fn save_academic_task(
    state: State<'_, CourseState>,
    task: AcademicTask,
) -> Result<AcademicTask, String> {
    state
        .run_in_background("保存学习事项", move |database| {
            database.save_academic_task(&task)
        })
        .await
}

#[tauri::command]
async fn delete_academic_task(state: State<'_, CourseState>, id: String) -> Result<(), String> {
    state
        .run_in_background("删除学习事项", move |database| {
            database.delete_academic_task(&id)
        })
        .await
}

#[tauri::command]
async fn load_personal_tasks(state: State<'_, CourseState>) -> Result<Vec<PersonalTask>, String> {
    state
        .run_in_background("读取个人任务", CourseDatabase::load_personal_tasks)
        .await
}

#[tauri::command]
async fn create_personal_task(
    state: State<'_, CourseState>,
    task: PersonalTask,
) -> Result<PersonalTask, String> {
    state
        .run_in_background("创建个人任务", move |database| {
            database.create_personal_task(&task)
        })
        .await
}

#[tauri::command]
async fn update_personal_task(
    state: State<'_, CourseState>,
    task: PersonalTask,
) -> Result<PersonalTask, String> {
    state
        .run_in_background("更新个人任务", move |database| {
            database.update_personal_task(&task)
        })
        .await
}

#[tauri::command]
async fn set_personal_task_completed(
    state: State<'_, CourseState>,
    id: String,
    completed: bool,
    updated_at: String,
) -> Result<PersonalTask, String> {
    state
        .run_in_background("更新个人任务状态", move |database| {
            database.set_personal_task_completed(&id, completed, &updated_at)
        })
        .await
}

#[tauri::command]
async fn delete_personal_task(state: State<'_, CourseState>, id: String) -> Result<(), String> {
    state
        .run_in_background("删除个人任务", move |database| {
            database.delete_personal_task(&id)
        })
        .await
}

#[tauri::command]
async fn load_diary_entry(
    state: State<'_, CourseState>,
    date: String,
) -> Result<Option<DiaryEntry>, String> {
    state
        .run_in_background("读取日记", move |database| {
            database.load_diary_entry(&date)
        })
        .await
}

#[tauri::command]
async fn load_diary_entries_for_search(
    state: State<'_, CourseState>,
) -> Result<Vec<DiaryEntry>, String> {
    state
        .run_in_background(
            "本地搜索日记",
            CourseDatabase::load_diary_entries_for_search,
        )
        .await
}

#[tauri::command]
async fn save_diary_entry(
    state: State<'_, CourseState>,
    entry: DiaryEntry,
) -> Result<DiaryEntry, String> {
    state
        .run_in_background("保存日记", move |database| {
            database.save_diary_entry(&entry)
        })
        .await
}

#[tauri::command]
async fn load_diary_content_dates(state: State<'_, CourseState>) -> Result<Vec<String>, String> {
    state
        .run_in_background("读取日记日期", |database| {
            database.load_diary_content_dates()
        })
        .await
}

#[tauri::command]
async fn has_diary_entry(state: State<'_, CourseState>, date: String) -> Result<bool, String> {
    state
        .run_in_background("检查日记状态", move |database| {
            database.has_diary_entry(&date)
        })
        .await
}

#[tauri::command]
async fn create_inbox_item(
    state: State<'_, CourseState>,
    id: String,
    raw_text: String,
    created_at: String,
) -> Result<InboxItem, String> {
    state
        .run_in_background("保存收件箱原文", move |database| {
            database.create_inbox_item(&id, &raw_text, &created_at)
        })
        .await
}

#[tauri::command]
async fn load_inbox_items(state: State<'_, CourseState>) -> Result<Vec<InboxItem>, String> {
    state
        .run_in_background("读取收件箱", CourseDatabase::load_inbox_items)
        .await
}

#[tauri::command]
async fn count_pending_inbox_items(state: State<'_, CourseState>) -> Result<u32, String> {
    state
        .run_in_background("读取待整理数量", CourseDatabase::count_pending_inbox_items)
        .await
}

#[tauri::command]
async fn save_inbox_parse_result(
    state: State<'_, CourseState>,
    id: String,
    parse_kind: String,
    parse_payload_json: String,
    parser_version: String,
    updated_at: String,
) -> Result<InboxItem, String> {
    state
        .run_in_background("保存本地解析结果", move |database| {
            database.save_inbox_parse_result(
                &id,
                &parse_kind,
                &parse_payload_json,
                &parser_version,
                &updated_at,
            )
        })
        .await
}

#[tauri::command]
async fn dismiss_inbox_item(
    state: State<'_, CourseState>,
    id: String,
    updated_at: String,
) -> Result<(), String> {
    state
        .run_in_background("忽略收件箱内容", move |database| {
            database.dismiss_inbox_item(&id, &updated_at)
        })
        .await
}

#[tauri::command]
async fn delete_inbox_item(state: State<'_, CourseState>, id: String) -> Result<(), String> {
    state
        .run_in_background("删除收件箱内容", move |database| {
            database.delete_inbox_item(&id)
        })
        .await
}

#[tauri::command]
async fn confirm_inbox_as_task(
    state: State<'_, CourseState>,
    id: String,
    task: PersonalTask,
) -> Result<InboxConfirmation, String> {
    state
        .run_in_background("确认收件箱任务", move |database| {
            database.confirm_inbox_as_task(&id, &task)
        })
        .await
}

#[tauri::command]
async fn confirm_inbox_as_event(
    state: State<'_, CourseState>,
    id: String,
    event: PlannerEvent,
) -> Result<InboxConfirmation, String> {
    state
        .run_in_background("确认收件箱日程", move |database| {
            database.confirm_inbox_as_event(&id, &event)
        })
        .await
}

#[tauri::command]
async fn load_planner_events(
    state: State<'_, CourseState>,
    start_date: String,
    end_date: String,
) -> Result<Vec<PlannerEvent>, String> {
    state
        .run_in_background("读取个人日程", move |database| {
            database.load_planner_events(&start_date, &end_date)
        })
        .await
}

#[tauri::command]
async fn load_all_planner_events_for_search(
    state: State<'_, CourseState>,
) -> Result<Vec<PlannerEvent>, String> {
    state
        .run_in_background(
            "本地搜索个人日程",
            CourseDatabase::load_all_planner_events_for_search,
        )
        .await
}

#[tauri::command]
async fn create_planner_event(
    state: State<'_, CourseState>,
    event: PlannerEvent,
) -> Result<PlannerEvent, String> {
    state
        .run_in_background("创建个人日程", move |database| {
            database.create_planner_event(&event)
        })
        .await
}

#[tauri::command]
async fn update_planner_event(
    state: State<'_, CourseState>,
    event: PlannerEvent,
) -> Result<PlannerEvent, String> {
    state
        .run_in_background("更新个人日程", move |database| {
            database.update_planner_event(&event)
        })
        .await
}

#[tauri::command]
async fn delete_planner_event(state: State<'_, CourseState>, id: String) -> Result<(), String> {
    state
        .run_in_background("删除个人日程", move |database| {
            database.delete_planner_event(&id)
        })
        .await
}

#[tauri::command]
async fn load_routines(state: State<'_, CourseState>) -> Result<Vec<Routine>, String> {
    state
        .run_in_background("读取日常习惯", CourseDatabase::load_routines)
        .await
}

#[tauri::command]
async fn create_routine(
    state: State<'_, CourseState>,
    routine: Routine,
) -> Result<Routine, String> {
    state
        .run_in_background("创建日常习惯", move |database| {
            database.create_routine(&routine)
        })
        .await
}

#[tauri::command]
async fn update_routine(
    state: State<'_, CourseState>,
    routine: Routine,
) -> Result<Routine, String> {
    state
        .run_in_background("更新日常习惯", move |database| {
            database.update_routine(&routine)
        })
        .await
}

#[tauri::command]
async fn delete_routine(state: State<'_, CourseState>, id: String) -> Result<(), String> {
    state
        .run_in_background("删除日常习惯", move |database| {
            database.delete_routine(&id)
        })
        .await
}

#[tauri::command]
async fn confirm_routine_suggestion(
    state: State<'_, CourseState>,
    routine_id: String,
    target_date: String,
    event: PlannerEvent,
) -> Result<PlannerEvent, String> {
    state
        .run_in_background("确认日常习惯安排", move |database| {
            database.confirm_routine_suggestion(&routine_id, &target_date, &event)
        })
        .await
}

#[tauri::command]
async fn load_time_blocks(
    state: State<'_, CourseState>,
    start_date: String,
    end_date: String,
) -> Result<Vec<TimeBlock>, String> {
    state
        .run_in_background("读取任务时间安排", move |database| {
            database.load_time_blocks(&start_date, &end_date)
        })
        .await
}

#[tauri::command]
async fn load_time_blocks_for_task(
    state: State<'_, CourseState>,
    personal_task_id: String,
) -> Result<Vec<TimeBlock>, String> {
    state
        .run_in_background("读取任务时间安排", move |database| {
            database.load_time_blocks_for_task(&personal_task_id)
        })
        .await
}

#[tauri::command]
async fn create_time_block(
    state: State<'_, CourseState>,
    block: TimeBlock,
) -> Result<TimeBlock, String> {
    state
        .run_in_background("安排任务时间", move |database| {
            database.create_time_block(&block)
        })
        .await
}

#[tauri::command]
async fn update_time_block(
    state: State<'_, CourseState>,
    block: TimeBlock,
) -> Result<TimeBlock, String> {
    state
        .run_in_background("更新任务时间安排", move |database| {
            database.update_time_block(&block)
        })
        .await
}

#[tauri::command]
async fn delete_time_block(state: State<'_, CourseState>, id: String) -> Result<(), String> {
    state
        .run_in_background("删除任务时间安排", move |database| {
            database.delete_time_block(&id)
        })
        .await
}

#[tauri::command]
async fn load_exams(
    state: State<'_, CourseState>,
    semester_id: String,
) -> Result<Vec<Exam>, String> {
    state
        .run_in_background("读取考试", move |database| {
            database.load_exams(&semester_id)
        })
        .await
}

#[tauri::command]
async fn save_exam(state: State<'_, CourseState>, exam: Exam) -> Result<Exam, String> {
    state
        .run_in_background("保存考试", move |database| database.save_exam(&exam))
        .await
}

#[tauri::command]
async fn delete_exam(state: State<'_, CourseState>, id: String) -> Result<(), String> {
    state
        .run_in_background("删除考试", move |database| database.delete_exam(&id))
        .await
}

#[tauri::command]
async fn load_period_times(
    state: State<'_, CourseState>,
) -> Result<Option<Vec<PeriodTime>>, String> {
    state
        .run_in_background("读取作息", CourseDatabase::load_period_times)
        .await
}

#[tauri::command]
async fn load_day_count(state: State<'_, CourseState>) -> Result<u8, String> {
    state
        .run_in_background("读取课表视图偏好", CourseDatabase::load_day_count)
        .await
}

#[tauri::command]
async fn save_day_count(state: State<'_, CourseState>, day_count: u8) -> Result<u8, String> {
    state
        .run_in_background("保存课表视图偏好", move |database| {
            database.save_day_count(day_count)
        })
        .await
}

#[tauri::command]
async fn save_period_times(
    state: State<'_, CourseState>,
    periods: Vec<PeriodTime>,
) -> Result<Vec<PeriodTime>, String> {
    state
        .run_in_background("保存作息", move |database| {
            database.save_period_times(&periods)?;
            database
                .load_period_times()?
                .ok_or_else(|| db::StorageError::InvalidData("作息保存后无法读取。".into()))
        })
        .await
}

#[tauri::command]
async fn load_reminder_configuration(
    state: State<'_, CourseState>,
) -> Result<db::ReminderConfiguration, String> {
    state
        .run_in_background("读取提醒设置", CourseDatabase::load_reminder_configuration)
        .await
}

#[tauri::command]
async fn load_handled_reminder_keys(state: State<'_, CourseState>) -> Result<Vec<String>, String> {
    state
        .run_in_background("读取提醒状态", CourseDatabase::load_handled_reminder_keys)
        .await
}

#[tauri::command]
async fn save_app_settings(
    state: State<'_, CourseState>,
    periods: Vec<PeriodTime>,
    term_config: Option<TermConfig>,
    reminder_settings: ReminderSettings,
) -> Result<SavedAppSettings, String> {
    state
        .run_in_background("保存应用设置", move |database| {
            database.save_app_settings(&periods, term_config.as_ref(), &reminder_settings)?;
            Ok(SavedAppSettings {
                periods: database
                    .load_period_times()?
                    .ok_or_else(|| db::StorageError::InvalidData("作息保存后无法读取。".into()))?,
                configuration: database.load_reminder_configuration()?,
            })
        })
        .await
}

#[tauri::command]
async fn load_widget_settings(state: State<'_, CourseState>) -> Result<WidgetSettings, String> {
    debug_widget("load settings requested");
    state
        .run_in_background("读取小组件设置", CourseDatabase::load_widget_settings)
        .await
}

#[tauri::command]
async fn load_widget_data(state: State<'_, CourseState>) -> Result<WidgetDataResponse, String> {
    debug_widget("load data requested");
    state
        .run_in_background("读取小组件数据", |database| {
            let courses = database.load_courses()?.courses;
            let configuration = database.load_reminder_configuration()?;
            Ok(WidgetDataResponse {
                courses,
                periods: database.load_period_times()?,
                term_config: configuration.term_config,
                settings: database.load_widget_settings()?,
            })
        })
        .await
}

#[tauri::command]
async fn patch_widget_settings(
    app: tauri::AppHandle,
    state: State<'_, CourseState>,
    patch: WidgetSettingsPatch,
) -> Result<WidgetSettings, String> {
    debug_widget("settings patch requested");
    let updates_lock_state = patch.locked.is_some();
    let settings = state
        .run_in_background("保存小组件设置", move |database| {
            database.patch_widget_settings(&patch)
        })
        .await?;
    debug_widget("settings patch completed");
    if updates_lock_state {
        let app = app.clone();
        let locked = settings.locked;
        tauri::async_runtime::spawn(async move {
            if let Some(widget) = app.get_webview_window("widget") {
                if widget.set_resizable(!locked).is_err() {
                    eprintln!("Widget lock update failed");
                }
            }
        });
    }
    Ok(settings)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SavedAppSettings {
    periods: Vec<PeriodTime>,
    configuration: db::ReminderConfiguration,
}

#[tauri::command]
fn refresh_reminder_schedule(
    scheduler: State<'_, SchedulerState>,
    enabled: bool,
    plans: Vec<scheduler::ReminderPlan>,
) -> Result<(), String> {
    scheduler.0.refresh(enabled, plans)
}

#[tauri::command]
fn reminder_scheduler_status(
    scheduler: State<'_, SchedulerState>,
) -> Result<scheduler::SchedulerStatus, String> {
    scheduler.0.status()
}

#[tauri::command]
fn send_test_course_notification(app: tauri::AppHandle) -> Result<(), String> {
    notification::send_test_notification(&app)
}

#[tauri::command]
fn show_widget(app: &tauri::AppHandle, settings: &WidgetSettings) -> Result<(), String> {
    if let Some(widget) = app.get_webview_window("widget") {
        debug_widget("show existing window");
        widget
            .show()
            .map_err(|_| "无法显示桌面课程小组件原型。".to_string())?;
        return Ok(());
    }

    let builder =
        WebviewWindowBuilder::new(app, "widget", WebviewUrl::App("index.html?widget".into()))
            .title("课程小组件")
            .inner_size(360.0, 430.0)
            .min_inner_size(280.0, 220.0)
            .max_inner_size(1200.0, 1200.0)
            .resizable(!settings.locked)
            .maximizable(false)
            .minimizable(false)
            .decorations(false)
            .skip_taskbar(true)
            .always_on_bottom(true)
            .focused(false);
    debug_widget("create window requested");
    let widget = builder.build().map_err(|error| {
        eprintln!("Widget window creation failed: {error}");
        "无法打开桌面课程小组件原型。".to_string()
    })?;
    debug_widget("window created");
    let size = (
        settings.width.unwrap_or(360),
        settings.height.unwrap_or(430),
    );
    widget
        .set_size(PhysicalSize::new(size.0, size.1))
        .map_err(|_| "无法恢复小组件尺寸。".to_string())?;
    let screens = available_screen_rects(app);
    let primary = app.primary_monitor().ok().flatten().map(|monitor| {
        let area = monitor.work_area();
        ScreenRect {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        }
    });
    if let Some((x, y)) = restored_widget_position(
        settings.x.zip(settings.y),
        size,
        &screens,
        primary.or_else(|| screens.first().copied()),
    ) {
        widget
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|_| "无法恢复小组件位置。".to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn open_widget(app: tauri::AppHandle, state: State<'_, CourseState>) -> Result<(), String> {
    if let Some(widget) = app.get_webview_window("widget") {
        return widget
            .show()
            .map_err(|_| "无法显示桌面课程小组件。".to_string());
    }
    let settings = state
        .run_in_background("读取小组件设置", CourseDatabase::load_widget_settings)
        .await?;
    show_widget(&app, &settings)
}

#[tauri::command]
fn hide_widget(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(widget) = app.get_webview_window("widget") {
        widget
            .hide()
            .map_err(|_| "无法关闭桌面课程小组件。".to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let main = if let Some(main) = app.get_webview_window("main") {
        main
    } else {
        let config = app
            .config()
            .app
            .windows
            .first()
            .ok_or_else(|| "无法恢复课程表窗口。".to_string())?;
        WebviewWindowBuilder::from_config(app, config)
            .map_err(|_| "无法恢复课程表窗口。".to_string())?
            .build()
            .map_err(|_| "无法恢复课程表窗口。".to_string())?
    };
    main.unminimize()
        .map_err(|_| "无法恢复课程表窗口。".to_string())?;
    main.show()
        .map_err(|_| "无法显示课程表窗口。".to_string())?;
    main.maximize()
        .map_err(|_| "无法最大化课程表窗口。".to_string())?;
    main.set_focus()
        .map_err(|_| "无法聚焦课程表窗口。".to_string())
}

#[tauri::command]
fn open_main(app: tauri::AppHandle) -> Result<(), String> {
    show_main_window(&app)
}

fn toggle_widget_from_tray(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<CourseState>();
    let settings = state.run("读取小组件设置", CourseDatabase::load_widget_settings)?;
    if !settings.enabled {
        let next = state.run("保存小组件设置", |database| {
            database.patch_widget_settings(&WidgetSettingsPatch {
                enabled: Some(true),
                display_mode: None,
                locked: None,
                x: None,
                y: None,
                width: None,
                height: None,
            })
        })?;
        show_widget(app, &next)?;
        let _ = app.emit("widget-settings-changed", ());
        return Ok(());
    }
    if let Some(widget) = app.get_webview_window("widget") {
        if widget.is_visible().unwrap_or(false) {
            return widget
                .hide()
                .map_err(|_| "无法隐藏桌面课程小组件。".to_string());
        }
    }
    show_widget(app, &settings)
}

fn create_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open_main = MenuItem::with_id(app, TRAY_OPEN_MAIN, "打开课程表", true, None::<&str>)?;
    let toggle_widget = MenuItem::with_id(
        app,
        TRAY_TOGGLE_WIDGET,
        "显示 / 隐藏桌面小组件",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, TRAY_QUIT, "退出程序", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&open_main, &toggle_widget, &separator, &quit])?;
    let icon = Image::from_bytes(include_bytes!("../icons/tray/tray-icon.png"))?;
    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("Links Workplace")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_OPEN_MAIN => {
                let _ = show_main_window(app);
            }
            TRAY_TOGGLE_WIDGET => {
                let _ = toggle_widget_from_tray(app);
            }
            TRAY_QUIT => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                let _ = show_main_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(ai::AiService::default())
        .manage(geocoding::GeocodingState::new().expect("初始化天气地理编码 HTTP 客户端失败"))
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = show_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let course_state = match app.path().app_local_data_dir() {
                Ok(directory) => {
                    let path = database_path_for_build(&directory);
                    match CourseDatabase::open(&path) {
                        Ok(database) => {
                            match database.schema_version() {
                                Ok(version) => {
                                    eprintln!("Course database ready (schema {version})")
                                }
                                Err(_) => eprintln!("Course database schema read failed"),
                            }
                            drop(database);
                            CourseState::ready(path)
                        }
                        Err(error) => {
                            eprintln!("Course database initialization failed");
                            CourseState::unavailable(initialization_message(&error))
                        }
                    }
                }
                Err(error) => {
                    eprintln!("Application data directory resolution failed: {error}");
                    CourseState::unavailable(
                        "本地课程数据暂时无法加载，请检查应用数据目录权限后重启。".into(),
                    )
                }
            };
            app.manage(course_state.clone());
            app.manage(SchedulerState(scheduler::ReminderScheduler::new(
                Arc::new(notification::WindowsNotificationAdapter::new(
                    app.handle().clone(),
                )),
                Arc::new(SqliteHandledStore(course_state)),
            )));
            create_tray(&app.handle().clone())?;
            if let Ok(settings) = app
                .state::<CourseState>()
                .run("读取小组件设置", CourseDatabase::load_widget_settings)
            {
                if settings.enabled {
                    show_widget(&app.handle().clone(), &settings)?;
                }
            }
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1000));

                let main_thread_handle = app_handle.clone();
                let _ = app_handle.run_on_main_thread(move || {
                    let _ = show_main_window(&main_thread_handle);
                });
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            autostart::get_autostart_enabled,
            autostart::set_autostart_enabled,
            ai::set_deepseek_api_key,
            ai::get_deepseek_api_key_status,
            ai::delete_deepseek_api_key,
            ai::discover_deepseek_models,
            ai::generate_deepseek_text,
            ai::generate_deepseek_structured,
            ai::generate_deepseek_tool_turn,
            load_courses,
            insert_course,
            import_courses,
            clear_all_courses,
            update_course,
            delete_course,
            load_semesters,
            save_semester,
            archive_semester,
            load_course_overrides,
            save_course_override,
            revoke_course_override,
            load_academic_tasks,
            save_academic_task,
            delete_academic_task,
            load_personal_tasks,
            create_personal_task,
            update_personal_task,
            set_personal_task_completed,
            delete_personal_task,
            load_diary_entry,
            load_diary_entries_for_search,
            save_diary_entry,
            load_diary_content_dates,
            has_diary_entry,
            create_inbox_item,
            load_inbox_items,
            count_pending_inbox_items,
            save_inbox_parse_result,
            dismiss_inbox_item,
            delete_inbox_item,
            confirm_inbox_as_task,
            confirm_inbox_as_event,
            load_planner_events,
            load_all_planner_events_for_search,
            create_planner_event,
            update_planner_event,
            delete_planner_event,
            load_routines,
            create_routine,
            update_routine,
            delete_routine,
            confirm_routine_suggestion,
            geocoding::search_weather_location,
            geocoding::cancel_weather_location_search,
            geocoding::reverse_geocode_weather_location,
            geocoding::get_weather_map_image,
            geocoding::get_weather_credential_status,
            geocoding::set_weather_provider_key,
            geocoding::delete_weather_provider_key,
            load_time_blocks,
            load_time_blocks_for_task,
            create_time_block,
            update_time_block,
            delete_time_block,
            load_exams,
            save_exam,
            delete_exam,
            load_period_times,
            load_day_count,
            save_day_count,
            save_period_times,
            load_reminder_configuration,
            load_handled_reminder_keys,
            save_app_settings,
            load_widget_settings,
            load_widget_data,
            trace_runtime_event,
            patch_widget_settings,
            refresh_reminder_schedule,
            reminder_scheduler_status,
            send_test_course_notification,
            open_widget,
            hide_widget,
            open_main
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "widget" {
                    api.prevent_close();
                    let _ = window.hide();
                } else if window.label() == "main" {
                    let widget_is_visible = window
                        .app_handle()
                        .get_webview_window("widget")
                        .and_then(|widget| widget.is_visible().ok())
                        .unwrap_or(false);
                    if widget_is_visible {
                        // Keep the already-loaded main WebView alive while the visible widget owns
                        // the process lifecycle. Rebuilding a destroyed main WebView can reopen blank.
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("启动课程表失败");
}

#[cfg(test)]
mod tests {
    use super::{database_path_for_mode, restored_widget_position, ScreenRect};
    use std::path::Path;

    const PRIMARY: ScreenRect = ScreenRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };

    #[test]
    fn debug_database_is_isolated_under_the_links_product_identity() {
        let root = Path::new("C:/Users/example/AppData/Local/com.links.workplace.desktop");
        assert_eq!(
            database_path_for_mode(root, true),
            root.join("dev-v2").join("courses.sqlite3")
        );
        assert_eq!(
            database_path_for_mode(root, false),
            root.join("courses.sqlite3")
        );
    }

    #[test]
    fn visible_widget_position_is_retained_across_available_monitors() {
        let second = ScreenRect {
            x: 1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        assert_eq!(
            restored_widget_position(
                Some((2100, 80)),
                (360, 430),
                &[PRIMARY, second],
                Some(PRIMARY)
            ),
            Some((2100, 80))
        );
    }

    #[test]
    fn unavailable_screen_position_returns_to_primary_work_area() {
        assert_eq!(
            restored_widget_position(Some((2500, 80)), (360, 430), &[PRIMARY], Some(PRIMARY)),
            Some((40, 40))
        );
    }
}
