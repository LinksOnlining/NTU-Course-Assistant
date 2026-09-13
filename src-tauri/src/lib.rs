mod db;
mod models;
mod notification;
mod scheduler;

use std::sync::{Arc, Mutex};

use db::CourseDatabase;
use models::{Course, PeriodTime, ReminderSettings, TermConfig, WidgetSettings};
use serde::Serialize;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

enum StorageAvailability {
    Ready(CourseDatabase),
    Unavailable { message: String },
}

#[derive(Clone)]
struct CourseState(Arc<Mutex<StorageAvailability>>);

struct SchedulerState(scheduler::ReminderScheduler);

struct SqliteHandledStore(CourseState);

impl CourseState {
    fn run<T>(
        &self,
        operation: &str,
        action: impl FnOnce(&CourseDatabase) -> Result<T, db::StorageError>,
    ) -> Result<T, String> {
        let storage = self
            .0
            .lock()
            .map_err(|_| "课程存储当前不可用，请重新启动应用。".to_string())?;
        let database = match &*storage {
            StorageAvailability::Ready(database) => database,
            StorageAvailability::Unavailable { message } => return Err(message.clone()),
        };
        action(database).map_err(|error| {
            eprintln!("Course database {operation} failed: {error}");
            format!("{operation}失败，请稍后重试。")
        })
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
            "本地课程数据暂时无法加载：数据库来自较新版本，请升级应用后重试。".into()
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

#[tauri::command]
fn load_courses(state: State<'_, CourseState>) -> Result<LoadCoursesResponse, String> {
    state.run("读取课程", |database| {
        let result = database.load_courses()?;
        Ok(LoadCoursesResponse {
            courses: result.courses,
            warnings: result.warnings,
        })
    })
}

#[tauri::command]
fn insert_course(state: State<'_, CourseState>, course: Course) -> Result<(), String> {
    state.run("保存课程", |database| database.insert_course(&course))
}

#[tauri::command]
fn import_courses(
    state: State<'_, CourseState>,
    courses: Vec<Course>,
) -> Result<Vec<Course>, String> {
    state.run("批量导入课程", |database| {
        database.import_courses(&courses)
    })
}

#[tauri::command]
fn update_course(state: State<'_, CourseState>, course: Course) -> Result<(), String> {
    state.run("更新课程", |database| database.update_course(&course))
}

#[tauri::command]
fn delete_course(state: State<'_, CourseState>, id: String) -> Result<(), String> {
    state.run("删除课程", |database| database.delete_course(&id))
}

#[tauri::command]
fn load_period_times(state: State<'_, CourseState>) -> Result<Option<Vec<PeriodTime>>, String> {
    state.run("读取作息", CourseDatabase::load_period_times)
}

#[tauri::command]
fn save_period_times(
    state: State<'_, CourseState>,
    periods: Vec<PeriodTime>,
) -> Result<(), String> {
    state.run("保存作息", |database| {
        database.save_period_times(&periods)
    })
}

#[tauri::command]
fn load_reminder_configuration(
    state: State<'_, CourseState>,
) -> Result<db::ReminderConfiguration, String> {
    state.run("读取提醒设置", CourseDatabase::load_reminder_configuration)
}

#[tauri::command]
fn load_handled_reminder_keys(state: State<'_, CourseState>) -> Result<Vec<String>, String> {
    state.run("读取提醒状态", CourseDatabase::load_handled_reminder_keys)
}

#[tauri::command]
fn save_app_settings(
    state: State<'_, CourseState>,
    periods: Vec<PeriodTime>,
    term_config: Option<TermConfig>,
    reminder_settings: ReminderSettings,
) -> Result<(), String> {
    state.run("保存应用设置", |database| {
        database.save_app_settings(&periods, term_config.as_ref(), &reminder_settings)
    })
}

#[tauri::command]
fn load_widget_settings(state: State<'_, CourseState>) -> Result<WidgetSettings, String> {
    state.run("读取小组件设置", CourseDatabase::load_widget_settings)
}

#[tauri::command]
fn save_widget_settings(
    app: tauri::AppHandle,
    state: State<'_, CourseState>,
    settings: WidgetSettings,
) -> Result<(), String> {
    state.run("保存小组件设置", |database| {
        database.save_widget_settings(&settings)
    })?;
    if let Some(widget) = app.get_webview_window("widget") {
        widget
            .set_resizable(!settings.locked)
            .map_err(|_| "无法更新小组件锁定状态。".to_string())?;
    }
    Ok(())
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
fn show_widget(app: &tauri::AppHandle, settings: &WidgetSettings) -> Result<(), String> {
    if let Some(widget) = app.get_webview_window("widget") {
        widget
            .show()
            .map_err(|_| "无法显示桌面课程小组件原型。".to_string())?;
        return Ok(());
    }

    let mut builder =
        WebviewWindowBuilder::new(app, "widget", WebviewUrl::App("index.html?widget".into()))
            .title("课程小组件")
            .inner_size(
                settings.width.unwrap_or(360) as f64,
                settings.height.unwrap_or(430) as f64,
            )
            .min_inner_size(280.0, 220.0)
            .max_inner_size(1200.0, 1200.0)
            .resizable(!settings.locked)
            .maximizable(false)
            .minimizable(false)
            .decorations(false)
            .skip_taskbar(true)
            .always_on_bottom(true)
            .focused(false);
    if let (Some(x), Some(y)) = (settings.x, settings.y) {
        builder = builder.position(x as f64, y as f64);
    }
    builder.build().map(|_| ()).map_err(|error| {
        eprintln!("Widget window creation failed: {error}");
        "无法打开桌面课程小组件原型。".to_string()
    })
}

#[tauri::command]
fn open_widget(app: tauri::AppHandle, state: State<'_, CourseState>) -> Result<(), String> {
    let settings = state.run("读取小组件设置", CourseDatabase::load_widget_settings)?;
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
fn open_main(app: tauri::AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "无法找到课程表窗口。".to_string())?;
    main.show()
        .map_err(|_| "无法显示课程表窗口。".to_string())?;
    main.set_focus()
        .map_err(|_| "无法聚焦课程表窗口。".to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let storage = match app.path().app_local_data_dir() {
                Ok(directory) => {
                    let path = directory.join("courses.sqlite3");
                    match CourseDatabase::open(&path) {
                        Ok(database) => {
                            match database.schema_version() {
                                Ok(version) => eprintln!(
                                    "Course database ready at {} (schema {version})",
                                    path.display()
                                ),
                                Err(error) => {
                                    eprintln!("Course database schema read failed: {error}")
                                }
                            }
                            StorageAvailability::Ready(database)
                        }
                        Err(error) => {
                            eprintln!(
                                "Course database initialization failed at {}: {error}",
                                path.display()
                            );
                            StorageAvailability::Unavailable {
                                message: initialization_message(&error),
                            }
                        }
                    }
                }
                Err(error) => {
                    eprintln!("Application data directory resolution failed: {error}");
                    StorageAvailability::Unavailable {
                        message: "本地课程数据暂时无法加载，请检查应用数据目录权限后重启。".into(),
                    }
                }
            };
            let course_state = CourseState(Arc::new(Mutex::new(storage)));
            app.manage(course_state.clone());
            app.manage(SchedulerState(scheduler::ReminderScheduler::new(
                Arc::new(notification::WindowsNotificationAdapter::new(
                    app.handle().clone(),
                )),
                Arc::new(SqliteHandledStore(course_state)),
            )));
            if let Ok(settings) = app
                .state::<CourseState>()
                .run("读取小组件设置", CourseDatabase::load_widget_settings)
            {
                if settings.enabled {
                    show_widget(&app.handle().clone(), &settings)?;
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_courses,
            insert_course,
            import_courses,
            update_course,
            delete_course,
            load_period_times,
            save_period_times,
            load_reminder_configuration,
            load_handled_reminder_keys,
            save_app_settings,
            load_widget_settings,
            save_widget_settings,
            refresh_reminder_schedule,
            reminder_scheduler_status,
            open_widget,
            hide_widget,
            open_main
        ])
        .on_window_event(|window, event| {
            if window.label() == "widget" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("启动课程表失败");
}
