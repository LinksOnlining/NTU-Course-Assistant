use std::{fmt, fs, path::Path, time::Duration};

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::models::{
    default_widget_settings, merge_widget_settings, validate_period_times,
    validate_reminder_settings, validate_term_config, validate_widget_settings, AcademicTask,
    AcademicTaskStatus, Course, CourseOverride, CourseOverrideKind, Exam, ExamStatus, PeriodTime,
    ReminderSettings, Semester, SemesterStatus, TermConfig, WidgetSettings, WidgetSettingsPatch,
};

const CURRENT_SCHEMA_VERSION: i64 = 5;
const HANDLED_REMINDER_RETENTION_MILLISECONDS: i64 = 400 * 24 * 60 * 60 * 1_000;

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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderConfiguration {
    pub term_config: Option<TermConfig>,
    pub reminder_settings: ReminderSettings,
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

    /// Open an already-initialized database for one bounded operation.
    ///
    /// The application state owns the path, not a process-wide connection or
    /// mutex. Each command gets a short-lived connection so a failed command
    /// cannot leave later commands waiting on a stale guard.
    pub fn connect(path: &Path) -> Result<Self, StorageError> {
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(3))?;
        connection.execute_batch("PRAGMA foreign_keys = ON;")?;
        Ok(Self { connection })
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
        let version: i64 = self
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version < 3 {
            let transaction = self.connection.transaction()?;
            transaction.execute_batch(
                "CREATE TABLE app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);",
            )?;
            transaction.pragma_update(None, "user_version", 3)?;
            transaction.commit()?;
        }
        let version: i64 = self
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version < 4 {
            let transaction = self.connection.transaction()?;
            transaction.execute_batch(
                "CREATE TABLE handled_reminders (
                    occurrence_key TEXT PRIMARY KEY NOT NULL CHECK(length(trim(occurrence_key)) > 0),
                    handled_at_milliseconds INTEGER NOT NULL CHECK(handled_at_milliseconds >= 0)
                );
                CREATE INDEX handled_reminders_handled_at ON handled_reminders(handled_at_milliseconds);",
            )?;
            transaction.pragma_update(None, "user_version", 4)?;
            transaction.commit()?;
        }
        let version: i64 = self
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version < 5 {
            let transaction = self.connection.transaction()?;
            transaction.execute_batch(
                "CREATE TABLE semesters (
                    id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
                    name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
                    first_week_monday TEXT NOT NULL CHECK(length(first_week_monday) = 10),
                    total_weeks INTEGER NOT NULL CHECK(total_weeks BETWEEN 1 AND 30),
                    timezone TEXT NOT NULL CHECK(timezone = 'Asia/Shanghai'),
                    status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ARCHIVED')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE UNIQUE INDEX semesters_one_active ON semesters(status) WHERE status = 'ACTIVE';

                CREATE TABLE course_overrides (
                    id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
                    course_id TEXT NULL REFERENCES courses(id) ON DELETE CASCADE,
                    semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
                    kind TEXT NOT NULL CHECK(kind IN ('CANCEL', 'RESCHEDULE', 'MODIFY', 'MAKEUP')),
                    original_occurrence_key TEXT NULL,
                    original_date TEXT NULL CHECK(original_date IS NULL OR length(original_date) = 10),
                    target_date TEXT NULL CHECK(target_date IS NULL OR length(target_date) = 10),
                    start_period INTEGER NULL CHECK(start_period IS NULL OR start_period BETWEEN 1 AND 30),
                    end_period INTEGER NULL CHECK(end_period IS NULL OR end_period BETWEEN 1 AND 30),
                    start_time TEXT NULL CHECK(start_time IS NULL OR length(start_time) = 5),
                    end_time TEXT NULL CHECK(end_time IS NULL OR length(end_time) = 5),
                    classroom TEXT NULL CHECK(classroom IS NULL OR length(trim(classroom)) BETWEEN 1 AND 100),
                    teacher TEXT NULL CHECK(teacher IS NULL OR length(trim(teacher)) BETWEEN 1 AND 100),
                    note TEXT NULL CHECK(note IS NULL OR length(trim(note)) <= 500),
                    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    CHECK((start_period IS NULL AND end_period IS NULL) OR
                          (start_period IS NOT NULL AND end_period IS NOT NULL AND end_period >= start_period)),
                    CHECK((start_time IS NULL AND end_time IS NULL) OR
                          (start_time IS NOT NULL AND end_time IS NOT NULL))
                );
                CREATE INDEX course_overrides_lookup ON course_overrides(semester_id, original_date, active);
                CREATE INDEX course_overrides_course ON course_overrides(course_id, semester_id, active);

                CREATE TABLE academic_tasks (
                    id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
                    semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
                    course_id TEXT NULL REFERENCES courses(id) ON DELETE SET NULL,
                    type TEXT NOT NULL CHECK(type IN ('ASSIGNMENT', 'LAB_REPORT', 'PRESENTATION', 'PROJECT', 'CUSTOM')),
                    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
                    note TEXT NULL CHECK(note IS NULL OR length(trim(note)) <= 2_000),
                    due_at TEXT NOT NULL,
                    priority INTEGER NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 2),
                    status TEXT NOT NULL CHECK(status IN ('TODO', 'COMPLETED')),
                    completed_at TEXT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX academic_tasks_due ON academic_tasks(semester_id, status, due_at);

                CREATE TABLE exams (
                    id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
                    semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
                    course_id TEXT NULL REFERENCES courses(id) ON DELETE SET NULL,
                    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
                    starts_at TEXT NOT NULL,
                    ends_at TEXT NULL,
                    location TEXT NULL CHECK(location IS NULL OR length(trim(location)) <= 160),
                    seat_info TEXT NULL CHECK(seat_info IS NULL OR length(trim(seat_info)) <= 160),
                    note TEXT NULL CHECK(note IS NULL OR length(trim(note)) <= 2_000),
                    status TEXT NOT NULL CHECK(status IN ('SCHEDULED', 'CANCELLED')),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX exams_start ON exams(semester_id, status, starts_at);

                CREATE TABLE reminder_rules (
                    id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
                    target_type TEXT NOT NULL CHECK(target_type IN ('COURSE', 'TASK', 'EXAM')),
                    target_id TEXT NOT NULL CHECK(length(trim(target_id)) > 0),
                    offsets_minutes TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX reminder_rules_target ON reminder_rules(target_type, target_id, enabled);

                CREATE TABLE reminder_instances (
                    id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
                    rule_id TEXT NOT NULL REFERENCES reminder_rules(id) ON DELETE CASCADE,
                    occurrence_key TEXT NOT NULL CHECK(length(trim(occurrence_key)) > 0),
                    trigger_at_milliseconds INTEGER NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('PENDING', 'SENT', 'CANCELLED')),
                    handled_at_milliseconds INTEGER NULL,
                    UNIQUE(rule_id, occurrence_key)
                );
                CREATE INDEX reminder_instances_pending ON reminder_instances(status, trigger_at_milliseconds);
                PRAGMA user_version = 5;",
            )?;
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

    pub fn import_courses(&self, courses: &[Course]) -> Result<Vec<Course>, StorageError> {
        if courses.is_empty() {
            return Err(StorageError::InvalidData("导入课程不能为空".into()));
        }
        for course in courses {
            course.validate().map_err(StorageError::InvalidData)?;
        }

        let transaction = self.connection.unchecked_transaction()?;
        for course in courses {
            let weeks = serde_json::to_string(&course.weeks)?;
            transaction.execute(
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
        }
        transaction.commit()?;
        Ok(courses.to_vec())
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

    pub fn clear_all_courses(&self) -> Result<(), StorageError> {
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute("DELETE FROM courses", [])?;
        transaction.commit()?;
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

    pub fn load_reminder_configuration(&self) -> Result<ReminderConfiguration, StorageError> {
        let mut warnings = Vec::new();
        let term_config = self.load_setting("term_config")?.and_then(|value| {
            match serde_json::from_str::<TermConfig>(&value) {
                Ok(item) if validate_term_config(&item).is_ok() => Some(item),
                _ => {
                    warnings.push("学期设置无效，已等待重新设置。".into());
                    None
                }
            }
        });
        let reminder_settings = self
            .load_setting("reminder_settings")?
            .and_then(
                |value| match serde_json::from_str::<ReminderSettings>(&value) {
                    Ok(item) if validate_reminder_settings(&item).is_ok() => Some(item),
                    _ => {
                        warnings.push("提醒设置无效，已使用默认关闭状态。".into());
                        None
                    }
                },
            )
            .unwrap_or(ReminderSettings {
                enabled: false,
                advance_minutes: 15,
            });
        Ok(ReminderConfiguration {
            term_config,
            reminder_settings,
            warnings,
        })
    }

    pub fn load_widget_settings(&self) -> Result<WidgetSettings, StorageError> {
        match self.load_setting("widget_settings")? {
            None => Ok(default_widget_settings()),
            Some(value) => match serde_json::from_str::<WidgetSettings>(&value) {
                Ok(settings) if validate_widget_settings(&settings).is_ok() => Ok(settings),
                _ => {
                    eprintln!("Ignoring invalid stored widget settings");
                    Ok(default_widget_settings())
                }
            },
        }
    }

    pub fn save_widget_settings(&self, settings: &WidgetSettings) -> Result<(), StorageError> {
        validate_widget_settings(settings).map_err(StorageError::InvalidData)?;
        self.connection.execute(
            "INSERT INTO app_settings (key, value) VALUES ('widget_settings', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [serde_json::to_string(settings)?],
        )?;
        Ok(())
    }

    pub fn patch_widget_settings(
        &self,
        patch: &WidgetSettingsPatch,
    ) -> Result<WidgetSettings, StorageError> {
        let current = self.load_widget_settings()?;
        let next = merge_widget_settings(&current, patch);
        validate_widget_settings(&next).map_err(StorageError::InvalidData)?;
        self.save_widget_settings(&next)?;
        self.load_widget_settings()
    }

    pub fn save_app_settings(
        &self,
        periods: &[PeriodTime],
        term_config: Option<&TermConfig>,
        reminder_settings: &ReminderSettings,
    ) -> Result<(), StorageError> {
        validate_period_times(periods).map_err(StorageError::InvalidData)?;
        if let Some(config) = term_config {
            validate_term_config(config).map_err(StorageError::InvalidData)?;
        }
        validate_reminder_settings(reminder_settings).map_err(StorageError::InvalidData)?;
        if reminder_settings.enabled && term_config.is_none() {
            return Err(StorageError::InvalidData(
                "启用提醒前请设置第 1 教学周星期一".into(),
            ));
        }
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute("DELETE FROM period_times", [])?;
        for period in periods {
            transaction.execute(
                "INSERT INTO period_times (period, start_time, end_time) VALUES (?1, ?2, ?3)",
                (&period.period, &period.start_time, &period.end_time),
            )?;
        }
        match term_config {
            Some(config) => {
                transaction.execute("INSERT INTO app_settings (key, value) VALUES ('term_config', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [serde_json::to_string(config)?])?;
            }
            None => {
                transaction.execute("DELETE FROM app_settings WHERE key='term_config'", [])?;
            }
        }
        transaction.execute("INSERT INTO app_settings (key, value) VALUES ('reminder_settings', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [serde_json::to_string(reminder_settings)?])?;
        transaction.commit()?;
        Ok(())
    }

    pub fn load_day_count(&self) -> Result<u8, StorageError> {
        Ok(match self.load_setting("day_count")? {
            Some(value) if value == "5" => 5,
            Some(value) if value == "7" => 7,
            _ => 7,
        })
    }

    pub fn save_day_count(&self, day_count: u8) -> Result<u8, StorageError> {
        if day_count != 5 && day_count != 7 {
            return Err(StorageError::InvalidData(
                "课表视图天数必须为 5 或 7".into(),
            ));
        }
        self.connection.execute("INSERT INTO app_settings (key,value) VALUES ('day_count',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [day_count.to_string()])?;
        Ok(day_count)
    }

    pub fn load_handled_reminder_keys(&self) -> Result<Vec<String>, StorageError> {
        let mut statement = self
            .connection
            .prepare("SELECT occurrence_key FROM handled_reminders ORDER BY occurrence_key")?;
        let keys = statement
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(keys)
    }

    pub fn mark_reminder_handled(
        &self,
        occurrence_key: &str,
        handled_at_milliseconds: i64,
    ) -> Result<(), StorageError> {
        if occurrence_key.trim().is_empty() || occurrence_key.trim() != occurrence_key {
            return Err(StorageError::InvalidData("提醒实例 ID 无效".into()));
        }
        if handled_at_milliseconds < 0 {
            return Err(StorageError::InvalidData("提醒处理时间无效".into()));
        }
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            "INSERT INTO handled_reminders (occurrence_key, handled_at_milliseconds)
             VALUES (?1, ?2)
             ON CONFLICT(occurrence_key) DO NOTHING",
            params![occurrence_key, handled_at_milliseconds],
        )?;
        transaction.execute(
            "DELETE FROM handled_reminders WHERE handled_at_milliseconds < ?1",
            [handled_at_milliseconds.saturating_sub(HANDLED_REMINDER_RETENTION_MILLISECONDS)],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn load_semesters(&self) -> Result<Vec<Semester>, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, first_week_monday, total_weeks, timezone, status, created_at, updated_at
             FROM semesters ORDER BY status DESC, first_week_monday DESC, id",
        )?;
        let mut rows = statement.query([])?;
        let mut semesters = Vec::new();
        while let Some(row) = rows.next()? {
            semesters.push(row_to_semester(row)?);
        }
        Ok(semesters)
    }

    pub fn save_semester(&self, semester: &Semester) -> Result<Semester, StorageError> {
        validate_semester(semester)?;
        let transaction = self.connection.unchecked_transaction()?;
        if matches!(semester.status, SemesterStatus::Active) {
            transaction.execute(
                "UPDATE semesters SET status='ARCHIVED', updated_at=?1 WHERE status='ACTIVE' AND id<>?2",
                params![&semester.updated_at, &semester.id],
            )?;
        }
        transaction.execute(
            "INSERT INTO semesters (id, name, first_week_monday, total_weeks, timezone, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, first_week_monday=excluded.first_week_monday,
               total_weeks=excluded.total_weeks, timezone=excluded.timezone, status=excluded.status,
               updated_at=excluded.updated_at",
            params![
                &semester.id,
                &semester.name,
                &semester.first_week_monday,
                semester.total_weeks,
                &semester.timezone,
                semester_status_value(&semester.status),
                &semester.created_at,
                &semester.updated_at,
            ],
        )?;
        transaction.commit()?;
        self.connection
            .query_row(
                "SELECT id, name, first_week_monday, total_weeks, timezone, status, created_at, updated_at FROM semesters WHERE id=?1",
                [&semester.id],
                row_to_semester,
            )
            .map_err(StorageError::from)
    }

    pub fn archive_semester(&self, id: &str, updated_at: &str) -> Result<(), StorageError> {
        if id.trim().is_empty() {
            return Err(StorageError::InvalidData("学期 ID 无效".into()));
        }
        if self.connection.execute(
            "UPDATE semesters SET status='ARCHIVED', updated_at=?2 WHERE id=?1",
            params![id, updated_at],
        )? == 0
        {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn load_course_overrides(
        &self,
        semester_id: &str,
    ) -> Result<Vec<CourseOverride>, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT id, course_id, semester_id, kind, original_occurrence_key, original_date,
                    target_date, start_period, end_period, start_time, end_time, classroom, teacher,
                    note, active, created_at, updated_at
             FROM course_overrides WHERE semester_id=?1 ORDER BY original_date, created_at, id",
        )?;
        let mut rows = statement.query([semester_id])?;
        let mut overrides = Vec::new();
        while let Some(row) = rows.next()? {
            overrides.push(row_to_course_override(row)?);
        }
        Ok(overrides)
    }

    pub fn save_course_override(
        &self,
        value: &CourseOverride,
    ) -> Result<CourseOverride, StorageError> {
        validate_course_override(value)?;
        self.connection.execute(
            "INSERT INTO course_overrides
             (id, course_id, semester_id, kind, original_occurrence_key, original_date, target_date,
              start_period, end_period, start_time, end_time, classroom, teacher, note, active, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
             ON CONFLICT(id) DO UPDATE SET course_id=excluded.course_id, semester_id=excluded.semester_id,
               kind=excluded.kind, original_occurrence_key=excluded.original_occurrence_key,
               original_date=excluded.original_date, target_date=excluded.target_date,
               start_period=excluded.start_period, end_period=excluded.end_period,
               start_time=excluded.start_time, end_time=excluded.end_time, classroom=excluded.classroom,
               teacher=excluded.teacher, note=excluded.note, active=excluded.active, updated_at=excluded.updated_at",
            params![
                &value.id,
                &value.course_id,
                &value.semester_id,
                course_override_kind_value(&value.kind),
                &value.original_occurrence_key,
                &value.original_date,
                &value.target_date,
                value.start_period,
                value.end_period,
                &value.start_time,
                &value.end_time,
                &value.classroom,
                &value.teacher,
                &value.note,
                value.active,
                &value.created_at,
                &value.updated_at,
            ],
        )?;
        self.connection
            .query_row(
                "SELECT id, course_id, semester_id, kind, original_occurrence_key, original_date,
                        target_date, start_period, end_period, start_time, end_time, classroom, teacher,
                        note, active, created_at, updated_at FROM course_overrides WHERE id=?1",
                [&value.id],
                row_to_course_override,
            )
            .map_err(StorageError::from)
    }

    pub fn revoke_course_override(&self, id: &str, updated_at: &str) -> Result<(), StorageError> {
        if self.connection.execute(
            "UPDATE course_overrides SET active=0, updated_at=?2 WHERE id=?1",
            params![id, updated_at],
        )? == 0
        {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn load_academic_tasks(
        &self,
        semester_id: &str,
    ) -> Result<Vec<AcademicTask>, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT id, semester_id, course_id, type, title, note, due_at, priority, status,
                    completed_at, created_at, updated_at
             FROM academic_tasks WHERE semester_id=?1 ORDER BY status, due_at, priority DESC, id",
        )?;
        let mut rows = statement.query([semester_id])?;
        let mut tasks = Vec::new();
        while let Some(row) = rows.next()? {
            tasks.push(row_to_academic_task(row)?);
        }
        Ok(tasks)
    }

    pub fn save_academic_task(&self, task: &AcademicTask) -> Result<AcademicTask, StorageError> {
        validate_academic_task(task)?;
        self.connection.execute(
            "INSERT INTO academic_tasks
             (id, semester_id, course_id, type, title, note, due_at, priority, status, completed_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET semester_id=excluded.semester_id, course_id=excluded.course_id,
               type=excluded.type, title=excluded.title, note=excluded.note, due_at=excluded.due_at,
               priority=excluded.priority, status=excluded.status, completed_at=excluded.completed_at,
               updated_at=excluded.updated_at",
            params![
                &task.id,
                &task.semester_id,
                &task.course_id,
                academic_task_type_value(&task.task_type),
                &task.title,
                &task.note,
                &task.due_at,
                task.priority,
                academic_task_status_value(&task.status),
                &task.completed_at,
                &task.created_at,
                &task.updated_at,
            ],
        )?;
        self.connection
            .query_row(
                "SELECT id, semester_id, course_id, type, title, note, due_at, priority, status,
                        completed_at, created_at, updated_at FROM academic_tasks WHERE id=?1",
                [&task.id],
                row_to_academic_task,
            )
            .map_err(StorageError::from)
    }

    pub fn delete_academic_task(&self, id: &str) -> Result<(), StorageError> {
        if self
            .connection
            .execute("DELETE FROM academic_tasks WHERE id=?1", [id])?
            == 0
        {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn load_exams(&self, semester_id: &str) -> Result<Vec<Exam>, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT id, semester_id, course_id, title, starts_at, ends_at, location, seat_info,
                    note, status, created_at, updated_at
             FROM exams WHERE semester_id=?1 ORDER BY status, starts_at, id",
        )?;
        let mut rows = statement.query([semester_id])?;
        let mut exams = Vec::new();
        while let Some(row) = rows.next()? {
            exams.push(row_to_exam(row)?);
        }
        Ok(exams)
    }

    pub fn save_exam(&self, exam: &Exam) -> Result<Exam, StorageError> {
        validate_exam(exam)?;
        self.connection.execute(
            "INSERT INTO exams
             (id, semester_id, course_id, title, starts_at, ends_at, location, seat_info, note, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET semester_id=excluded.semester_id, course_id=excluded.course_id,
               title=excluded.title, starts_at=excluded.starts_at, ends_at=excluded.ends_at,
               location=excluded.location, seat_info=excluded.seat_info, note=excluded.note,
               status=excluded.status, updated_at=excluded.updated_at",
            params![
                &exam.id,
                &exam.semester_id,
                &exam.course_id,
                &exam.title,
                &exam.starts_at,
                &exam.ends_at,
                &exam.location,
                &exam.seat_info,
                &exam.note,
                exam_status_value(&exam.status),
                &exam.created_at,
                &exam.updated_at,
            ],
        )?;
        self.connection
            .query_row(
                "SELECT id, semester_id, course_id, title, starts_at, ends_at, location, seat_info,
                        note, status, created_at, updated_at FROM exams WHERE id=?1",
                [&exam.id],
                row_to_exam,
            )
            .map_err(StorageError::from)
    }

    pub fn delete_exam(&self, id: &str) -> Result<(), StorageError> {
        if self
            .connection
            .execute("DELETE FROM exams WHERE id=?1", [id])?
            == 0
        {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    fn load_setting(&self, key: &str) -> Result<Option<String>, StorageError> {
        Ok(self
            .connection
            .query_row(
                "SELECT value FROM app_settings WHERE key=?1",
                [key],
                |row| row.get(0),
            )
            .optional()?)
    }
}

fn validate_semester(value: &Semester) -> Result<(), StorageError> {
    if value.id.trim().is_empty() || value.name.trim().is_empty() || value.name.len() > 80 {
        return Err(StorageError::InvalidData("学期信息无效".into()));
    }
    validate_term_config(&TermConfig {
        first_week_monday: value.first_week_monday.clone(),
        total_weeks: value.total_weeks,
        timezone: value.timezone.clone(),
    })
    .map_err(StorageError::InvalidData)
}

fn validate_course_override(value: &CourseOverride) -> Result<(), StorageError> {
    if value.id.trim().is_empty() || value.semester_id.trim().is_empty() {
        return Err(StorageError::InvalidData("课表变更 ID 无效".into()));
    }
    if value.kind != CourseOverrideKind::Makeup && value.course_id.is_none() {
        return Err(StorageError::InvalidData("课表变更必须关联课程".into()));
    }
    if let (Some(start), Some(end)) = (value.start_period, value.end_period) {
        if start == 0 || end < start || end > 30 {
            return Err(StorageError::InvalidData("课表变更节次无效".into()));
        }
    } else if value.start_period.is_some() || value.end_period.is_some() {
        return Err(StorageError::InvalidData("课表变更节次必须成对填写".into()));
    }
    Ok(())
}

fn validate_academic_task(value: &AcademicTask) -> Result<(), StorageError> {
    if value.id.trim().is_empty()
        || value.semester_id.trim().is_empty()
        || value.title.trim().is_empty()
    {
        return Err(StorageError::InvalidData("学习事项信息无效".into()));
    }
    if value.priority > 2 {
        return Err(StorageError::InvalidData("学习事项优先级无效".into()));
    }
    Ok(())
}

fn validate_exam(value: &Exam) -> Result<(), StorageError> {
    if value.id.trim().is_empty()
        || value.semester_id.trim().is_empty()
        || value.title.trim().is_empty()
    {
        return Err(StorageError::InvalidData("考试信息无效".into()));
    }
    Ok(())
}

fn semester_status_value(value: &SemesterStatus) -> &'static str {
    match value {
        SemesterStatus::Active => "ACTIVE",
        SemesterStatus::Archived => "ARCHIVED",
    }
}

fn course_override_kind_value(value: &CourseOverrideKind) -> &'static str {
    match value {
        CourseOverrideKind::Cancel => "CANCEL",
        CourseOverrideKind::Reschedule => "RESCHEDULE",
        CourseOverrideKind::Modify => "MODIFY",
        CourseOverrideKind::Makeup => "MAKEUP",
    }
}

fn academic_task_type_value(value: &crate::models::AcademicTaskType) -> &'static str {
    match value {
        crate::models::AcademicTaskType::Assignment => "ASSIGNMENT",
        crate::models::AcademicTaskType::LabReport => "LAB_REPORT",
        crate::models::AcademicTaskType::Presentation => "PRESENTATION",
        crate::models::AcademicTaskType::Project => "PROJECT",
        crate::models::AcademicTaskType::Custom => "CUSTOM",
    }
}

fn academic_task_status_value(value: &AcademicTaskStatus) -> &'static str {
    match value {
        AcademicTaskStatus::Todo => "TODO",
        AcademicTaskStatus::Completed => "COMPLETED",
    }
}

fn exam_status_value(value: &ExamStatus) -> &'static str {
    match value {
        ExamStatus::Scheduled => "SCHEDULED",
        ExamStatus::Cancelled => "CANCELLED",
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

fn row_to_semester(row: &Row<'_>) -> rusqlite::Result<Semester> {
    let status: String = row.get(5)?;
    let status = match status.as_str() {
        "ACTIVE" => SemesterStatus::Active,
        "ARCHIVED" => SemesterStatus::Archived,
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    Ok(Semester {
        id: row.get(0)?,
        name: row.get(1)?,
        first_week_monday: row.get(2)?,
        total_weeks: row.get(3)?,
        timezone: row.get(4)?,
        status,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn row_to_course_override(row: &Row<'_>) -> rusqlite::Result<CourseOverride> {
    let kind: String = row.get(3)?;
    let kind = match kind.as_str() {
        "CANCEL" => CourseOverrideKind::Cancel,
        "RESCHEDULE" => CourseOverrideKind::Reschedule,
        "MODIFY" => CourseOverrideKind::Modify,
        "MAKEUP" => CourseOverrideKind::Makeup,
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    Ok(CourseOverride {
        id: row.get(0)?,
        course_id: row.get(1)?,
        semester_id: row.get(2)?,
        kind,
        original_occurrence_key: row.get(4)?,
        original_date: row.get(5)?,
        target_date: row.get(6)?,
        start_period: row.get(7)?,
        end_period: row.get(8)?,
        start_time: row.get(9)?,
        end_time: row.get(10)?,
        classroom: row.get(11)?,
        teacher: row.get(12)?,
        note: row.get(13)?,
        active: row.get::<_, i64>(14)? != 0,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
    })
}

fn row_to_academic_task(row: &Row<'_>) -> rusqlite::Result<AcademicTask> {
    let task_type: String = row.get(3)?;
    let task_type = match task_type.as_str() {
        "ASSIGNMENT" => crate::models::AcademicTaskType::Assignment,
        "LAB_REPORT" => crate::models::AcademicTaskType::LabReport,
        "PRESENTATION" => crate::models::AcademicTaskType::Presentation,
        "PROJECT" => crate::models::AcademicTaskType::Project,
        "CUSTOM" => crate::models::AcademicTaskType::Custom,
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    let status: String = row.get(8)?;
    let status = match status.as_str() {
        "TODO" => AcademicTaskStatus::Todo,
        "COMPLETED" => AcademicTaskStatus::Completed,
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    Ok(AcademicTask {
        id: row.get(0)?,
        semester_id: row.get(1)?,
        course_id: row.get(2)?,
        task_type,
        title: row.get(4)?,
        note: row.get(5)?,
        due_at: row.get(6)?,
        priority: row.get(7)?,
        status,
        completed_at: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn row_to_exam(row: &Row<'_>) -> rusqlite::Result<Exam> {
    let status: String = row.get(9)?;
    let status = match status.as_str() {
        "SCHEDULED" => ExamStatus::Scheduled,
        "CANCELLED" => ExamStatus::Cancelled,
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    Ok(Exam {
        id: row.get(0)?,
        semester_id: row.get(1)?,
        course_id: row.get(2)?,
        title: row.get(3)?,
        starts_at: row.get(4)?,
        ends_at: row.get(5)?,
        location: row.get(6)?,
        seat_info: row.get(7)?,
        note: row.get(8)?,
        status,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
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
    fn schema_four_database_migrates_to_academic_hub_without_losing_data() {
        let path = temporary_database_path();
        remove_database_files(&path);
        let expected = course();
        {
            let connection = Connection::open(&path).expect("open schema four database");
            connection
                .execute_batch(
                    "CREATE TABLE courses (
                        id TEXT PRIMARY KEY NOT NULL,
                        name TEXT NOT NULL,
                        teacher TEXT,
                        classroom TEXT,
                        weekday INTEGER NOT NULL,
                        start_time TEXT NOT NULL,
                        end_time TEXT NOT NULL,
                        start_period INTEGER,
                        end_period INTEGER,
                        weeks TEXT NOT NULL
                    );
                    CREATE TABLE period_times (
                        period INTEGER PRIMARY KEY NOT NULL,
                        start_time TEXT NOT NULL,
                        end_time TEXT NOT NULL
                    );
                    CREATE TABLE app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
                    CREATE TABLE handled_reminders (
                        occurrence_key TEXT PRIMARY KEY NOT NULL,
                        handled_at_milliseconds INTEGER NOT NULL
                    );
                    PRAGMA user_version = 4;",
                )
                .expect("create schema four tables");
            connection
                .execute(
                    "INSERT INTO courses
                     (id, name, teacher, classroom, weekday, start_time, end_time,
                      start_period, end_period, weeks)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        &expected.id,
                        &expected.name,
                        &expected.teacher,
                        &expected.classroom,
                        expected.weekday,
                        &expected.start_time,
                        &expected.end_time,
                        expected.start_period,
                        expected.end_period,
                        serde_json::to_string(&expected.weeks).expect("serialize weeks"),
                    ],
                )
                .expect("insert legacy course");
        }
        let migrated = CourseDatabase::open(&path).expect("migrate schema four database");
        assert_eq!(migrated.schema_version().expect("schema version"), 5);
        assert_eq!(
            migrated.load_courses().expect("load legacy course").courses,
            vec![expected]
        );
        let academic_table_count: i64 = migrated
            .connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN
                 ('semesters', 'course_overrides', 'academic_tasks', 'exams', 'reminder_rules', 'reminder_instances')",
                [],
                |row| row.get(0),
            )
            .expect("academic tables");
        assert_eq!(academic_table_count, 6);
        drop(migrated);
        remove_database_files(&path);
    }

    #[test]
    fn empty_database_runs_versioned_migration() {
        let database = database();
        assert_eq!(database.schema_version().expect("schema version"), 5);
        let table_count: i64 = database
            .connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('courses', 'period_times', 'app_settings', 'handled_reminders')",
                [],
                |row| row.get(0),
            )
            .expect("courses table");
        assert_eq!(table_count, 4);
        let academic_table_count: i64 = database
            .connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('semesters', 'course_overrides', 'academic_tasks', 'exams', 'reminder_rules', 'reminder_instances')",
                [],
                |row| row.get(0),
            )
            .expect("academic tables");
        assert_eq!(academic_table_count, 6);
    }

    #[test]
    fn handled_reminders_persist_once_and_expire_after_the_retention_window() {
        let database = database();
        database
            .mark_reminder_handled("course-id:2026-09-09:14:00", 1_000)
            .expect("mark handled");
        database
            .mark_reminder_handled("course-id:2026-09-09:14:00", 2_000)
            .expect("mark duplicate handled");
        assert_eq!(
            database
                .load_handled_reminder_keys()
                .expect("load handled keys"),
            vec!["course-id:2026-09-09:14:00"]
        );
        database
            .mark_reminder_handled(
                "course-id:2027-10-14:14:00",
                HANDLED_REMINDER_RETENTION_MILLISECONDS + 1_001,
            )
            .expect("mark later handled");
        assert_eq!(
            database
                .load_handled_reminder_keys()
                .expect("load retained keys"),
            vec!["course-id:2027-10-14:14:00"]
        );
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
    fn course_batch_import_commits_and_returns_every_course() {
        let database = database();
        let first = course();
        let mut second = course();
        second.id = "course-id-2".into();
        second.name = "机械原理".into();
        second.weekday = 4;
        let expected = vec![first, second];
        let inserted = database
            .import_courses(&expected)
            .expect("import valid course batch");
        assert_eq!(inserted, expected);
        let loaded = database.load_courses().expect("load imported courses");
        assert_eq!(loaded.courses.len(), 2);
        assert!(expected
            .iter()
            .all(|course| loaded.courses.contains(course)));
    }

    #[test]
    fn empty_course_batch_is_rejected_without_writes() {
        let database = database();
        assert!(matches!(
            database.import_courses(&[]),
            Err(StorageError::InvalidData(_))
        ));
        assert!(database
            .load_courses()
            .expect("load after empty batch")
            .courses
            .is_empty());
    }

    #[test]
    fn invalid_course_in_batch_leaves_database_unchanged() {
        let database = database();
        let first = course();
        let mut invalid = course();
        invalid.id = "invalid-course".into();
        invalid.weekday = 9;
        assert!(database.import_courses(&[first, invalid]).is_err());
        assert!(database
            .load_courses()
            .expect("load after invalid batch")
            .courses
            .is_empty());
    }

    #[test]
    fn duplicate_constraint_rolls_back_entire_course_batch() {
        let database = database();
        let first = course();
        let duplicate = first.clone();
        assert!(database.import_courses(&[first, duplicate]).is_err());
        assert!(database
            .load_courses()
            .expect("load after rolled back batch")
            .courses
            .is_empty());
    }

    #[test]
    fn imported_batch_survives_database_close_and_reopen_exactly() {
        let path = temporary_database_path();
        remove_database_files(&path);
        let expected = vec![course(), {
            let mut second = course();
            second.id = "reopen-course".into();
            second.weekday = 5;
            second
        }];
        {
            let database = CourseDatabase::open(&path).expect("open import database");
            database
                .import_courses(&expected)
                .expect("import before close");
        }
        let reopened = CourseDatabase::open(&path).expect("reopen import database");
        let loaded = reopened.load_courses().expect("load after reopen").courses;
        assert_eq!(loaded.len(), expected.len());
        assert!(expected.iter().all(|course| loaded.contains(course)));
        drop(reopened);
        remove_database_files(&path);
    }

    #[test]
    fn period_based_course_indexes_survive_import_reopen_and_period_changes() {
        let path = temporary_database_path();
        remove_database_files(&path);
        let mut imported = course();
        imported.start_period = Some(1);
        imported.end_period = Some(2);
        imported.start_time = "08:00".into();
        imported.end_time = "09:35".into();
        let original = imported.clone();
        let first_schedule = vec![
            PeriodTime {
                period: 1,
                start_time: "08:00".into(),
                end_time: "08:45".into(),
            },
            PeriodTime {
                period: 2,
                start_time: "08:50".into(),
                end_time: "09:35".into(),
            },
        ];
        let changed_schedule = vec![
            PeriodTime {
                period: 1,
                start_time: "07:50".into(),
                end_time: "08:35".into(),
            },
            PeriodTime {
                period: 2,
                start_time: "08:45".into(),
                end_time: "09:30".into(),
            },
        ];

        {
            let database = CourseDatabase::open(&path).expect("open isolated import database");
            database
                .save_period_times(&first_schedule)
                .expect("save first period schedule");
            database
                .import_courses(&[imported])
                .expect("import period-based course");
            database
                .save_period_times(&changed_schedule)
                .expect("change period schedule");
            assert_eq!(
                database
                    .load_courses()
                    .expect("read course after schedule change")
                    .courses,
                vec![original.clone()],
                "changing periods must not rewrite the stored course clock snapshot or indexes"
            );
        }

        let reopened = CourseDatabase::open(&path).expect("reopen isolated import database");
        assert_eq!(
            reopened
                .load_courses()
                .expect("load imported course")
                .courses,
            vec![original],
            "SQLite must retain period indexes across import and reopen"
        );
        assert_eq!(
            reopened
                .load_period_times()
                .expect("load changed period schedule"),
            Some(changed_schedule)
        );
        drop(reopened);
        remove_database_files(&path);
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
    fn clearing_courses_keeps_all_non_course_settings() {
        let database = database();
        let saved_course = course();
        database
            .insert_course(&saved_course)
            .expect("insert course");
        let periods = vec![PeriodTime {
            period: 1,
            start_time: "08:00".into(),
            end_time: "08:45".into(),
        }];
        database.save_period_times(&periods).expect("save periods");
        let term = TermConfig {
            first_week_monday: "2026-09-07".into(),
            total_weeks: 18,
            timezone: "Asia/Shanghai".into(),
        };
        let reminders = ReminderSettings {
            enabled: true,
            advance_minutes: 15,
        };
        database
            .save_app_settings(&periods, Some(&term), &reminders)
            .expect("save settings");
        let widget = WidgetSettings {
            enabled: true,
            display_mode: "week".into(),
            locked: true,
            x: Some(120),
            y: Some(80),
            width: Some(380),
            height: Some(420),
        };
        database
            .patch_widget_settings(&WidgetSettingsPatch {
                enabled: Some(widget.enabled),
                display_mode: Some(widget.display_mode.clone()),
                locked: Some(widget.locked),
                x: widget.x,
                y: widget.y,
                width: widget.width,
                height: widget.height,
            })
            .expect("save widget");
        database.save_day_count(5).expect("save day count");

        database.clear_all_courses().expect("clear courses");

        assert!(database
            .load_courses()
            .expect("load courses")
            .courses
            .is_empty());
        assert_eq!(
            database.load_period_times().expect("load periods"),
            Some(periods)
        );
        let configuration = database
            .load_reminder_configuration()
            .expect("load reminders");
        assert_eq!(configuration.term_config, Some(term));
        assert_eq!(configuration.reminder_settings, reminders);
        assert_eq!(
            database.load_widget_settings().expect("load widget"),
            widget
        );
        assert_eq!(database.load_day_count().expect("load day count"), 5);
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
            assert_eq!(database.schema_version().expect("new schema version"), 5);
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
                 PRAGMA user_version = 6;",
            )
            .expect("create future database");
        drop(connection);
        assert!(matches!(
            CourseDatabase::open(&path),
            Err(StorageError::UnsupportedSchema(6))
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
        assert_eq!(version, 6);
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
    fn repeated_fresh_connections_save_new_and_existing_periods_without_stale_state() {
        let path = temporary_database_path();
        remove_database_files(&path);
        {
            let database = CourseDatabase::open(&path).expect("create schedule database");
            database
                .save_period_times(&[
                    PeriodTime {
                        period: 1,
                        start_time: "08:00".into(),
                        end_time: "08:45".into(),
                    },
                    PeriodTime {
                        period: 2,
                        start_time: "08:50".into(),
                        end_time: "09:35".into(),
                    },
                ])
                .expect("save initial schedule");
        }

        let expected = vec![
            PeriodTime {
                period: 1,
                start_time: "08:10".into(),
                end_time: "08:55".into(),
            },
            PeriodTime {
                period: 2,
                start_time: "09:00".into(),
                end_time: "09:45".into(),
            },
            PeriodTime {
                period: 3,
                start_time: "09:50".into(),
                end_time: "10:35".into(),
            },
        ];
        for _ in 0..4 {
            let database = CourseDatabase::connect(&path).expect("connect schedule database");
            database
                .save_period_times(&expected)
                .expect("replace schedule using a fresh connection");
            assert_eq!(
                database.load_period_times().expect("read schedule"),
                Some(expected.clone())
            );
        }
        remove_database_files(&path);
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
        assert_eq!(database.schema_version().expect("migrated version"), 5);
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
    fn schema_two_migrates_to_settings_without_changing_courses_or_periods() {
        let path = temporary_database_path();
        remove_database_files(&path);
        let connection = Connection::open(&path).expect("open schema two database");
        connection
            .execute_batch(
                "CREATE TABLE courses (
                    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, teacher TEXT NULL,
                    classroom TEXT NULL, weekday INTEGER NOT NULL, start_time TEXT NOT NULL,
                    end_time TEXT NOT NULL, start_period INTEGER NULL, end_period INTEGER NULL,
                    weeks TEXT NOT NULL
                );
                CREATE TABLE period_times (period INTEGER PRIMARY KEY NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL);
                INSERT INTO courses VALUES ('legacy','旧课程',NULL,NULL,1,'08:00','08:45',NULL,NULL,'[1]');
                INSERT INTO period_times VALUES (1,'08:00','08:45');
                PRAGMA user_version = 2;",
            )
            .expect("create schema two database");
        drop(connection);
        let database = CourseDatabase::open(&path).expect("migrate schema two");
        assert_eq!(database.schema_version().expect("schema version"), 5);
        assert_eq!(database.load_courses().expect("courses").courses.len(), 1);
        assert_eq!(
            database
                .load_period_times()
                .expect("periods")
                .expect("periods")
                .len(),
            1
        );
        let settings_table: i64 = database
            .connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='app_settings'",
                [],
                |row| row.get(0),
            )
            .expect("settings table");
        assert_eq!(settings_table, 1);
        remove_database_files(&path);
    }

    #[test]
    fn schema_three_migrates_without_changing_courses_periods_or_settings() {
        let path = temporary_database_path();
        remove_database_files(&path);
        let connection = Connection::open(&path).expect("open schema three database");
        connection
            .execute_batch(
                "CREATE TABLE courses (
                    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, teacher TEXT NULL,
                    classroom TEXT NULL, weekday INTEGER NOT NULL, start_time TEXT NOT NULL,
                    end_time TEXT NOT NULL, start_period INTEGER NULL, end_period INTEGER NULL,
                    weeks TEXT NOT NULL
                );
                CREATE TABLE period_times (period INTEGER PRIMARY KEY NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL);
                CREATE TABLE app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
                INSERT INTO courses VALUES ('legacy','旧课程',NULL,NULL,1,'08:00','08:45',NULL,NULL,'[1]');
                INSERT INTO period_times VALUES (1,'08:00','08:45');
                INSERT INTO app_settings VALUES ('reminder_settings','{\"enabled\":false,\"advanceMinutes\":15}');
                PRAGMA user_version = 3;",
            )
            .expect("create schema three database");
        drop(connection);
        let database = CourseDatabase::open(&path).expect("migrate schema three");
        assert_eq!(database.schema_version().expect("schema version"), 5);
        assert_eq!(database.load_courses().expect("courses").courses.len(), 1);
        assert_eq!(
            database
                .load_period_times()
                .expect("periods")
                .expect("periods")
                .len(),
            1
        );
        assert!(
            !database
                .load_reminder_configuration()
                .expect("settings")
                .reminder_settings
                .enabled
        );
        assert!(database
            .load_handled_reminder_keys()
            .expect("handled state")
            .is_empty());
        drop(database);
        remove_database_files(&path);
    }

    #[test]
    fn app_settings_round_trip_and_invalid_save_keeps_previous_values() {
        let database = database();
        let periods = vec![PeriodTime {
            period: 1,
            start_time: "08:00".into(),
            end_time: "08:45".into(),
        }];
        let term = TermConfig {
            first_week_monday: "2026-09-07".into(),
            total_weeks: 18,
            timezone: "Asia/Shanghai".into(),
        };
        let settings = ReminderSettings {
            enabled: true,
            advance_minutes: 15,
        };
        database
            .save_app_settings(&periods, Some(&term), &settings)
            .expect("save settings");
        let loaded = database
            .load_reminder_configuration()
            .expect("load settings");
        assert_eq!(loaded.term_config, Some(term.clone()));
        assert_eq!(loaded.reminder_settings, settings);
        assert!(database
            .save_app_settings(&periods, None, &settings)
            .is_err());
        assert_eq!(
            database
                .load_reminder_configuration()
                .expect("unchanged settings")
                .term_config,
            Some(term)
        );
    }

    #[test]
    fn widget_settings_round_trip_without_changing_reminder_configuration() {
        let database = database();
        let before = database
            .load_reminder_configuration()
            .expect("load reminder settings");
        let settings = WidgetSettings {
            enabled: true,
            display_mode: "week".into(),
            locked: true,
            x: Some(120),
            y: Some(80),
            width: Some(400),
            height: Some(500),
        };
        database
            .save_widget_settings(&settings)
            .expect("save widget settings");
        assert_eq!(
            database
                .load_widget_settings()
                .expect("load widget settings"),
            settings
        );
        assert_eq!(
            database
                .load_reminder_configuration()
                .expect("unchanged reminders")
                .term_config,
            before.term_config
        );
        assert_eq!(database.schema_version().expect("schema version"), 5);
    }

    #[test]
    fn widget_patches_merge_geometry_and_preferences_without_losing_fields() {
        let database = database();
        let initial = WidgetSettings {
            enabled: true,
            display_mode: "today".into(),
            locked: false,
            x: Some(10),
            y: Some(20),
            width: Some(360),
            height: Some(430),
        };
        database
            .save_widget_settings(&initial)
            .expect("seed widget");
        let moved = database
            .patch_widget_settings(&WidgetSettingsPatch {
                enabled: None,
                display_mode: None,
                locked: None,
                x: Some(80),
                y: Some(90),
                width: None,
                height: None,
            })
            .expect("save geometry");
        let locked = database
            .patch_widget_settings(&WidgetSettingsPatch {
                enabled: None,
                display_mode: None,
                locked: Some(true),
                x: None,
                y: None,
                width: None,
                height: None,
            })
            .expect("save preference");
        assert_eq!(moved.x, Some(80));
        assert_eq!(locked.x, Some(80));
        assert_eq!(locked.y, Some(90));
        assert!(locked.locked);
    }

    #[test]
    fn repeated_widget_geometry_and_preference_patches_keep_the_latest_field_values() {
        let database = database();
        for index in 0..20 {
            database
                .patch_widget_settings(&WidgetSettingsPatch {
                    enabled: Some(index % 2 == 0),
                    display_mode: Some(if index % 2 == 0 { "today" } else { "week" }.into()),
                    locked: Some(index % 3 == 0),
                    x: Some(index * 10),
                    y: Some(index * 20),
                    width: Some(360 + index as u32),
                    height: Some(430 + index as u32),
                })
                .expect("patch widget settings");
        }
        assert_eq!(
            database
                .load_widget_settings()
                .expect("read latest widget settings"),
            WidgetSettings {
                enabled: false,
                display_mode: "week".into(),
                locked: false,
                x: Some(190),
                y: Some(380),
                width: Some(379),
                height: Some(449),
            }
        );
    }

    #[test]
    fn malformed_widget_settings_fall_back_without_mutating_storage() {
        let database = database();
        database
            .connection
            .execute(
                "INSERT INTO app_settings (key, value) VALUES ('widget_settings', '{\"enabled\":true,\"displayMode\":\"bad\"}')",
                [],
            )
            .expect("store malformed widget settings");
        assert_eq!(
            database.load_widget_settings().expect("fallback settings"),
            default_widget_settings()
        );
        let raw: String = database
            .connection
            .query_row(
                "SELECT value FROM app_settings WHERE key='widget_settings'",
                [],
                |row| row.get(0),
            )
            .expect("original setting remains");
        assert!(raw.contains("bad"));
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

    #[test]
    fn academic_records_round_trip_without_touching_legacy_courses() {
        let database = database();
        let timestamp = "2026-09-01T00:00:00+08:00".to_string();
        let semester = Semester {
            id: "semester-1".into(),
            name: "2026 秋季学期".into(),
            first_week_monday: "2026-09-07".into(),
            total_weeks: 16,
            timezone: "Asia/Shanghai".into(),
            status: SemesterStatus::Active,
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
        };
        database.save_semester(&semester).expect("save semester");
        let original_course = course();
        database
            .insert_course(&original_course)
            .expect("save course");
        let override_value = CourseOverride {
            id: "override-1".into(),
            course_id: Some(original_course.id.clone()),
            semester_id: semester.id.clone(),
            kind: CourseOverrideKind::Cancel,
            original_occurrence_key: None,
            original_date: Some("2026-09-15".into()),
            target_date: None,
            start_period: None,
            end_period: None,
            start_time: None,
            end_time: None,
            classroom: None,
            teacher: None,
            note: Some("临时停课".into()),
            active: true,
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
        };
        database
            .save_course_override(&override_value)
            .expect("save override");
        let task = AcademicTask {
            id: "task-1".into(),
            semester_id: semester.id.clone(),
            course_id: Some(original_course.id.clone()),
            task_type: crate::models::AcademicTaskType::Assignment,
            title: "完成练习".into(),
            note: None,
            due_at: "2026-09-20T18:00:00+08:00".into(),
            priority: 1,
            status: AcademicTaskStatus::Todo,
            completed_at: None,
            created_at: timestamp.clone(),
            updated_at: timestamp.clone(),
        };
        database.save_academic_task(&task).expect("save task");
        let exam = Exam {
            id: "exam-1".into(),
            semester_id: semester.id.clone(),
            course_id: None,
            title: "期末考试".into(),
            starts_at: "2026-12-20T14:00:00+08:00".into(),
            ends_at: None,
            location: Some("B203".into()),
            seat_info: None,
            note: None,
            status: ExamStatus::Scheduled,
            created_at: timestamp.clone(),
            updated_at: timestamp,
        };
        database.save_exam(&exam).expect("save exam");
        assert_eq!(database.load_semesters().expect("semesters").len(), 1);
        assert_eq!(
            database
                .load_course_overrides(&semester.id)
                .expect("overrides")
                .len(),
            1
        );
        assert_eq!(
            database
                .load_academic_tasks(&semester.id)
                .expect("tasks")
                .len(),
            1
        );
        assert_eq!(database.load_exams(&semester.id).expect("exams").len(), 1);
        assert_eq!(
            database.load_courses().expect("legacy courses").courses,
            vec![original_course]
        );
    }
}
