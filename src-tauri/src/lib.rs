mod db;
mod models;

use std::sync::Mutex;

use db::CourseDatabase;
use models::Course;
use serde::Serialize;
use tauri::{Manager, State};

enum StorageAvailability {
    Ready(CourseDatabase),
    Unavailable,
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
        let StorageAvailability::Ready(database) = &*storage else {
            return Err("无法访问本地课程数据库，请检查应用数据目录权限后重启。".into());
        };
        action(database).map_err(|error| {
            eprintln!("Course database {operation} failed: {error}");
            format!("{operation}失败，请稍后重试。")
        })
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
                            StorageAvailability::Unavailable
                        }
                    }
                }
                Err(error) => {
                    eprintln!("Application data directory resolution failed: {error}");
                    StorageAvailability::Unavailable
                }
            };
            app.manage(CourseState(Mutex::new(storage)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_courses,
            insert_course,
            update_course,
            delete_course
        ])
        .run(tauri::generate_context!())
        .expect("启动课程表失败");
}
