use std::{fmt, fs, path::Path, time::Duration};

use rusqlite::{params, Connection, Row};

use crate::models::{validate_period_times, Course, PeriodTime};

const CURRENT_SCHEMA_VERSION: i64 = 2;

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
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version > CURRENT_SCHEMA_VERSION {
            return Err(StorageError::UnsupportedSchema(version));
        }
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
        let version: i64 = self
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version < 2 {
            let transaction = self.connection.transaction()?;
            transaction.execute_batch(
                "CREATE TABLE period_times (
                    period INTEGER PRIMARY KEY NOT NULL CHECK(period BETWEEN 1 AND 30),
                    start_time TEXT NOT NULL CHECK(length(start_time) = 5),
                    end_time TEXT NOT NULL CHECK(length(end_time) = 5)
                );",
            )?;
            transaction.pragma_update(None, "user_version", 2)?;
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

    pub fn load_period_times(&self) -> Result<Option<Vec<PeriodTime>>, StorageError> {
        let mut statement = self
            .connection
            .prepare("SELECT period, start_time, end_time FROM period_times ORDER BY period")?;
        let mut rows = statement.query([])?;
        let mut periods = Vec::new();
        while let Some(row) = rows.next()? {
            periods.push(PeriodTime {
                period: row.get(0)?,
                start_time: row.get(1)?,
                end_time: row.get(2)?,
            });
        }
        if periods.is_empty() {
            return Ok(None);
        }
        validate_period_times(&periods).map_err(StorageError::InvalidData)?;
        Ok(Some(periods))
    }

    pub fn save_period_times(&self, periods: &[PeriodTime]) -> Result<(), StorageError> {
        validate_period_times(periods).map_err(StorageError::InvalidData)?;
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute("DELETE FROM period_times", [])?;
        for period in periods {
            transaction.execute(
                "INSERT INTO period_times (period, start_time, end_time) VALUES (?1, ?2, ?3)",
                (&period.period, &period.start_time, &period.end_time),
            )?;
        }
        transaction.commit()?;
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
        assert_eq!(database.schema_version().expect("schema version"), 2);
        let table_count: i64 = database
            .connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('courses', 'period_times')",
                [],
                |row| row.get(0),
            )
            .expect("courses table");
        assert_eq!(table_count, 2);
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
    fn invalid_rows_are_isolated_while_valid_rows_still_load() {
        let database = database();
        database
            .insert_course(&course())
            .expect("insert valid course");
        database
            .connection
            .execute_batch(
                "PRAGMA ignore_check_constraints = ON;
                 INSERT INTO courses VALUES
                   ('bad-weeks','坏周数',NULL,NULL,1,'08:00','09:00',NULL,NULL,'not-json'),
                   ('bad-weekday','坏星期',NULL,NULL,9,'08:00','09:00',NULL,NULL,'[1]'),
                   ('bad-time','坏时间',NULL,NULL,1,'bad','09:00',NULL,NULL,'[1]'),
                   ('bad-type',X'0102',NULL,NULL,1,'08:00','09:00',NULL,NULL,'[1]'),
                   ('outside-axis','轴外课程',NULL,NULL,1,'06:00','07:00',NULL,NULL,'[1]');
                 PRAGMA ignore_check_constraints = OFF;",
            )
            .expect("insert deliberately invalid rows");
        let loaded = database.load_courses().expect("load mixed records");
        assert_eq!(
            loaded
                .courses
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["outside-axis", "course-id"]
        );
        assert_eq!(loaded.warnings.len(), 4);
        let stored_count: i64 = database
            .connection
            .query_row("SELECT count(*) FROM courses", [], |row| row.get(0))
            .expect("count unchanged records");
        assert_eq!(stored_count, 6);
    }

    #[test]
    fn add_update_and_delete_survive_file_reopen() {
        let path = temporary_database_path();
        remove_database_files(&path);
        let mut expected = course();
        {
            let database = CourseDatabase::open(&path).expect("create database file");
            assert_eq!(database.schema_version().expect("new schema version"), 2);
            assert!(database
                .load_courses()
                .expect("new database is empty")
                .courses
                .is_empty());
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
        let path = temporary_database_path();
        remove_database_files(&path);
        let connection = Connection::open(&path).expect("open future database");
        connection
            .execute_batch(
                "CREATE TABLE sentinel(value TEXT NOT NULL);
                 INSERT INTO sentinel VALUES ('keep-me');
                 PRAGMA user_version = 3;",
            )
            .expect("create future database");
        drop(connection);
        assert!(matches!(
            CourseDatabase::open(&path),
            Err(StorageError::UnsupportedSchema(3))
        ));
        let unchanged = Connection::open(&path).expect("reopen future database");
        let version: i64 = unchanged
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("future version remains");
        let journal_mode: String = unchanged
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .expect("future journal mode remains");
        let value: String = unchanged
            .query_row("SELECT value FROM sentinel", [], |row| row.get(0))
            .expect("future data remains");
        assert_eq!(version, 3);
        assert_eq!(journal_mode, "delete");
        assert_eq!(value, "keep-me");
        drop(unchanged);
        remove_database_files(&path);
    }

    #[test]
    fn period_schedule_round_trips_and_invalid_save_keeps_previous_value() {
        let database = database();
        let periods = vec![
            PeriodTime {
                period: 1,
                start_time: "08:00".into(),
                end_time: "08:30".into(),
            },
            PeriodTime {
                period: 2,
                start_time: "08:45".into(),
                end_time: "09:30".into(),
            },
        ];
        database.save_period_times(&periods).expect("save schedule");
        assert_eq!(
            database.load_period_times().expect("load schedule"),
            Some(periods.clone())
        );
        let invalid = vec![PeriodTime {
            period: 1,
            start_time: "25:00".into(),
            end_time: "26:00".into(),
        }];
        assert!(database.save_period_times(&invalid).is_err());
        assert_eq!(
            database
                .load_period_times()
                .expect("load unchanged schedule"),
            Some(periods)
        );
    }

    #[test]
    fn schema_one_migrates_without_losing_courses() {
        let path = temporary_database_path();
        remove_database_files(&path);
        let connection = Connection::open(&path).expect("open legacy database");
        connection
            .execute_batch(
                "CREATE TABLE courses (
                    id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    teacher TEXT NULL,
                    classroom TEXT NULL,
                    weekday INTEGER NOT NULL,
                    start_time TEXT NOT NULL,
                    end_time TEXT NOT NULL,
                    start_period INTEGER NULL,
                    end_period INTEGER NULL,
                    weeks TEXT NOT NULL
                );
                INSERT INTO courses VALUES ('legacy','旧课程',NULL,NULL,1,'08:00','08:45',NULL,NULL,'[1]');
                PRAGMA user_version = 1;",
            )
            .expect("create schema one database");
        drop(connection);
        let database = CourseDatabase::open(&path).expect("migrate schema one");
        assert_eq!(database.schema_version().expect("migrated version"), 2);
        assert_eq!(
            database
                .load_courses()
                .expect("legacy courses")
                .courses
                .len(),
            1
        );
        let period_table: i64 = database
            .connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='period_times'",
                [],
                |row| row.get(0),
            )
            .expect("period table");
        assert_eq!(period_table, 1);
        remove_database_files(&path);
    }

    #[test]
    fn busy_write_returns_error_after_timeout_without_data_loss() {
        let path = temporary_database_path();
        remove_database_files(&path);
        let database = CourseDatabase::open(&path).expect("create locked database");
        let original = course();
        database.insert_course(&original).expect("insert original");
        let lock = Connection::open(&path).expect("open lock connection");
        lock.execute_batch("BEGIN IMMEDIATE;")
            .expect("hold write lock");
        let mut blocked = course();
        blocked.id = "blocked-course".into();
        let started = std::time::Instant::now();
        let result = database.insert_course(&blocked);
        assert!(result.is_err());
        assert!(started.elapsed() >= Duration::from_secs(2));
        lock.execute_batch("ROLLBACK;").expect("release write lock");
        let loaded = database.load_courses().expect("load after busy failure");
        assert_eq!(loaded.courses, vec![original]);
        drop(lock);
        drop(database);
        remove_database_files(&path);
    }
}
