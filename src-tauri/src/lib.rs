mod db;
mod models;
mod notification;
mod scheduler;

use std::sync::{Arc, Mutex};

use db::CourseDatabase;
use models::{
    Course, PeriodTime, ReminderSettings, TermConfig, WidgetSettings, WidgetSettingsPatch,
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
        let result = {
            let storage = self
                .0
                .lock()
                .map_err(|_| "课程存储当前不可用，请重新启动应用。".to_string())?;
            let database = match &*storage {
                StorageAvailability::Ready(database) => database,
                StorageAvailability::Unavailable { message } => return Err(message.clone()),
            };
            action(database)
        };
        result.map_err(|error| {
            eprintln!("Course database {operation} failed: {error}");
            format!("{operation}失败，请稍后重试。")
        })
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WidgetDataResponse {
    courses: Vec<Course>,
    term_config: Option<TermConfig>,
    settings: WidgetSettings,
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
fn load_day_count(state: State<'_, CourseState>) -> Result<u8, String> {
    state.run("读取课表视图偏好", CourseDatabase::load_day_count)
}

#[tauri::command]
fn save_day_count(state: State<'_, CourseState>, day_count: u8) -> Result<u8, String> {
    state.run("保存课表视图偏好", |database| {
        database.save_day_count(day_count)
    })
}

#[tauri::command]
fn save_period_times(
    state: State<'_, CourseState>,
    periods: Vec<PeriodTime>,
) -> Result<Vec<PeriodTime>, String> {
    state.run("保存作息", |database| {
        database.save_period_times(&periods)?;
        database
            .load_period_times()?
            .ok_or_else(|| db::StorageError::InvalidData("作息保存后无法读取。".into()))
    })
}

#[tauri::command]
fn load_reminder_configuration(
    state: State<'_, CourseState>,
) -> Result<db::ReminderConfiguration, String> {
    state.run("读取提醒设置", CourseDatabase::load_reminder_configuration)
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
                term_config: configuration.term_config,
                settings: database.load_widget_settings()?,
            })
        })
        .await
}

#[tauri::command]
fn export_backup(state: State<'_, CourseState>) -> Result<db::BackupData, String> {
    state.run("导出备份", CourseDatabase::export_backup)
}

#[tauri::command]
fn restore_backup(state: State<'_, CourseState>, backup: db::BackupData) -> Result<(), String> {
    state.run("恢复备份", |database| database.restore_backup(&backup))
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
fn open_widget(app: tauri::AppHandle, state: State<'_, CourseState>) -> Result<(), String> {
    if let Some(widget) = app.get_webview_window("widget") {
        return widget
            .show()
            .map_err(|_| "无法显示桌面课程小组件。".to_string());
    }
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
fn show_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "无法找到课程表窗口。".to_string())?;
    main.unminimize()
        .map_err(|_| "无法恢复课程表窗口。".to_string())?;
    main.show()
        .map_err(|_| "无法显示课程表窗口。".to_string())?;
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
        .tooltip("大学课程表")
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
            create_tray(&app.handle().clone())?;
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
            clear_all_courses,
            update_course,
            delete_course,
            load_period_times,
            load_day_count,
            save_day_count,
            save_period_times,
            load_reminder_configuration,
            load_handled_reminder_keys,
            save_app_settings,
            load_widget_settings,
            load_widget_data,
            export_backup,
            restore_backup,
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
                if window.label() == "main" || window.label() == "widget" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("启动课程表失败");
}

#[cfg(test)]
mod tests {
    use super::{restored_widget_position, ScreenRect};

    const PRIMARY: ScreenRect = ScreenRect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };

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
