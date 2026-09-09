use std::{fmt, fs, path::Path, time::Duration};

use rusqlite::{params, Connection, Row};

use crate::models::Course;

const CURRENT_SCHEMA_VERSION: i64 = 1;

#[derive(Debug)]
pub enum StorageError {
    Io(std::io::Error),
    Sqlite(rusqlite::Error),
    Json(serde_json::Error),
    InvalidData(String),
    UnsupportedSchema(i64),
    NotFound,
}

impl fmt::Display for StorageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "filesystem error: {error}"),
            Self::Sqlite(error) => write!(formatter, "sqlite error: {error}"),
            Self::Json(error) => write!(formatter, "json error: {error}"),
            Self::InvalidData(message) => write!(formatter, "invalid course data: {message}"),
            Self::UnsupportedSchema(version) => {
                write!(formatter, "unsupported schema version: {version}")
            }
            Self::NotFound => write!(formatter, "course not found"),
        }
    }
}

impl std::error::Error for StorageError {}

impl From<std::io::Error> for StorageError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<rusqlite::Error> for StorageError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<serde_json::Error> for StorageError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

#[derive(Debug)]
pub struct LoadResult {
    pub courses: Vec<Course>,
    pub warnings: Vec<String>,
}

pub struct CourseDatabase {
    connection: Connection,
}

