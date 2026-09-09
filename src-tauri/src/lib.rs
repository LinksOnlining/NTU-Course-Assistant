mod db;
mod models;

use std::sync::Mutex;

use db::CourseDatabase;
use models::{Course, PeriodTime};
use serde::Serialize;
use tauri::{Manager, State};

enum StorageAvailability {
    Ready(CourseDatabase),
    Unavailable { message: String },
}

struct CourseState(Mutex<StorageAvailability>);

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

pub fn run() {
    tauri::Builder::default()
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
            app.manage(CourseState(Mutex::new(storage)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_courses,
            insert_course,
            update_course,
            delete_course,
            load_period_times,
            save_period_times
        ])
        .run(tauri::generate_context!())
        .expect("启动课程表失败");
}