impl CourseDatabase {
    pub fn open(path: &Path) -> Result<Self, StorageError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        Self::from_connection(connection)
    }

    fn from_connection(connection: Connection) -> Result<Self, StorageError> {
        connection.busy_timeout(Duration::from_secs(3))?;
        connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        let mut database = Self { connection };
        database.migrate()?;
        Ok(database)
    }

    fn migrate(&mut self) -> Result<(), StorageError> {
        let version: i64 = self
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > CURRENT_SCHEMA_VERSION {
            return Err(StorageError::UnsupportedSchema(version));
        }
        if version < 1 {
            let transaction = self.connection.transaction()?;
            transaction.execute_batch(
                "CREATE TABLE courses (
                    id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
                    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
                    teacher TEXT NULL CHECK(teacher IS NULL OR length(trim(teacher)) BETWEEN 1 AND 100),
                    classroom TEXT NULL CHECK(classroom IS NULL OR length(trim(classroom)) BETWEEN 1 AND 100),
                    weekday INTEGER NOT NULL CHECK(weekday BETWEEN 1 AND 7),
                    start_time TEXT NOT NULL CHECK(length(start_time) = 5),
                    end_time TEXT NOT NULL CHECK(length(end_time) = 5),
                    start_period INTEGER NULL CHECK(start_period IS NULL OR start_period > 0),
                    end_period INTEGER NULL CHECK(end_period IS NULL OR end_period > 0),
                    weeks TEXT NOT NULL,
                    CHECK((start_period IS NULL AND end_period IS NULL) OR
                          (start_period IS NOT NULL AND end_period IS NOT NULL AND end_period >= start_period))
                );",
            )?;
            transaction.pragma_update(None, "user_version", 1)?;
            transaction.commit()?;
        }
        Ok(())
    }

    pub fn schema_version(&self) -> Result<i64, StorageError> {
        Ok(self
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))?)
    }

    pub fn load_courses(&self) -> Result<LoadResult, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, teacher, classroom, weekday, start_time, end_time,
                    start_period, end_period, weeks
             FROM courses ORDER BY weekday, start_time, id",
        )?;
        let mut rows = statement.query([])?;
        let mut courses = Vec::new();
        let mut warnings = Vec::new();
        let mut row_number = 0;
        while let Some(row) = rows.next()? {
            row_number += 1;
            match row_to_course(row).and_then(|course| {
                course.validate().map_err(StorageError::InvalidData)?;
                Ok(course)
            }) {
                Ok(course) => courses.push(course),
                Err(error) => {
                    eprintln!("Skipping invalid stored course at row {row_number}: {error}");
                    warnings.push(format!(
                        "发现一条异常课程记录（第 {row_number} 条），已跳过且未修改原数据。"
                    ));
                }
            }
        }
        Ok(LoadResult { courses, warnings })
    }

    pub fn insert_course(&self, course: &Course) -> Result<(), StorageError> {
        course.validate().map_err(StorageError::InvalidData)?;
        let weeks = serde_json::to_string(&course.weeks)?;
        self.connection.execute(
            "INSERT INTO courses
             (id, name, teacher, classroom, weekday, start_time, end_time, start_period, end_period, weeks)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                &course.id,
                &course.name,
                &course.teacher,
                &course.classroom,
                course.weekday,
                &course.start_time,
                &course.end_time,
                course.start_period,
                course.end_period,
                weeks,
            ],
        )?;
        Ok(())
    }

    pub fn update_course(&self, course: &Course) -> Result<(), StorageError> {
        course.validate().map_err(StorageError::InvalidData)?;
        let weeks = serde_json::to_string(&course.weeks)?;
        let affected = self.connection.execute(
            "UPDATE courses SET name=?2, teacher=?3, classroom=?4, weekday=?5,
                    start_time=?6, end_time=?7, start_period=?8, end_period=?9, weeks=?10
             WHERE id=?1",
            params![
                &course.id,
                &course.name,
                &course.teacher,
                &course.classroom,
                course.weekday,
                &course.start_time,
                &course.end_time,
                course.start_period,
                course.end_period,
                weeks,
            ],
        )?;
        if affected == 0 {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn delete_course(&self, id: &str) -> Result<(), StorageError> {
        if id.trim().is_empty() || id.trim() != id {
            return Err(StorageError::InvalidData("课程 ID 无效".into()));
        }
        if self
            .connection
            .execute("DELETE FROM courses WHERE id=?1", [id])?
            == 0
        {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }
}

fn row_to_course(row: &Row<'_>) -> Result<Course, StorageError> {
    let weeks_json: String = row.get(9)?;
    Ok(Course {
        id: row.get(0)?,
        name: row.get(1)?,
        teacher: row.get(2)?,
        classroom: row.get(3)?,
        weekday: row.get(4)?,
        start_time: row.get(5)?,
        end_time: row.get(6)?,
        start_period: row.get(7)?,
        end_period: row.get(8)?,
        weeks: serde_json::from_str(&weeks_json)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static DATABASE_NUMBER: AtomicU64 = AtomicU64::new(1);

    fn database() -> CourseDatabase {
        CourseDatabase::from_connection(Connection::open_in_memory().expect("open memory database"))
            .expect("migrate memory database")
    }

    fn course() -> Course {
        Course {
            id: "course-id".into(),
            name: "机械设计基础".into(),
            teacher: None,
            classroom: None,
            weekday: 3,
            start_period: None,
            end_period: None,
            start_time: "14:00".into(),
            end_time: "15:30".into(),
            weeks: (1..=16).collect(),
        }
    }

    fn temporary_database_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "ntu-course-assistant-{}-{}.sqlite3",
            std::process::id(),
            DATABASE_NUMBER.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn remove_database_files(path: &Path) {
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(format!("{}-wal", path.display()));
        let _ = fs::remove_file(format!("{}-shm", path.display()));
    }

    #[test]
    fn empty_database_runs_versioned_migration() {
        let database = database();
        assert_eq!(database.schema_version().expect("schema version"), 1);
        let table_count: i64 = database
            .connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='courses'",
                [],
                |row| row.get(0),
            )
            .expect("courses table");
        assert_eq!(table_count, 1);
    }

    #[test]
    fn insert_round_trips_nulls_and_weeks() {
        let database = database();
        let expected = course();
        database.insert_course(&expected).expect("insert course");
        let loaded = database.load_courses().expect("load courses");
        assert_eq!(loaded.warnings, Vec::<String>::new());
        assert_eq!(loaded.courses, vec![expected]);
    }

    #[test]
    fn update_preserves_id_and_delete_removes_course() {
        let database = database();
        let mut expected = course();
        database.insert_course(&expected).expect("insert course");
        expected.name = "机械原理".into();
        expected.weekday = 4;
        expected.start_time = "09:00".into();
        expected.end_time = "10:30".into();
        database.update_course(&expected).expect("update course");
        assert_eq!(
            database.load_courses().expect("load updated").courses,
            vec![expected.clone()]
        );
        database.delete_course(&expected.id).expect("delete course");
        assert!(database
            .load_courses()
            .expect("load deleted")
            .courses
            .is_empty());
        assert!(matches!(
            database.delete_course(&expected.id),
            Err(StorageError::NotFound)
        ));
    }

    #[test]
    fn corrupt_json_is_reported_and_left_untouched() {
        let database = database();
        let expected = course();
        database.insert_course(&expected).expect("insert course");
        database
            .connection
            .execute(
                "UPDATE courses SET weeks='not-json' WHERE id=?1",
                [&expected.id],
            )
            .expect("corrupt row for test");
        let loaded = database.load_courses().expect("load with corruption");
        assert!(loaded.courses.is_empty());
        assert_eq!(loaded.warnings.len(), 1);
        let stored: String = database
            .connection
            .query_row(
                "SELECT weeks FROM courses WHERE id=?1",
                [&expected.id],
                |row| row.get(0),
            )
            .expect("corrupt data remains");
        assert_eq!(stored, "not-json");
    }

    #[test]
    fn add_update_and_delete_survive_file_reopen() {
        let path = temporary_database_path();
        remove_database_files(&path);
        let mut expected = course();
        {
            let database = CourseDatabase::open(&path).expect("create database file");
            database
                .insert_course(&expected)
                .expect("persist inserted course");
        }
        assert!(path.is_file());
        {
            let database = CourseDatabase::open(&path).expect("reopen inserted database");
            assert_eq!(
                database.load_courses().expect("load inserted").courses,
                vec![expected.clone()]
            );
            expected.name = "机械原理".into();
            expected.weekday = 4;
            database.update_course(&expected).expect("persist update");
        }
        {
            let database = CourseDatabase::open(&path).expect("reopen updated database");
            assert_eq!(
                database.load_courses().expect("load updated").courses,
                vec![expected.clone()]
            );
            database
                .delete_course(&expected.id)
                .expect("persist delete");
        }
        {
            let database = CourseDatabase::open(&path).expect("reopen deleted database");
            assert!(database
                .load_courses()
                .expect("load deleted")
                .courses
                .is_empty());
        }
        remove_database_files(&path);
    }

    #[test]
    fn newer_schema_is_rejected_without_modification() {
        let connection = Connection::open_in_memory().expect("open memory database");
        connection
            .pragma_update(None, "user_version", 2)
            .expect("set future version");
        assert!(matches!(
            CourseDatabase::from_connection(connection),
            Err(StorageError::UnsupportedSchema(2))
        ));
    }
}
