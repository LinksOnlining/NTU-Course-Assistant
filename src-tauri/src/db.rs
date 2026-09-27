use std::{
    fmt, fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension, Row, TransactionBehavior};

use crate::models::{
    default_widget_settings, merge_widget_settings, parse_date, parse_time, validate_period_times,
    validate_planner_date_range, validate_reminder_settings, validate_term_config,
    validate_widget_settings, AcademicTask, AcademicTaskStatus, Course, CourseOverride,
    CourseOverrideKind, DailySummary, DiaryEntry, Exam, ExamStatus, InboxConfirmation, InboxItem,
    PeriodTime, PersonalTask, PersonalTaskPriority, PersonalTaskStatus, PlannerEvent,
    ReminderSettings, Routine, Semester, SemesterStatus, TermConfig, TimeBlock, WidgetSettings,
    WidgetSettingsPatch,
};

const SCHEMA_SIX_VERSION: i64 = 6;
const SCHEMA_SEVEN_VERSION: i64 = 7;
const SCHEMA_EIGHT_VERSION: i64 = 8;
const CURRENT_SCHEMA_VERSION: i64 = SCHEMA_EIGHT_VERSION;
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

fn create_validated_migration_backup(
    connection: &Connection,
    backup_root: &Path,
    source_version: i64,
) -> Result<PathBuf, StorageError> {
    let directory = backup_root.join("backups").join("migrations");
    fs::create_dir_all(&directory)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    for suffix in 0..1000_u16 {
        let path = directory.join(format!(
            "courses-v{source_version}-to-v{CURRENT_SCHEMA_VERSION}-{timestamp}-{suffix}.sqlite3"
        ));
        if path.exists() {
            continue;
        }

        let path_text = path.to_string_lossy();
        if let Err(error) = connection.execute("VACUUM INTO ?1", [path_text.as_ref()]) {
            let _ = fs::remove_file(&path);
            return Err(StorageError::Sqlite(error));
        }

        let validation = (|| {
            let snapshot = Connection::open(&path)?;
            let version: i64 =
                snapshot.pragma_query_value(None, "user_version", |row| row.get(0))?;
            if version != source_version {
                return Err(StorageError::InvalidData(
                    "迁移备份的数据库版本校验失败，数据库未迁移。".into(),
                ));
            }
            validate_integrity(&snapshot)
        })();
        if let Err(error) = validation {
            let _ = fs::remove_file(&path);
            return Err(error);
        }
        return Ok(path);
    }

    Err(StorageError::InvalidData(
        "无法生成唯一的迁移备份文件名，数据库未迁移。".into(),
    ))
}

fn validate_integrity(connection: &Connection) -> Result<(), StorageError> {
    let result: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if result != "ok" {
        return Err(StorageError::InvalidData(format!(
            "SQLite integrity check failed: {result}"
        )));
    }
    let mut statement = connection.prepare("PRAGMA foreign_key_check")?;
    if statement.query([])?.next()?.is_some() {
        return Err(StorageError::InvalidData(
            "SQLite foreign key check failed".into(),
        ));
    }
    Ok(())
}

fn migrate_schema_five_to_six(connection: &mut Connection) -> Result<(), StorageError> {
    migrate_schema_five_to_six_with_hook(connection, || Ok(()))
}

fn migrate_schema_five_to_six_with_hook(
    connection: &mut Connection,
    before_validation: impl FnOnce() -> Result<(), StorageError>,
) -> Result<(), StorageError> {
    let transaction = connection.transaction()?;
    transaction.execute_batch(
        "CREATE TABLE personal_tasks (
            id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
            title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
            description TEXT NULL CHECK(description IS NULL OR length(description) <= 5000),
            status TEXT NOT NULL CHECK(status IN ('OPEN', 'COMPLETED')),
            priority TEXT NOT NULL DEFAULT 'NONE'
                CHECK(priority IN ('NONE', 'LOW', 'MEDIUM', 'HIGH')),
            deadline_date TEXT NULL CHECK(deadline_date IS NULL OR length(deadline_date) = 10),
            deadline_time TEXT NULL CHECK(deadline_time IS NULL OR length(deadline_time) = 5),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT NULL,
            CHECK(deadline_time IS NULL OR deadline_date IS NOT NULL),
            CHECK((status = 'OPEN' AND completed_at IS NULL) OR
                  (status = 'COMPLETED' AND completed_at IS NOT NULL))
        );
        CREATE INDEX personal_tasks_status_deadline
            ON personal_tasks(status, deadline_date, deadline_time, priority);

        CREATE TABLE planner_events (
            id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
            title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
            description TEXT NULL CHECK(description IS NULL OR length(description) <= 5000),
            date TEXT NOT NULL CHECK(length(date) = 10),
            start_time TEXT NOT NULL CHECK(length(start_time) = 5),
            end_time TEXT NOT NULL CHECK(length(end_time) = 5),
            location TEXT NULL CHECK(location IS NULL OR length(trim(location)) BETWEEN 1 AND 200),
            buffer_before_minutes INTEGER NOT NULL DEFAULT 0
                CHECK(buffer_before_minutes BETWEEN 0 AND 240),
            buffer_after_minutes INTEGER NOT NULL DEFAULT 0
                CHECK(buffer_after_minutes BETWEEN 0 AND 240),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK(start_time < end_time)
        );
        CREATE INDEX planner_events_date_time
            ON planner_events(date, start_time, end_time);

        CREATE TABLE time_blocks (
            id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) > 0),
            personal_task_id TEXT NOT NULL REFERENCES personal_tasks(id) ON DELETE CASCADE,
            date TEXT NOT NULL CHECK(length(date) = 10),
            start_time TEXT NOT NULL CHECK(length(start_time) = 5),
            end_time TEXT NOT NULL CHECK(length(end_time) = 5),
            buffer_before_minutes INTEGER NOT NULL DEFAULT 0
                CHECK(buffer_before_minutes BETWEEN 0 AND 240),
            buffer_after_minutes INTEGER NOT NULL DEFAULT 0
                CHECK(buffer_after_minutes BETWEEN 0 AND 240),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK(start_time < end_time)
        );
        CREATE INDEX time_blocks_date_time
            ON time_blocks(date, start_time, end_time);
        CREATE INDEX time_blocks_task_date
            ON time_blocks(personal_task_id, date, start_time);",
    )?;
    transaction.pragma_update(None, "user_version", SCHEMA_SIX_VERSION)?;
    before_validation()?;
    validate_schema_six(&transaction)?;
    transaction.commit()?;
    Ok(())
}

fn validate_schema_six(connection: &Connection) -> Result<(), StorageError> {
    const REQUIRED_TABLES: &[&str] = &[
        "courses",
        "period_times",
        "app_settings",
        "handled_reminders",
        "semesters",
        "course_overrides",
        "academic_tasks",
        "exams",
        "reminder_rules",
        "reminder_instances",
        "personal_tasks",
        "planner_events",
        "time_blocks",
    ];
    const REQUIRED_INDEXES: &[&str] = &[
        "personal_tasks_status_deadline",
        "planner_events_date_time",
        "time_blocks_date_time",
        "time_blocks_task_date",
    ];

    for (kind, name) in REQUIRED_TABLES
        .iter()
        .map(|name| ("table", *name))
        .chain(REQUIRED_INDEXES.iter().map(|name| ("index", *name)))
    {
        let exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = ?1 AND name = ?2)",
            params![kind, name],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(StorageError::InvalidData(format!(
                "schema 6 缺少必需的 {kind}: {name}"
            )));
        }
    }

    let foreign_key_exists: bool = connection.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM pragma_foreign_key_list('time_blocks')
            WHERE \"table\" = 'personal_tasks'
              AND \"from\" = 'personal_task_id'
              AND \"to\" = 'id'
              AND upper(\"on_delete\") = 'CASCADE'
        )",
        [],
        |row| row.get(0),
    )?;
    if !foreign_key_exists {
        return Err(StorageError::InvalidData(
            "schema 6 缺少 TimeBlock → PersonalTask 级联外键。".into(),
        ));
    }

    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version != SCHEMA_SIX_VERSION {
        return Err(StorageError::InvalidData("schema 6 版本校验失败。".into()));
    }
    validate_integrity(connection)
}

fn migrate_schema_six_to_seven(connection: &mut Connection) -> Result<(), StorageError> {
    migrate_schema_six_to_seven_with_hook(connection, || Ok(()))
}

fn migrate_schema_six_to_seven_with_hook(
    connection: &mut Connection,
    before_validation: impl FnOnce() -> Result<(), StorageError>,
) -> Result<(), StorageError> {
    let transaction = connection.transaction()?;
    reject_preexisting_schema_seven_objects(&transaction)?;
    transaction.execute_batch(
        "CREATE TABLE diary_entries (
            id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 128),
            entry_date TEXT NOT NULL UNIQUE CHECK(length(entry_date) = 10),
            body TEXT NOT NULL,
            created_at TEXT NOT NULL CHECK(length(created_at) > 0),
            updated_at TEXT NOT NULL CHECK(length(updated_at) > 0)
        );

        CREATE TABLE inbox_items (
            id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 128),
            raw_text TEXT NOT NULL CHECK(length(trim(raw_text)) > 0),
            status TEXT NOT NULL CHECK(status IN ('pending', 'needs_review', 'ready', 'confirmed', 'dismissed')),
            parse_kind TEXT NULL CHECK(parse_kind IS NULL OR parse_kind IN ('task', 'event', 'unknown')),
            parse_payload_json TEXT NULL,
            parser_version TEXT NULL,
            confirmed_target_type TEXT NULL CHECK(confirmed_target_type IS NULL OR confirmed_target_type IN ('personalTask', 'plannerEvent')),
            confirmed_target_id TEXT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK((confirmed_target_type IS NULL) = (confirmed_target_id IS NULL)),
            CHECK(status != 'confirmed' OR confirmed_target_type IS NOT NULL)
        );

        CREATE TABLE routines (
            id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 128),
            title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
            target_duration_minutes INTEGER NOT NULL CHECK(target_duration_minutes BETWEEN 5 AND 720),
            weekdays_mask INTEGER NOT NULL CHECK(weekdays_mask BETWEEN 1 AND 127),
            preferred_start_time TEXT NULL CHECK(preferred_start_time IS NULL OR length(preferred_start_time) = 5),
            preferred_end_time TEXT NULL CHECK(preferred_end_time IS NULL OR length(preferred_end_time) = 5),
            enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
            last_scheduled_date TEXT NULL CHECK(last_scheduled_date IS NULL OR length(last_scheduled_date) = 10),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK((preferred_start_time IS NULL AND preferred_end_time IS NULL) OR
                  (preferred_start_time IS NOT NULL AND preferred_end_time IS NOT NULL AND preferred_start_time < preferred_end_time)),
            CHECK(preferred_start_time IS NULL OR
                  (preferred_start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND
                   CAST(substr(preferred_start_time, 1, 2) AS INTEGER) < 24)),
            CHECK(preferred_end_time IS NULL OR
                  (preferred_end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND
                   CAST(substr(preferred_end_time, 1, 2) AS INTEGER) < 24))
        );

        CREATE INDEX inbox_items_status_created_at ON inbox_items(status, created_at);
        CREATE INDEX routines_enabled ON routines(enabled);
        PRAGMA user_version = 7;",
    )?;
    before_validation()?;
    validate_schema_seven(&transaction)?;
    transaction.commit()?;
    Ok(())
}

fn reject_preexisting_schema_seven_objects(connection: &Connection) -> Result<(), StorageError> {
    let existing: Option<(String, String)> = connection
        .query_row(
            "SELECT type, name FROM sqlite_master
             WHERE (type = 'table' AND name IN ('diary_entries', 'inbox_items', 'routines'))
                OR (type = 'index' AND name IN (
                    'inbox_items_status_created_at', 'routines_enabled'
                ))
             ORDER BY type, name LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((kind, name)) = existing {
        return Err(StorageError::InvalidData(format!(
            "schema 6 与已存在的 Phase 3 {kind} `{name}` 不一致；为避免覆盖或猜测，已拒绝自动恢复。"
        )));
    }
    Ok(())
}

fn validate_schema_seven(connection: &Connection) -> Result<(), StorageError> {
    validate_schema_seven_structure(connection)?;
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version != SCHEMA_SEVEN_VERSION {
        return Err(StorageError::InvalidData("schema 7 版本校验失败。".into()));
    }
    validate_integrity(connection)
}

fn validate_schema_seven_structure(connection: &Connection) -> Result<(), StorageError> {
    const REQUIRED_TABLES: &[&str] = &["diary_entries", "inbox_items", "routines"];
    const REQUIRED_INDEXES: &[&str] = &["inbox_items_status_created_at", "routines_enabled"];
    for (kind, name) in REQUIRED_TABLES
        .iter()
        .map(|name| ("table", *name))
        .chain(REQUIRED_INDEXES.iter().map(|name| ("index", *name)))
    {
        let exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = ?1 AND name = ?2)",
            params![kind, name],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(StorageError::InvalidData(format!(
                "schema 7 缺少必需的 {kind}: {name}"
            )));
        }
    }
    for query in [
        "SELECT id, entry_date, body, created_at, updated_at FROM diary_entries LIMIT 0",
        "SELECT id, raw_text, status, parse_kind, parse_payload_json, parser_version,
                confirmed_target_type, confirmed_target_id, created_at, updated_at
         FROM inbox_items LIMIT 0",
        "SELECT id, title, target_duration_minutes, weekdays_mask, preferred_start_time,
                preferred_end_time, enabled, last_scheduled_date, created_at, updated_at
         FROM routines LIMIT 0",
    ] {
        connection.prepare(query)?;
    }

    let unique_date_index: bool = connection.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM pragma_index_list('diary_entries') AS indexes
            JOIN pragma_index_info(indexes.name) AS columns
            WHERE indexes.\"unique\" = 1 AND columns.name = 'entry_date'
        )",
        [],
        |row| row.get(0),
    )?;
    if !unique_date_index {
        return Err(StorageError::InvalidData(
            "schema 7 日记日期唯一约束校验失败。".into(),
        ));
    }

    Ok(())
}

fn reject_preexisting_schema_eight_objects(connection: &Connection) -> Result<(), StorageError> {
    let existing: Option<(String, String)> = connection
        .query_row(
            "SELECT type, name FROM sqlite_master
             WHERE (type = 'table' AND name = 'daily_summaries')
                OR (type = 'index' AND name = 'daily_summaries_summary_date')
             ORDER BY type, name LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    if let Some((kind, name)) = existing {
        return Err(StorageError::InvalidData(format!(
            "schema 7 与已存在的 DailySummary {kind} `{name}` 不一致；为避免覆盖或猜测，已拒绝自动恢复。"
        )));
    }
    Ok(())
}

fn migrate_schema_seven_to_eight(connection: &mut Connection) -> Result<(), StorageError> {
    migrate_schema_seven_to_eight_with_hook(connection, || Ok(()))
}

fn migrate_schema_seven_to_eight_with_hook(
    connection: &mut Connection,
    before_validation: impl FnOnce() -> Result<(), StorageError>,
) -> Result<(), StorageError> {
    let transaction = connection.transaction()?;
    reject_preexisting_schema_eight_objects(&transaction)?;
    transaction.execute_batch(
        "CREATE TABLE daily_summaries (
            id TEXT PRIMARY KEY NOT NULL CHECK(length(trim(id)) BETWEEN 1 AND 128),
            summary_date TEXT NOT NULL UNIQUE CHECK(length(summary_date) = 10),
            overview TEXT NOT NULL CHECK(length(trim(overview)) BETWEEN 1 AND 2_000),
            highlights_json TEXT NOT NULL CHECK(length(highlights_json) <= 8_192),
            unfinished_json TEXT NOT NULL CHECK(length(unfinished_json) <= 8_192),
            tomorrow_notes_json TEXT NOT NULL CHECK(length(tomorrow_notes_json) <= 8_192),
            created_at TEXT NOT NULL CHECK(length(trim(created_at)) BETWEEN 1 AND 40),
            updated_at TEXT NOT NULL CHECK(length(trim(updated_at)) BETWEEN 1 AND 40),
            revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1)
        );",
    )?;
    transaction.pragma_update(None, "user_version", SCHEMA_EIGHT_VERSION)?;
    before_validation()?;
    validate_schema_eight(&transaction)?;
    transaction.commit()?;
    Ok(())
}

fn validate_schema_eight(connection: &Connection) -> Result<(), StorageError> {
    validate_schema_seven_structure(connection)?;
    connection.prepare(
        "SELECT id, summary_date, overview, highlights_json, unfinished_json,
                tomorrow_notes_json, created_at, updated_at, revision
         FROM daily_summaries LIMIT 0",
    )?;
    let unique_date_index: bool = connection.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM pragma_index_list('daily_summaries') AS indexes
            WHERE indexes.\"unique\" = 1
              AND (SELECT count(*) FROM pragma_index_info(indexes.name)) = 1
              AND (SELECT name FROM pragma_index_info(indexes.name) WHERE seqno = 0) = 'summary_date'
        )",
        [],
        |row| row.get(0),
    )?;
    if !unique_date_index {
        return Err(StorageError::InvalidData(
            "schema 8 DailySummary 日期唯一约束校验失败。".into(),
        ));
    }
    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version != SCHEMA_EIGHT_VERSION {
        return Err(StorageError::InvalidData("schema 8 版本校验失败。".into()));
    }
    validate_integrity(connection)
}

impl CourseDatabase {
    pub fn open(path: &Path) -> Result<Self, StorageError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        Self::from_connection_with_backup_dir(connection, path.parent())
    }

    #[cfg(test)]
    fn from_connection(connection: Connection) -> Result<Self, StorageError> {
        Self::from_connection_with_backup_dir(connection, None)
    }

    fn from_connection_with_backup_dir(
        connection: Connection,
        backup_dir: Option<&Path>,
    ) -> Result<Self, StorageError> {
        connection.busy_timeout(Duration::from_secs(3))?;
        let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version < 0 {
            return Err(StorageError::UnsupportedSchema(version));
        }
        if version > CURRENT_SCHEMA_VERSION {
            return Err(StorageError::UnsupportedSchema(version));
        }
        connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        if (1..CURRENT_SCHEMA_VERSION).contains(&version) {
            let backup_dir = backup_dir.ok_or_else(|| {
                StorageError::InvalidData("迁移前备份目录不可用，数据库未迁移。".into())
            })?;
            create_validated_migration_backup(&connection, backup_dir, version)?;
        }
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
        if version < 0 {
            return Err(StorageError::UnsupportedSchema(version));
        }
        if version == CURRENT_SCHEMA_VERSION {
            return validate_schema_eight(&self.connection);
        }
        if version == 0 {
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
        if version == 1 {
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
        if version == 2 {
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
        if version == 3 {
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
        if version == 4 {
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
        let version: i64 = self
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version == 5 {
            migrate_schema_five_to_six(&mut self.connection)?;
        }
        let version: i64 = self
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version == SCHEMA_SIX_VERSION {
            migrate_schema_six_to_seven(&mut self.connection)?;
        }
        let version: i64 = self
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version == SCHEMA_SEVEN_VERSION {
            migrate_schema_seven_to_eight(&mut self.connection)?;
        }
        validate_schema_eight(&self.connection)
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

    pub fn load_personal_tasks(&self) -> Result<Vec<PersonalTask>, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT id, title, description, status, priority, deadline_date, deadline_time,
                    created_at, updated_at, completed_at
             FROM personal_tasks
             ORDER BY status, deadline_date IS NULL, deadline_date, deadline_time IS NULL,
                      deadline_time, id",
        )?;
        let mut rows = statement.query([])?;
        let mut tasks = Vec::new();
        while let Some(row) = rows.next()? {
            tasks.push(row_to_personal_task(row)?);
        }
        Ok(tasks)
    }

    pub fn load_diary_entry(&self, date: &str) -> Result<Option<DiaryEntry>, StorageError> {
        parse_date(date).map_err(StorageError::InvalidData)?;
        self.connection
            .query_row(
                "SELECT id, entry_date, body, created_at, updated_at
                 FROM diary_entries WHERE entry_date = ?1",
                [date],
                row_to_diary_entry,
            )
            .optional()
            .map_err(StorageError::from)
    }

    /// Returns only non-empty local entries for the explicit on-device search feature.
    pub fn load_diary_entries_for_search(&self) -> Result<Vec<DiaryEntry>, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT id, entry_date, body, created_at, updated_at
             FROM diary_entries
             WHERE length(trim(body)) > 0
             ORDER BY entry_date DESC, id",
        )?;
        let mut rows = statement.query([])?;
        let mut entries = Vec::new();
        while let Some(row) = rows.next()? {
            entries.push(row_to_diary_entry(row)?);
        }
        Ok(entries)
    }

    pub fn save_diary_entry(&self, entry: &DiaryEntry) -> Result<DiaryEntry, StorageError> {
        validate_diary_entry(entry)?;
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            "INSERT INTO diary_entries (id, entry_date, body, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(entry_date) DO UPDATE SET
               body = excluded.body,
               updated_at = excluded.updated_at",
            params![
                &entry.id,
                &entry.entry_date,
                &entry.body,
                &entry.created_at,
                &entry.updated_at,
            ],
        )?;
        transaction.commit()?;
        self.load_diary_entry(&entry.entry_date)?
            .ok_or(StorageError::NotFound)
    }

    pub fn load_daily_summary(&self, date: &str) -> Result<Option<DailySummary>, StorageError> {
        parse_date(date).map_err(StorageError::InvalidData)?;
        self.connection
            .query_row(
                "SELECT id, summary_date, overview, highlights_json, unfinished_json,
                        tomorrow_notes_json, created_at, updated_at, revision
                 FROM daily_summaries WHERE summary_date = ?1",
                [date],
                row_to_daily_summary,
            )
            .optional()
            .map_err(StorageError::from)
    }

    pub fn load_daily_summaries_in_range(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<DailySummary>, StorageError> {
        parse_date(start_date).map_err(StorageError::InvalidData)?;
        parse_date(end_date).map_err(StorageError::InvalidData)?;
        if start_date > end_date {
            return Err(StorageError::InvalidData("每日总结日期范围无效".into()));
        }
        let mut statement = self.connection.prepare(
            "SELECT id, summary_date, overview, highlights_json, unfinished_json,
                    tomorrow_notes_json, created_at, updated_at, revision
             FROM daily_summaries
             WHERE summary_date >= ?1 AND summary_date <= ?2
             ORDER BY summary_date DESC LIMIT 3",
        )?;
        let mut rows = statement.query(params![start_date, end_date])?;
        let mut summaries = Vec::new();
        while let Some(row) = rows.next()? {
            summaries.push(row_to_daily_summary(row)?);
        }
        Ok(summaries)
    }

    pub fn save_daily_summary(&self, summary: &DailySummary) -> Result<DailySummary, StorageError> {
        validate_daily_summary(summary)?;
        let highlights = serde_json::to_string(&summary.highlights)?;
        let unfinished = serde_json::to_string(&summary.unfinished)?;
        let tomorrow_notes = serde_json::to_string(&summary.tomorrow_notes)?;
        let transaction = self.connection.unchecked_transaction()?;
        transaction.execute(
            "INSERT INTO daily_summaries
               (id, summary_date, overview, highlights_json, unfinished_json,
                tomorrow_notes_json, created_at, updated_at, revision)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(summary_date) DO UPDATE SET
               overview = excluded.overview,
               highlights_json = excluded.highlights_json,
               unfinished_json = excluded.unfinished_json,
               tomorrow_notes_json = excluded.tomorrow_notes_json,
               updated_at = excluded.updated_at,
               revision = daily_summaries.revision + 1",
            params![
                &summary.id,
                &summary.summary_date,
                &summary.overview,
                highlights,
                unfinished,
                tomorrow_notes,
                &summary.created_at,
                &summary.updated_at,
                summary.revision,
            ],
        )?;
        transaction.commit()?;
        self.load_daily_summary(&summary.summary_date)?
            .ok_or(StorageError::NotFound)
    }

    pub fn load_diary_content_dates(&self) -> Result<Vec<String>, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT entry_date FROM diary_entries
             WHERE length(trim(body)) > 0
             ORDER BY entry_date DESC LIMIT 14",
        )?;
        let mut rows = statement.query([])?;
        let mut dates = Vec::new();
        while let Some(row) = rows.next()? {
            dates.push(row.get(0)?);
        }
        Ok(dates)
    }

    pub fn has_diary_entry(&self, date: &str) -> Result<bool, StorageError> {
        parse_date(date).map_err(StorageError::InvalidData)?;
        self.connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM diary_entries
                    WHERE entry_date = ?1 AND length(trim(body)) > 0
                 )",
                [date],
                |row| row.get(0),
            )
            .map_err(StorageError::from)
    }

    pub fn create_inbox_item(
        &self,
        id: &str,
        raw_text: &str,
        created_at: &str,
    ) -> Result<InboxItem, StorageError> {
        validate_inbox_raw(id, raw_text, created_at)?;
        self.connection.execute(
            "INSERT INTO inbox_items (id, raw_text, status, created_at, updated_at)
             VALUES (?1, ?2, 'pending', ?3, ?3)",
            params![id, raw_text, created_at],
        )?;
        self.load_inbox_item(id)?.ok_or(StorageError::NotFound)
    }

    pub fn load_inbox_items(&self) -> Result<Vec<InboxItem>, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT id, raw_text, status, parse_kind, parse_payload_json, parser_version,
                    confirmed_target_type, confirmed_target_id, created_at, updated_at
             FROM inbox_items
             ORDER BY created_at DESC, id DESC",
        )?;
        let mut rows = statement.query([])?;
        let mut items = Vec::new();
        while let Some(row) = rows.next()? {
            items.push(row_to_inbox_item(row)?);
        }
        Ok(items)
    }

    pub fn load_inbox_item(&self, id: &str) -> Result<Option<InboxItem>, StorageError> {
        self.connection
            .query_row(
                "SELECT id, raw_text, status, parse_kind, parse_payload_json, parser_version,
                        confirmed_target_type, confirmed_target_id, created_at, updated_at
                 FROM inbox_items WHERE id = ?1",
                [id],
                row_to_inbox_item,
            )
            .optional()
            .map_err(StorageError::from)
    }

    pub fn count_pending_inbox_items(&self) -> Result<u32, StorageError> {
        self.connection
            .query_row(
                "SELECT count(*) FROM inbox_items
                 WHERE status IN ('pending', 'needs_review', 'ready')",
                [],
                |row| row.get(0),
            )
            .map_err(StorageError::from)
    }

    pub fn save_inbox_parse_result(
        &self,
        id: &str,
        parse_kind: &str,
        parse_payload_json: &str,
        parser_version: &str,
        updated_at: &str,
    ) -> Result<InboxItem, StorageError> {
        if !matches!(parse_kind, "task" | "event" | "unknown")
            || parser_version.trim().is_empty()
            || updated_at.trim().is_empty()
            || parse_payload_json.len() > 50_000
            || serde_json::from_str::<serde_json::Value>(parse_payload_json).is_err()
        {
            return Err(StorageError::InvalidData("收件箱解析结果无效".into()));
        }
        let status = if parse_kind == "unknown" {
            "needs_review"
        } else {
            "ready"
        };
        if self.connection.execute(
            "UPDATE inbox_items
             SET status = ?2, parse_kind = ?3, parse_payload_json = ?4,
                 parser_version = ?5, updated_at = ?6
             WHERE id = ?1 AND status IN ('pending', 'needs_review', 'ready')",
            params![
                id,
                status,
                parse_kind,
                parse_payload_json,
                parser_version,
                updated_at
            ],
        )? == 0
        {
            return Err(StorageError::NotFound);
        }
        self.load_inbox_item(id)?.ok_or(StorageError::NotFound)
    }

    pub fn dismiss_inbox_item(&self, id: &str, updated_at: &str) -> Result<(), StorageError> {
        if updated_at.trim().is_empty()
            || self.connection.execute(
                "UPDATE inbox_items SET status = 'dismissed', updated_at = ?2
                 WHERE id = ?1 AND status != 'confirmed'",
                params![id, updated_at],
            )? == 0
        {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn delete_inbox_item(&self, id: &str) -> Result<(), StorageError> {
        if id.trim().is_empty()
            || self
                .connection
                .execute("DELETE FROM inbox_items WHERE id = ?1", [id])?
                == 0
        {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn confirm_inbox_as_task(
        &self,
        id: &str,
        task: &PersonalTask,
    ) -> Result<InboxConfirmation, StorageError> {
        let transaction =
            rusqlite::Transaction::new_unchecked(&self.connection, TransactionBehavior::Immediate)?;
        if let Some(existing) = inbox_confirmation(&transaction, id)? {
            transaction.commit()?;
            return Ok(existing);
        }
        ensure_inbox_can_confirm(&transaction, id, "task")?;
        validate_personal_task(task)?;
        transaction.execute(
            "INSERT INTO personal_tasks
             (id, title, description, status, priority, deadline_date, deadline_time,
              created_at, updated_at, completed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                &task.id,
                &task.title,
                &task.description,
                personal_task_status_value(&task.status),
                personal_task_priority_value(&task.priority),
                &task.deadline_date,
                &task.deadline_time,
                &task.created_at,
                &task.updated_at,
                &task.completed_at,
            ],
        )?;
        set_inbox_confirmation(&transaction, id, "personalTask", &task.id, &task.updated_at)?;
        transaction.commit()?;
        Ok(InboxConfirmation {
            target_type: "personalTask".into(),
            target_id: task.id.clone(),
        })
    }

    pub fn confirm_inbox_as_event(
        &self,
        id: &str,
        event: &PlannerEvent,
    ) -> Result<InboxConfirmation, StorageError> {
        let transaction =
            rusqlite::Transaction::new_unchecked(&self.connection, TransactionBehavior::Immediate)?;
        if let Some(existing) = inbox_confirmation(&transaction, id)? {
            transaction.commit()?;
            return Ok(existing);
        }
        ensure_inbox_can_confirm(&transaction, id, "event")?;
        event.validate().map_err(StorageError::InvalidData)?;
        transaction.execute(
            "INSERT INTO planner_events
             (id, title, description, date, start_time, end_time, location,
              buffer_before_minutes, buffer_after_minutes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                &event.id,
                &event.title,
                &event.description,
                &event.date,
                &event.start_time,
                &event.end_time,
                &event.location,
                event.buffer_before_minutes,
                event.buffer_after_minutes,
                &event.created_at,
                &event.updated_at,
            ],
        )?;
        set_inbox_confirmation(
            &transaction,
            id,
            "plannerEvent",
            &event.id,
            &event.updated_at,
        )?;
        transaction.commit()?;
        Ok(InboxConfirmation {
            target_type: "plannerEvent".into(),
            target_id: event.id.clone(),
        })
    }

    pub fn create_personal_task(&self, task: &PersonalTask) -> Result<PersonalTask, StorageError> {
        validate_personal_task(task)?;
        self.connection.execute(
            "INSERT INTO personal_tasks
             (id, title, description, status, priority, deadline_date, deadline_time,
              created_at, updated_at, completed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                &task.id,
                &task.title,
                &task.description,
                personal_task_status_value(&task.status),
                personal_task_priority_value(&task.priority),
                &task.deadline_date,
                &task.deadline_time,
                &task.created_at,
                &task.updated_at,
                &task.completed_at,
            ],
        )?;
        self.load_personal_task(&task.id)
    }

    pub fn update_personal_task(&self, task: &PersonalTask) -> Result<PersonalTask, StorageError> {
        validate_personal_task(task)?;
        if self.connection.execute(
            "UPDATE personal_tasks
             SET title=?2, description=?3, status=?4, priority=?5, deadline_date=?6,
                 deadline_time=?7, updated_at=?8, completed_at=?9
             WHERE id=?1",
            params![
                &task.id,
                &task.title,
                &task.description,
                personal_task_status_value(&task.status),
                personal_task_priority_value(&task.priority),
                &task.deadline_date,
                &task.deadline_time,
                &task.updated_at,
                &task.completed_at,
            ],
        )? == 0
        {
            return Err(StorageError::NotFound);
        }
        self.load_personal_task(&task.id)
    }

    pub fn set_personal_task_completed(
        &self,
        id: &str,
        completed: bool,
        updated_at: &str,
    ) -> Result<PersonalTask, StorageError> {
        if id.trim().is_empty() || updated_at.trim().is_empty() {
            return Err(StorageError::InvalidData("个人任务状态信息无效".into()));
        }
        let status = if completed { "COMPLETED" } else { "OPEN" };
        let completed_at = completed.then_some(updated_at);
        if self.connection.execute(
            "UPDATE personal_tasks SET status=?2, completed_at=?3, updated_at=?4 WHERE id=?1",
            params![id, status, completed_at, updated_at],
        )? == 0
        {
            return Err(StorageError::NotFound);
        }
        self.load_personal_task(id)
    }

    pub fn delete_personal_task(&self, id: &str) -> Result<(), StorageError> {
        if id.trim().is_empty()
            || self
                .connection
                .execute("DELETE FROM personal_tasks WHERE id=?1", [id])?
                == 0
        {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    fn load_personal_task(&self, id: &str) -> Result<PersonalTask, StorageError> {
        self.connection
            .query_row(
                "SELECT id, title, description, status, priority, deadline_date, deadline_time,
                        created_at, updated_at, completed_at FROM personal_tasks WHERE id=?1",
                [id],
                row_to_personal_task,
            )
            .map_err(StorageError::from)
    }

    pub fn load_planner_events(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<PlannerEvent>, StorageError> {
        validate_planner_date_range(start_date, end_date).map_err(StorageError::InvalidData)?;
        let mut statement = self.connection.prepare(
            "SELECT id, title, description, date, start_time, end_time, location,
                    buffer_before_minutes, buffer_after_minutes, created_at, updated_at
             FROM planner_events
             WHERE date >= ?1 AND date <= ?2
             ORDER BY date, start_time, id",
        )?;
        let mut rows = statement.query(params![start_date, end_date])?;
        let mut events = Vec::new();
        while let Some(row) = rows.next()? {
            events.push(row_to_planner_event(row)?);
        }
        Ok(events)
    }

    pub fn load_all_planner_events_for_search(&self) -> Result<Vec<PlannerEvent>, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT id, title, description, date, start_time, end_time, location,
                    buffer_before_minutes, buffer_after_minutes, created_at, updated_at
             FROM planner_events
             ORDER BY date DESC, start_time, id",
        )?;
        let mut rows = statement.query([])?;
        let mut events = Vec::new();
        while let Some(row) = rows.next()? {
            events.push(row_to_planner_event(row)?);
        }
        Ok(events)
    }

    pub fn load_routines(&self) -> Result<Vec<Routine>, StorageError> {
        let mut statement = self.connection.prepare(
            "SELECT id, title, target_duration_minutes, weekdays_mask, preferred_start_time,
                    preferred_end_time, enabled, last_scheduled_date, created_at, updated_at
             FROM routines ORDER BY created_at, id",
        )?;
        let mut rows = statement.query([])?;
        let mut routines = Vec::new();
        while let Some(row) = rows.next()? {
            routines.push(row_to_routine(row)?);
        }
        Ok(routines)
    }

    pub fn create_routine(&self, routine: &Routine) -> Result<Routine, StorageError> {
        routine.validate().map_err(StorageError::InvalidData)?;
        if routine.last_scheduled_date.is_some() {
            return Err(StorageError::InvalidData(
                "新建日常习惯不能预设已安排日期".into(),
            ));
        }
        self.connection.execute(
            "INSERT INTO routines
             (id, title, target_duration_minutes, weekdays_mask, preferred_start_time,
              preferred_end_time, enabled, last_scheduled_date, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                &routine.id,
                &routine.title,
                routine.target_duration_minutes,
                routine.weekdays_mask,
                &routine.preferred_start_time,
                &routine.preferred_end_time,
                routine.enabled,
                &routine.last_scheduled_date,
                &routine.created_at,
                &routine.updated_at,
            ],
        )?;
        self.load_routine(&routine.id)
    }

    pub fn update_routine(&self, routine: &Routine) -> Result<Routine, StorageError> {
        routine.validate().map_err(StorageError::InvalidData)?;
        if self.connection.execute(
            "UPDATE routines SET title=?2, target_duration_minutes=?3, weekdays_mask=?4,
             preferred_start_time=?5, preferred_end_time=?6, enabled=?7,
             updated_at=?8 WHERE id=?1",
            params![
                &routine.id,
                &routine.title,
                routine.target_duration_minutes,
                routine.weekdays_mask,
                &routine.preferred_start_time,
                &routine.preferred_end_time,
                routine.enabled,
                &routine.updated_at,
            ],
        )? == 0
        {
            return Err(StorageError::NotFound);
        }
        self.load_routine(&routine.id)
    }

    pub fn delete_routine(&self, id: &str) -> Result<(), StorageError> {
        if id.trim().is_empty()
            || self
                .connection
                .execute("DELETE FROM routines WHERE id=?1", [id])?
                == 0
        {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    pub fn confirm_routine_suggestion(
        &self,
        routine_id: &str,
        target_date: &str,
        event: &PlannerEvent,
    ) -> Result<PlannerEvent, StorageError> {
        event.validate().map_err(StorageError::InvalidData)?;
        parse_date(target_date).map_err(StorageError::InvalidData)?;
        if routine_id.trim().is_empty() || routine_id.trim() != routine_id {
            return Err(StorageError::InvalidData("日常习惯 ID 无效".into()));
        }

        let transaction =
            rusqlite::Transaction::new_unchecked(&self.connection, TransactionBehavior::Immediate)?;
        let current: Option<(bool, Option<String>)> = transaction
            .query_row(
                "SELECT enabled, last_scheduled_date FROM routines WHERE id=?1",
                [routine_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((enabled, last_scheduled_date)) = current else {
            return Err(StorageError::NotFound);
        };
        if !enabled || last_scheduled_date.as_deref() == Some(target_date) {
            return Err(StorageError::InvalidData(
                "日常习惯建议已失效，请刷新后重试".into(),
            ));
        }

        insert_planner_event(&transaction, event)?;
        if transaction.execute(
            "UPDATE routines SET last_scheduled_date=?2, updated_at=?3
             WHERE id=?1 AND enabled=1 AND (last_scheduled_date IS NULL OR last_scheduled_date != ?2)",
            params![routine_id, target_date, &event.updated_at],
        )? == 0
        {
            return Err(StorageError::InvalidData("日常习惯建议已失效，请刷新后重试".into()));
        }
        transaction.commit()?;
        Ok(event.clone())
    }

    pub fn create_planner_event(&self, event: &PlannerEvent) -> Result<PlannerEvent, StorageError> {
        event.validate().map_err(StorageError::InvalidData)?;
        self.connection.execute(
            "INSERT INTO planner_events
             (id, title, description, date, start_time, end_time, location,
              buffer_before_minutes, buffer_after_minutes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                &event.id,
                &event.title,
                &event.description,
                &event.date,
                &event.start_time,
                &event.end_time,
                &event.location,
                event.buffer_before_minutes,
                event.buffer_after_minutes,
                &event.created_at,
                &event.updated_at,
            ],
        )?;
        self.load_planner_event(&event.id)
    }

    pub fn update_planner_event(&self, event: &PlannerEvent) -> Result<PlannerEvent, StorageError> {
        event.validate().map_err(StorageError::InvalidData)?;
        if self.connection.execute(
            "UPDATE planner_events
             SET title=?2, description=?3, date=?4, start_time=?5, end_time=?6,
                 location=?7, buffer_before_minutes=?8, buffer_after_minutes=?9, updated_at=?10
             WHERE id=?1",
            params![
                &event.id,
                &event.title,
                &event.description,
                &event.date,
                &event.start_time,
                &event.end_time,
                &event.location,
                event.buffer_before_minutes,
                event.buffer_after_minutes,
                &event.updated_at,
            ],
        )? == 0
        {
            return Err(StorageError::NotFound);
        }
        self.load_planner_event(&event.id)
    }

    pub fn delete_planner_event(&self, id: &str) -> Result<(), StorageError> {
        if id.trim().is_empty()
            || self
                .connection
                .execute("DELETE FROM planner_events WHERE id=?1", [id])?
                == 0
        {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    fn load_planner_event(&self, id: &str) -> Result<PlannerEvent, StorageError> {
        self.connection
            .query_row(
                "SELECT id, title, description, date, start_time, end_time, location,
                        buffer_before_minutes, buffer_after_minutes, created_at, updated_at
                 FROM planner_events WHERE id=?1",
                [id],
                row_to_planner_event,
            )
            .map_err(StorageError::from)
    }

    fn load_routine(&self, id: &str) -> Result<Routine, StorageError> {
        self.connection
            .query_row(
                "SELECT id, title, target_duration_minutes, weekdays_mask, preferred_start_time,
                        preferred_end_time, enabled, last_scheduled_date, created_at, updated_at
                 FROM routines WHERE id=?1",
                [id],
                row_to_routine,
            )
            .map_err(StorageError::from)
    }

    pub fn load_time_blocks(
        &self,
        start_date: &str,
        end_date: &str,
    ) -> Result<Vec<TimeBlock>, StorageError> {
        validate_planner_date_range(start_date, end_date).map_err(StorageError::InvalidData)?;
        let mut statement = self.connection.prepare(
            "SELECT id, personal_task_id, date, start_time, end_time,
                    buffer_before_minutes, buffer_after_minutes, created_at, updated_at
             FROM time_blocks
             WHERE date >= ?1 AND date <= ?2
             ORDER BY date, start_time, id",
        )?;
        let mut rows = statement.query(params![start_date, end_date])?;
        let mut blocks = Vec::new();
        while let Some(row) = rows.next()? {
            blocks.push(row_to_time_block(row)?);
        }
        Ok(blocks)
    }

    pub fn load_time_blocks_for_task(
        &self,
        personal_task_id: &str,
    ) -> Result<Vec<TimeBlock>, StorageError> {
        if personal_task_id.trim().is_empty() || personal_task_id.trim() != personal_task_id {
            return Err(StorageError::InvalidData("个人任务 ID 无效".into()));
        }
        let mut statement = self.connection.prepare(
            "SELECT id, personal_task_id, date, start_time, end_time,
                    buffer_before_minutes, buffer_after_minutes, created_at, updated_at
             FROM time_blocks WHERE personal_task_id=?1 ORDER BY date, start_time, id",
        )?;
        let mut rows = statement.query([personal_task_id])?;
        let mut blocks = Vec::new();
        while let Some(row) = rows.next()? {
            blocks.push(row_to_time_block(row)?);
        }
        Ok(blocks)
    }

    pub fn create_time_block(&self, block: &TimeBlock) -> Result<TimeBlock, StorageError> {
        block.validate().map_err(StorageError::InvalidData)?;
        self.connection.execute(
            "INSERT INTO time_blocks
             (id, personal_task_id, date, start_time, end_time, buffer_before_minutes,
              buffer_after_minutes, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                &block.id,
                &block.personal_task_id,
                &block.date,
                &block.start_time,
                &block.end_time,
                block.buffer_before_minutes,
                block.buffer_after_minutes,
                &block.created_at,
                &block.updated_at,
            ],
        )?;
        self.load_time_block(&block.id)
    }

    pub fn update_time_block(&self, block: &TimeBlock) -> Result<TimeBlock, StorageError> {
        block.validate().map_err(StorageError::InvalidData)?;
        if self.connection.execute(
            "UPDATE time_blocks
             SET personal_task_id=?2, date=?3, start_time=?4, end_time=?5,
                 buffer_before_minutes=?6, buffer_after_minutes=?7, updated_at=?8
             WHERE id=?1",
            params![
                &block.id,
                &block.personal_task_id,
                &block.date,
                &block.start_time,
                &block.end_time,
                block.buffer_before_minutes,
                block.buffer_after_minutes,
                &block.updated_at,
            ],
        )? == 0
        {
            return Err(StorageError::NotFound);
        }
        self.load_time_block(&block.id)
    }

    pub fn delete_time_block(&self, id: &str) -> Result<(), StorageError> {
        if id.trim().is_empty()
            || self
                .connection
                .execute("DELETE FROM time_blocks WHERE id=?1", [id])?
                == 0
        {
            return Err(StorageError::NotFound);
        }
        Ok(())
    }

    fn load_time_block(&self, id: &str) -> Result<TimeBlock, StorageError> {
        self.connection
            .query_row(
                "SELECT id, personal_task_id, date, start_time, end_time,
                        buffer_before_minutes, buffer_after_minutes, created_at, updated_at
                 FROM time_blocks WHERE id=?1",
                [id],
                row_to_time_block,
            )
            .map_err(StorageError::from)
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

fn validate_personal_task(value: &PersonalTask) -> Result<(), StorageError> {
    if value.id.trim().is_empty()
        || value.id.trim() != value.id
        || value.title.trim().is_empty()
        || value.title.chars().count() > 200
        || value
            .description
            .as_ref()
            .is_some_and(|text| text.chars().count() > 5000)
        || value.created_at.trim().is_empty()
        || value.updated_at.trim().is_empty()
    {
        return Err(StorageError::InvalidData("个人任务信息无效".into()));
    }
    if value
        .description
        .as_ref()
        .is_some_and(|text| text.trim().is_empty())
    {
        return Err(StorageError::InvalidData("任务描述不能为空白字符".into()));
    }
    if let Some(date) = &value.deadline_date {
        parse_date(date).map_err(StorageError::InvalidData)?;
    }
    if let Some(time) = &value.deadline_time {
        parse_time(time).map_err(StorageError::InvalidData)?;
        if value.deadline_date.is_none() {
            return Err(StorageError::InvalidData(
                "截止时间必须同时填写截止日期".into(),
            ));
        }
    }
    match (&value.status, &value.completed_at) {
        (PersonalTaskStatus::Open, None) => {}
        (PersonalTaskStatus::Completed, Some(timestamp)) if !timestamp.trim().is_empty() => {}
        _ => return Err(StorageError::InvalidData("个人任务完成状态无效".into())),
    }
    Ok(())
}

fn validate_diary_entry(value: &DiaryEntry) -> Result<(), StorageError> {
    if value.id.trim().is_empty() || value.id.len() > 128 {
        return Err(StorageError::InvalidData("日记记录标识无效".into()));
    }
    parse_date(&value.entry_date).map_err(StorageError::InvalidData)?;
    if value.created_at.trim().is_empty() || value.updated_at.trim().is_empty() {
        return Err(StorageError::InvalidData("日记保存时间无效".into()));
    }
    Ok(())
}

fn validate_daily_summary(value: &DailySummary) -> Result<(), StorageError> {
    if value.id.trim().is_empty()
        || value.id.trim() != value.id
        || value.id.chars().count() > 128
        || value.overview.trim().is_empty()
        || value.overview.chars().count() > 2_000
        || value.created_at.trim().is_empty()
        || value.created_at.chars().count() > 40
        || value.updated_at.trim().is_empty()
        || value.updated_at.chars().count() > 40
        || value.revision < 1
    {
        return Err(StorageError::InvalidData("每日总结信息无效".into()));
    }
    parse_date(&value.summary_date).map_err(StorageError::InvalidData)?;
    for (field, items) in [
        ("今日完成", &value.highlights),
        ("未完成事项", &value.unfinished),
        ("明日备注", &value.tomorrow_notes),
    ] {
        if items.len() > 8
            || items
                .iter()
                .any(|item| item.trim().is_empty() || item.chars().count() > 180)
        {
            return Err(StorageError::InvalidData(format!(
                "每日总结{field}内容无效"
            )));
        }
    }
    Ok(())
}

fn validate_inbox_raw(id: &str, raw_text: &str, created_at: &str) -> Result<(), StorageError> {
    if id.trim().is_empty()
        || id.trim() != id
        || id.len() > 128
        || raw_text.trim().is_empty()
        || raw_text.chars().count() > 10_000
        || created_at.trim().is_empty()
    {
        return Err(StorageError::InvalidData("收件箱内容无效".into()));
    }
    Ok(())
}

fn inbox_confirmation(
    connection: &Connection,
    id: &str,
) -> Result<Option<InboxConfirmation>, StorageError> {
    let record = connection
        .query_row(
            "SELECT status, confirmed_target_type, confirmed_target_id
             FROM inbox_items WHERE id = ?1",
            [id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?;
    match record {
        Some((status, Some(target_type), Some(target_id))) if status == "confirmed" => {
            Ok(Some(InboxConfirmation {
                target_type,
                target_id,
            }))
        }
        Some((status, _, _)) if status == "confirmed" => Err(StorageError::InvalidData(
            "已确认的收件箱目标信息不完整".into(),
        )),
        Some(_) => Ok(None),
        None => Err(StorageError::NotFound),
    }
}

fn ensure_inbox_can_confirm(
    connection: &Connection,
    id: &str,
    expected_kind: &str,
) -> Result<(), StorageError> {
    let record: (String, Option<String>) = connection
        .query_row(
            "SELECT status, parse_kind FROM inbox_items WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(StorageError::NotFound)?;
    if record.0 == "dismissed" {
        return Err(StorageError::InvalidData(
            "已忽略的收件箱内容不能转换".into(),
        ));
    }
    let preview_matches = record.0 == "ready" && record.1.as_deref() == Some(expected_kind);
    // AI-assisted Inbox proposals are reviewed in the application before this
    // atomic confirmation command. They may originate from an unparsed capture
    // (pending) or a locally ambiguous capture (needs_review/unknown); no parse
    // metadata is written because the original Inbox text remains the source.
    let ai_review_matches = (record.0 == "pending" && record.1.is_none())
        || (record.0 == "needs_review" && record.1.as_deref() == Some("unknown"));
    if !preview_matches && !ai_review_matches {
        return Err(StorageError::InvalidData(
            "收件箱内容尚未完成对应类型的预览确认".into(),
        ));
    }
    Ok(())
}

fn set_inbox_confirmation(
    connection: &Connection,
    inbox_id: &str,
    target_type: &str,
    target_id: &str,
    updated_at: &str,
) -> Result<(), StorageError> {
    if connection.execute(
        "UPDATE inbox_items
         SET status = 'confirmed', confirmed_target_type = ?2,
             confirmed_target_id = ?3, updated_at = ?4
         WHERE id = ?1 AND status != 'confirmed'",
        params![inbox_id, target_type, target_id, updated_at],
    )? == 0
    {
        return Err(StorageError::NotFound);
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

fn personal_task_status_value(value: &PersonalTaskStatus) -> &'static str {
    match value {
        PersonalTaskStatus::Open => "OPEN",
        PersonalTaskStatus::Completed => "COMPLETED",
    }
}

fn personal_task_priority_value(value: &PersonalTaskPriority) -> &'static str {
    match value {
        PersonalTaskPriority::None => "NONE",
        PersonalTaskPriority::Low => "LOW",
        PersonalTaskPriority::Medium => "MEDIUM",
        PersonalTaskPriority::High => "HIGH",
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

fn row_to_diary_entry(row: &Row<'_>) -> rusqlite::Result<DiaryEntry> {
    Ok(DiaryEntry {
        id: row.get(0)?,
        entry_date: row.get(1)?,
        body: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

fn row_to_daily_summary(row: &Row<'_>) -> rusqlite::Result<DailySummary> {
    let highlights_json: String = row.get(3)?;
    let unfinished_json: String = row.get(4)?;
    let tomorrow_notes_json: String = row.get(5)?;
    Ok(DailySummary {
        id: row.get(0)?,
        summary_date: row.get(1)?,
        overview: row.get(2)?,
        highlights: parse_daily_summary_items(highlights_json, 3)?,
        unfinished: parse_daily_summary_items(unfinished_json, 4)?,
        tomorrow_notes: parse_daily_summary_items(tomorrow_notes_json, 5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        revision: row.get(8)?,
    })
}

fn parse_daily_summary_items(value: String, column: usize) -> rusqlite::Result<Vec<String>> {
    serde_json::from_str(&value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            column,
            rusqlite::types::Type::Text,
            Box::new(error),
        )
    })
}

fn row_to_inbox_item(row: &Row<'_>) -> rusqlite::Result<InboxItem> {
    Ok(InboxItem {
        id: row.get(0)?,
        raw_text: row.get(1)?,
        status: row.get(2)?,
        parse_kind: row.get(3)?,
        parse_payload_json: row.get(4)?,
        parser_version: row.get(5)?,
        confirmed_target_type: row.get(6)?,
        confirmed_target_id: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
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

fn row_to_personal_task(row: &Row<'_>) -> rusqlite::Result<PersonalTask> {
    let status = match row.get::<_, String>(3)?.as_str() {
        "OPEN" => PersonalTaskStatus::Open,
        "COMPLETED" => PersonalTaskStatus::Completed,
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    let priority = match row.get::<_, String>(4)?.as_str() {
        "NONE" => PersonalTaskPriority::None,
        "LOW" => PersonalTaskPriority::Low,
        "MEDIUM" => PersonalTaskPriority::Medium,
        "HIGH" => PersonalTaskPriority::High,
        _ => return Err(rusqlite::Error::InvalidQuery),
    };
    Ok(PersonalTask {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        status,
        priority,
        deadline_date: row.get(5)?,
        deadline_time: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        completed_at: row.get(9)?,
    })
}

fn row_to_planner_event(row: &Row<'_>) -> rusqlite::Result<PlannerEvent> {
    Ok(PlannerEvent {
        id: row.get(0)?,
        title: row.get(1)?,
        description: row.get(2)?,
        date: row.get(3)?,
        start_time: row.get(4)?,
        end_time: row.get(5)?,
        location: row.get(6)?,
        buffer_before_minutes: row.get(7)?,
        buffer_after_minutes: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn row_to_routine(row: &Row<'_>) -> rusqlite::Result<Routine> {
    Ok(Routine {
        id: row.get(0)?,
        title: row.get(1)?,
        target_duration_minutes: row.get(2)?,
        weekdays_mask: row.get(3)?,
        preferred_start_time: row.get(4)?,
        preferred_end_time: row.get(5)?,
        enabled: row.get(6)?,
        last_scheduled_date: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn insert_planner_event(connection: &Connection, event: &PlannerEvent) -> Result<(), StorageError> {
    connection.execute(
        "INSERT INTO planner_events
         (id, title, description, date, start_time, end_time, location,
          buffer_before_minutes, buffer_after_minutes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            &event.id,
            &event.title,
            &event.description,
            &event.date,
            &event.start_time,
            &event.end_time,
            &event.location,
            event.buffer_before_minutes,
            event.buffer_after_minutes,
            &event.created_at,
            &event.updated_at,
        ],
    )?;
    Ok(())
}

fn row_to_time_block(row: &Row<'_>) -> rusqlite::Result<TimeBlock> {
    Ok(TimeBlock {
        id: row.get(0)?,
        personal_task_id: row.get(1)?,
        date: row.get(2)?,
        start_time: row.get(3)?,
        end_time: row.get(4)?,
        buffer_before_minutes: row.get(5)?,
        buffer_after_minutes: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
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

    fn personal_task(id: &str) -> PersonalTask {
        PersonalTask {
            id: id.into(),
            title: "准备材料".into(),
            description: Some("整理需要提交的材料".into()),
            status: PersonalTaskStatus::Open,
            priority: PersonalTaskPriority::Medium,
            deadline_date: Some("2026-09-24".into()),
            deadline_time: None,
            created_at: "2026-09-23T08:00:00.000Z".into(),
            updated_at: "2026-09-23T08:00:00.000Z".into(),
            completed_at: None,
        }
    }

    fn planner_event(id: &str, date: &str) -> PlannerEvent {
        PlannerEvent {
            id: id.into(),
            title: "个人安排".into(),
            description: Some("测试说明".into()),
            date: date.into(),
            start_time: "10:00".into(),
            end_time: "11:00".into(),
            location: Some("图书馆".into()),
            buffer_before_minutes: 10,
            buffer_after_minutes: 20,
            created_at: "2026-09-23T08:00:00.000Z".into(),
            updated_at: "2026-09-23T08:00:00.000Z".into(),
        }
    }

    fn routine(id: &str) -> Routine {
        Routine {
            id: id.into(),
            title: "跑步".into(),
            target_duration_minutes: 40,
            weekdays_mask: 0b0010101,
            preferred_start_time: Some("18:00".into()),
            preferred_end_time: Some("21:00".into()),
            enabled: true,
            last_scheduled_date: None,
            created_at: "2026-09-23T08:00:00.000Z".into(),
            updated_at: "2026-09-23T08:00:00.000Z".into(),
        }
    }

    fn time_block(id: &str, task_id: &str, date: &str) -> TimeBlock {
        TimeBlock {
            id: id.into(),
            personal_task_id: task_id.into(),
            date: date.into(),
            start_time: "13:00".into(),
            end_time: "14:00".into(),
            buffer_before_minutes: 5,
            buffer_after_minutes: 15,
            created_at: "2026-09-23T08:00:00.000Z".into(),
            updated_at: "2026-09-23T08:00:00.000Z".into(),
        }
    }

    fn temporary_database_path() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "ntu-course-assistant-{}-{}",
            std::process::id(),
            DATABASE_NUMBER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).expect("create temporary database directory");
        root.join("courses.sqlite3")
    }

    fn isolated_database_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "ntu-course-assistant-migration-{}-{}",
            std::process::id(),
            DATABASE_NUMBER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).expect("create isolated test directory");
        root
    }

    #[test]
    fn personal_task_crud_completion_and_reopen_survive_database_reopen() {
        let path = temporary_database_path();
        let original = personal_task("personal-task-1");
        {
            let database = CourseDatabase::open(&path).expect("create planner database");
            assert_eq!(database.create_personal_task(&original).unwrap(), original);

            let updated = PersonalTask {
                title: "准备最终材料".into(),
                priority: PersonalTaskPriority::High,
                deadline_time: Some("17:30".into()),
                updated_at: "2026-09-23T09:00:00.000Z".into(),
                ..original.clone()
            };
            assert_eq!(database.update_personal_task(&updated).unwrap(), updated);
            assert_eq!(
                database.load_personal_tasks().unwrap(),
                vec![updated.clone()]
            );

            let completed = database
                .set_personal_task_completed(&updated.id, true, "2026-09-23T10:00:00.000Z")
                .unwrap();
            assert_eq!(completed.status, PersonalTaskStatus::Completed);
            assert_eq!(
                completed.completed_at.as_deref(),
                Some("2026-09-23T10:00:00.000Z")
            );

            let reopened = database
                .set_personal_task_completed(&updated.id, false, "2026-09-23T11:00:00.000Z")
                .unwrap();
            assert_eq!(reopened.status, PersonalTaskStatus::Open);
            assert_eq!(reopened.completed_at, None);
            assert_eq!(reopened.created_at, original.created_at);
        }

        let database = CourseDatabase::open(&path).expect("reopen planner database");
        let saved = database.load_personal_tasks().unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].status, PersonalTaskStatus::Open);
        assert_eq!(saved[0].title, "准备最终材料");
        database.delete_personal_task(&saved[0].id).unwrap();
        assert!(database.load_personal_tasks().unwrap().is_empty());
        assert!(database.delete_personal_task(&saved[0].id).is_err());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn planner_event_and_time_block_crud_filter_ranges_and_survive_reopen() {
        let path = temporary_database_path();
        let mut event = planner_event("event-crud", "2026-09-24");
        let mut block = time_block("block-crud", "task-crud", "2026-09-24");
        {
            let database = CourseDatabase::open(&path).expect("open planner database");
            let task = personal_task("task-crud");
            database.create_personal_task(&task).unwrap();
            assert_eq!(database.create_planner_event(&event).unwrap(), event);
            assert_eq!(
                database
                    .load_planner_events("2026-09-24", "2026-09-24")
                    .unwrap(),
                vec![event.clone()]
            );
            event.title = "更新后的安排".into();
            event.date = "2026-09-25".into();
            event.start_time = "11:00".into();
            event.end_time = "12:15".into();
            event.buffer_before_minutes = 30;
            event.created_at = "forged-created-at".into();
            event.updated_at = "2026-09-23T09:00:00.000Z".into();
            let mut expected_event = event.clone();
            expected_event.created_at = "2026-09-23T08:00:00.000Z".into();
            assert_eq!(
                database.update_planner_event(&event).unwrap(),
                expected_event
            );
            event = expected_event;
            assert_eq!(event.created_at, "2026-09-23T08:00:00.000Z");
            assert!(database
                .load_planner_events("2026-09-24", "2026-09-24")
                .unwrap()
                .is_empty());
            assert_eq!(
                database
                    .load_planner_events("2026-09-24", "2026-09-25")
                    .unwrap(),
                vec![event.clone()]
            );

            assert_eq!(database.create_time_block(&block).unwrap(), block);
            assert_eq!(
                database.load_all_planner_events_for_search().unwrap(),
                vec![event.clone()]
            );
            assert_eq!(
                database
                    .load_time_blocks_for_task(&block.personal_task_id)
                    .unwrap(),
                vec![block.clone()]
            );
            block.date = "2026-09-26".into();
            block.start_time = "15:00".into();
            block.end_time = "16:30".into();
            block.buffer_after_minutes = 45;
            block.created_at = "forged-created-at".into();
            block.updated_at = "2026-09-23T09:30:00.000Z".into();
            let mut expected_block = block.clone();
            expected_block.created_at = "2026-09-23T08:00:00.000Z".into();
            assert_eq!(database.update_time_block(&block).unwrap(), expected_block);
            block = expected_block;
            assert!(database
                .load_time_blocks("2026-09-24", "2026-09-25")
                .unwrap()
                .is_empty());
            assert_eq!(
                database
                    .load_time_blocks("2026-09-26", "2026-09-26")
                    .unwrap(),
                vec![block.clone()]
            );
            assert_eq!(
                database
                    .load_time_blocks_for_task(&block.personal_task_id)
                    .unwrap(),
                vec![block.clone()]
            );
        }

        let database = CourseDatabase::open(&path).expect("reopen planner database");
        assert_eq!(
            database
                .load_planner_events("2026-09-25", "2026-09-25")
                .unwrap(),
            vec![event.clone()]
        );
        assert_eq!(
            database
                .load_time_blocks_for_task(&block.personal_task_id)
                .unwrap(),
            vec![block.clone()]
        );
        database.delete_planner_event(&event.id).unwrap();
        database.delete_time_block(&block.id).unwrap();
        assert!(database
            .load_planner_events("2026-09-25", "2026-09-25")
            .unwrap()
            .is_empty());
        assert!(database
            .load_time_blocks_for_task(&block.personal_task_id)
            .unwrap()
            .is_empty());
        assert!(database.delete_planner_event(&event.id).is_err());
        assert!(database.delete_time_block(&block.id).is_err());
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn routine_confirmation_atomically_saves_event_and_date_and_delete_preserves_event() {
        let database = database();
        let saved_routine = database.create_routine(&routine("run")).unwrap();
        assert_eq!(database.load_routines().unwrap(), vec![saved_routine]);

        let event = planner_event("run-event", "2026-09-24");
        assert_eq!(
            database
                .confirm_routine_suggestion("run", "2026-09-24", &event)
                .unwrap(),
            event
        );
        assert_eq!(
            database
                .load_routine("run")
                .unwrap()
                .last_scheduled_date
                .as_deref(),
            Some("2026-09-24")
        );
        assert_eq!(
            database
                .load_planner_events("2026-09-24", "2026-09-24")
                .unwrap(),
            vec![event.clone()]
        );
        let personal_task_count: i64 = database
            .connection
            .query_row("SELECT COUNT(*) FROM personal_tasks", [], |row| row.get(0))
            .unwrap();
        let time_block_count: i64 = database
            .connection
            .query_row("SELECT COUNT(*) FROM time_blocks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(personal_task_count, 0);
        assert_eq!(time_block_count, 0);

        let duplicate = planner_event("run-event", "2026-09-25");
        assert!(database
            .confirm_routine_suggestion("run", "2026-09-25", &duplicate)
            .is_err());
        assert_eq!(
            database
                .load_routine("run")
                .unwrap()
                .last_scheduled_date
                .as_deref(),
            Some("2026-09-24"),
            "failed event insert must not advance the routine date"
        );
        assert_eq!(
            database
                .load_planner_events("2026-09-25", "2026-09-25")
                .unwrap()
                .len(),
            0
        );

        database.delete_routine("run").unwrap();
        assert!(database.load_routines().unwrap().is_empty());
        assert_eq!(
            database
                .load_planner_events("2026-09-24", "2026-09-24")
                .unwrap(),
            vec![event],
            "deleting a routine must not remove its confirmed event"
        );
    }

    #[test]
    fn routine_confirmation_rolls_back_event_when_routine_update_fails() {
        let database = database();
        database.create_routine(&routine("run")).unwrap();
        database
            .connection
            .execute_batch(
                "CREATE TRIGGER reject_routine_schedule BEFORE UPDATE OF last_scheduled_date ON routines
                 BEGIN SELECT RAISE(ABORT, 'test rollback'); END;",
            )
            .unwrap();

        assert!(database
            .confirm_routine_suggestion(
                "run",
                "2026-09-24",
                &planner_event("rolled-back", "2026-09-24")
            )
            .is_err());
        assert!(database
            .load_planner_events("2026-09-24", "2026-09-24")
            .unwrap()
            .is_empty());
        assert_eq!(
            database.load_routine("run").unwrap().last_scheduled_date,
            None
        );
    }

    #[test]
    fn planner_events_and_time_blocks_round_trip_end_of_day_boundary() {
        let database = database();
        let task = personal_task("task-end-of-day");
        database.create_personal_task(&task).unwrap();

        let mut event = planner_event("event-end-of-day", "2026-09-24");
        event.start_time = "23:55".into();
        event.end_time = "24:00".into();
        assert_eq!(database.create_planner_event(&event).unwrap(), event);
        assert_eq!(
            database
                .load_planner_events("2026-09-24", "2026-09-24")
                .unwrap(),
            vec![event]
        );

        let mut block = time_block("block-end-of-day", &task.id, "2026-09-24");
        block.start_time = "23:55".into();
        block.end_time = "24:00".into();
        assert_eq!(database.create_time_block(&block).unwrap(), block);
        assert_eq!(
            database
                .load_time_blocks("2026-09-24", "2026-09-24")
                .unwrap(),
            vec![block]
        );
    }

    #[test]
    fn planner_storage_rejects_invalid_range_and_cross_midnight_records() {
        let database = database();
        assert!(database
            .load_planner_events("2026-09-25", "2026-09-24")
            .is_err());
        assert!(database
            .load_time_blocks("2026-09-25", "2026-09-24")
            .is_err());
        let mut event = planner_event("invalid-event", "2026-09-24");
        event.start_time = "23:00".into();
        event.end_time = "01:00".into();
        assert!(database.create_planner_event(&event).is_err());
        let invalid_block = time_block("orphan-block", "missing-task", "2026-09-24");
        assert!(database.create_time_block(&invalid_block).is_err());
        assert!(database
            .load_planner_events("2026-09-24", "2026-09-24")
            .unwrap()
            .is_empty());
        assert!(database
            .load_time_blocks("2026-09-24", "2026-09-24")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn deleting_personal_task_cascades_to_time_blocks() {
        let database = database();
        let task = personal_task("personal-task-cascade");
        database.create_personal_task(&task).unwrap();
        database
            .create_time_block(&time_block("block-1", &task.id, "2026-09-24"))
            .unwrap();
        database
            .create_planner_event(&planner_event("event-1", "2026-09-24"))
            .unwrap();
        database
            .set_personal_task_completed(&task.id, true, "2026-09-23T09:00:00.000Z")
            .unwrap();
        assert_eq!(
            database.load_time_blocks_for_task(&task.id).unwrap().len(),
            1,
            "completing a task must not remove its planned time block"
        );
        database.delete_personal_task(&task.id).unwrap();
        let block_count: i64 = database
            .connection
            .query_row("SELECT COUNT(*) FROM time_blocks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(block_count, 0);
        assert_eq!(
            database
                .load_planner_events("2026-09-24", "2026-09-24")
                .unwrap()
                .len(),
            1,
            "deleting a task must not affect independent PlannerEvents"
        );
    }

    #[test]
    fn personal_task_storage_rejects_invalid_deadlines_and_completion_state() {
        let database = database();
        let mut invalid = personal_task("invalid-time-only");
        invalid.deadline_date = None;
        invalid.deadline_time = Some("09:30".into());
        assert!(database.create_personal_task(&invalid).is_err());

        invalid.id = "invalid-date".into();
        invalid.deadline_time = None;
        invalid.deadline_date = Some("2026-02-30".into());
        assert!(database.create_personal_task(&invalid).is_err());

        invalid.id = "invalid-completion".into();
        invalid.deadline_date = None;
        invalid.status = PersonalTaskStatus::Completed;
        invalid.completed_at = None;
        assert!(database.create_personal_task(&invalid).is_err());
        assert!(database.load_personal_tasks().unwrap().is_empty());
    }

    fn create_populated_schema_five_database(path: &Path) {
        let database = CourseDatabase::open(path).expect("create synthetic schema six database");
        database.insert_course(&course()).expect("seed course");
        database
            .save_period_times(&[PeriodTime {
                period: 1,
                start_time: "08:00".into(),
                end_time: "08:45".into(),
            }])
            .expect("seed period time");
        database
            .connection
            .execute_batch(
                "INSERT INTO semesters
                    (id, name, first_week_monday, total_weeks, timezone, status, created_at, updated_at)
                 VALUES ('semester-id', '2026 秋季学期', '2026-09-07', 16,
                         'Asia/Shanghai', 'ACTIVE', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
                 INSERT INTO course_overrides
                    (id, course_id, semester_id, kind, original_occurrence_key, original_date,
                     target_date, start_period, end_period, start_time, end_time, classroom,
                     teacher, note, active, created_at, updated_at)
                 VALUES ('override-id', 'course-id', 'semester-id', 'MODIFY', 'occurrence-key',
                         '2026-09-24', NULL, NULL, NULL, NULL, NULL, 'JX05-101', NULL, NULL,
                         1, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
                 INSERT INTO academic_tasks
                    (id, semester_id, course_id, type, title, note, due_at, priority, status,
                     completed_at, created_at, updated_at)
                 VALUES ('academic-task-id', 'semester-id', 'course-id', 'ASSIGNMENT',
                         '已有学业事项', NULL, '2026-09-25T18:00:00+08:00', 1, 'TODO', NULL,
                         '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
                 INSERT INTO exams
                    (id, semester_id, course_id, title, starts_at, ends_at, location, seat_info,
                     note, status, created_at, updated_at)
                 VALUES ('exam-id', 'semester-id', 'course-id', '已有考试',
                         '2026-12-20T09:00:00+08:00', '2026-12-20T11:00:00+08:00',
                         '考场 A', NULL, NULL, 'SCHEDULED',
                         '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
                 INSERT INTO reminder_rules
                    (id, target_type, target_id, offsets_minutes, enabled, created_at, updated_at)
                 VALUES ('rule-id', 'COURSE', 'course-id', '[15]', 1,
                         '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
                 INSERT INTO reminder_instances
                    (id, rule_id, occurrence_key, trigger_at_milliseconds, status, handled_at_milliseconds)
                 VALUES ('instance-id', 'rule-id', 'occurrence-key', 1000, 'PENDING', NULL);
                 INSERT INTO handled_reminders (occurrence_key, handled_at_milliseconds)
                 VALUES ('handled-key', 1000);
                 INSERT INTO app_settings (key, value)
                 VALUES ('reminder_settings', '{\"enabled\":false,\"advanceMinutes\":15}');
                 DROP TABLE time_blocks;
                 DROP TABLE planner_events;
                 DROP TABLE personal_tasks;
                 DROP TABLE routines;
                 DROP TABLE inbox_items;
                 DROP TABLE diary_entries;
                 DROP TABLE daily_summaries;
                 PRAGMA user_version = 5;",
            )
            .expect("seed schema five data and downgrade synthetic database");
    }

    fn create_populated_schema_six_database(path: &Path) {
        create_populated_schema_five_database(path);
        {
            let database = CourseDatabase::open(path).expect("prepare schema six fixture");
            let task = personal_task("migration-task");
            database
                .create_personal_task(&task)
                .expect("seed personal task");
            database
                .create_planner_event(&planner_event("migration-event", "2026-09-24"))
                .expect("seed planner event");
            database
                .create_time_block(&time_block("migration-block", &task.id, "2026-09-24"))
                .expect("seed time block");
        }
        if let Some(parent) = path.parent() {
            let backup_directory = parent.join("backups");
            if backup_directory.exists() {
                fs::remove_dir_all(backup_directory).expect("remove intermediate fixture backup");
            }
        }
        let connection = Connection::open(path).expect("open schema six fixture");
        connection
            .execute_batch(
                "DROP TABLE routines;
                 DROP TABLE inbox_items;
                 DROP TABLE diary_entries;
                 DROP TABLE daily_summaries;
                 PRAGMA user_version = 6;",
            )
            .expect("mark fixture as schema six");
    }

    fn create_schema_six_database_with_phase_three_objects(path: &Path, retained: &[&str]) {
        create_populated_schema_six_database(path);
        let mut connection = Connection::open(path).expect("open schema six drift fixture");
        connection
            .execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .expect("configure schema six drift fixture");
        migrate_schema_six_to_seven(&mut connection).expect("create canonical schema seven");
        connection
            .execute_batch(
                "INSERT INTO diary_entries
                    (id, entry_date, body, created_at, updated_at)
                 VALUES ('drift-diary', '2026-09-24', 'sentinel', 'now', 'now');
                 INSERT INTO inbox_items (id, raw_text, status, created_at, updated_at)
                 VALUES ('drift-inbox', 'sentinel', 'pending', 'now', 'now');
                 INSERT INTO routines
                    (id, title, target_duration_minutes, weekdays_mask, enabled, created_at, updated_at)
                 VALUES ('drift-routine', 'sentinel', 30, 1, 1, 'now', 'now');",
            )
            .expect("seed Phase 3 sentinel records");
        for table in ["routines", "inbox_items", "diary_entries"] {
            if !retained.contains(&table) {
                connection
                    .execute_batch(&format!("DROP TABLE {table};"))
                    .expect("remove unretained drift table");
            }
        }
        connection
            .pragma_update(None, "user_version", SCHEMA_SIX_VERSION)
            .expect("mark fixture with stale schema version");
    }

    fn migration_backups(root: &Path) -> Vec<PathBuf> {
        let directory = root.join("backups").join("migrations");
        if !directory.is_dir() {
            return Vec::new();
        }
        fs::read_dir(directory)
            .expect("list migration backups")
            .map(|entry| entry.expect("read migration backup entry").path())
            .collect()
    }

    fn remove_database_files(path: &Path) {
        let had_database_files = path.exists()
            || PathBuf::from(format!("{}-wal", path.display())).exists()
            || PathBuf::from(format!("{}-shm", path.display())).exists();
        let _ = fs::remove_file(path);
        let _ = fs::remove_file(format!("{}-wal", path.display()));
        let _ = fs::remove_file(format!("{}-shm", path.display()));
        if had_database_files {
            if let Some(parent) = path.parent() {
                if parent.starts_with(std::env::temp_dir())
                    && parent
                        .file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| name.starts_with("ntu-course-assistant-"))
                {
                    let _ = fs::remove_dir_all(parent);
                }
            }
        }
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
        assert_eq!(migrated.schema_version().expect("schema version"), 8);
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
        assert_eq!(database.schema_version().expect("schema version"), 8);
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
    fn fresh_database_starts_at_schema_eight_without_a_migration_backup() {
        let root = isolated_database_root();
        let path = root.join("courses.sqlite3");
        {
            let database = CourseDatabase::open(&path).expect("create fresh database");
            assert_eq!(database.schema_version().expect("schema version"), 8);
        }
        {
            let database = CourseDatabase::open(&path).expect("reopen schema eight database");
            assert_eq!(database.schema_version().expect("schema version"), 8);
        }
        assert!(migration_backups(&root).is_empty());
        fs::remove_dir_all(root).expect("remove fresh database fixture");
    }

    #[test]
    fn valid_schema_eight_reopens_without_reapplying_phase_three_migration() {
        let root = isolated_database_root();
        let path = root.join("courses.sqlite3");
        {
            let database = CourseDatabase::open(&path).expect("create schema eight database");
            database
                .save_diary_entry(&diary_entry("kept-diary", "2026-09-24", "kept", "now"))
                .expect("seed schema seven diary");
            database
                .create_inbox_item("kept-inbox", "kept", "now")
                .expect("seed schema seven inbox");
        }
        let reopened = CourseDatabase::open(&path).expect("reopen schema eight database");
        assert_eq!(reopened.schema_version().expect("schema version"), 8);
        assert_eq!(
            reopened
                .load_diary_entry("2026-09-24")
                .expect("load schema seven diary")
                .expect("diary retained")
                .id,
            "kept-diary"
        );
        assert_eq!(
            reopened
                .load_inbox_items()
                .expect("load schema seven inbox")[0]
                .id,
            "kept-inbox"
        );
        assert!(migration_backups(&root).is_empty());
        drop(reopened);
        fs::remove_dir_all(root).expect("remove schema seven reopen fixture");
    }

    #[test]
    fn schema_six_with_preexisting_phase_three_objects_is_rejected_without_data_loss() {
        for retained in [
            vec!["diary_entries"],
            vec!["diary_entries", "inbox_items"],
            vec!["diary_entries", "inbox_items", "routines"],
        ] {
            let root = isolated_database_root();
            let path = root.join("courses.sqlite3");
            create_schema_six_database_with_phase_three_objects(&path, &retained);

            let error = match CourseDatabase::open(&path) {
                Ok(_) => panic!("unverified Phase 3 schema drift must be rejected"),
                Err(error) => error,
            };
            let message = error.to_string();
            assert!(message.contains("schema 6 与已存在的 Phase 3"), "{message}");
            assert!(message.contains("拒绝自动恢复"), "{message}");

            let connection = Connection::open(&path).expect("reopen rejected drift fixture");
            assert_eq!(
                connection
                    .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                    .expect("drift version remains"),
                SCHEMA_SIX_VERSION
            );
            validate_schema_six(&connection).expect("source schema six remains valid");
            for table in ["diary_entries", "inbox_items", "routines"] {
                let exists: bool = connection
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                        [table],
                        |row| row.get(0),
                    )
                    .expect("check existing drift table");
                assert_eq!(exists, retained.contains(&table), "{table}");
                if exists {
                    assert_eq!(
                        connection
                            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                                .get::<_, i64>(0))
                            .expect("Phase 3 sentinel preserved"),
                        1,
                        "{table} data must remain untouched"
                    );
                }
            }
            for table in ["personal_tasks", "planner_events", "time_blocks"] {
                assert_eq!(
                    connection
                        .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                            .get::<_, i64>(0))
                        .expect("Phase 2 data remains"),
                    1,
                    "{table} data must remain untouched"
                );
            }
            drop(connection);

            let backups = migration_backups(&root);
            assert_eq!(backups.len(), 1);
            let backup = Connection::open(&backups[0]).expect("open preserved source backup");
            assert_eq!(
                backup
                    .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                    .expect("backup version"),
                SCHEMA_SIX_VERSION
            );
            validate_integrity(&backup).expect("backup is reopenable and valid");
            drop(backup);
            fs::remove_dir_all(root).expect("remove drift fixture");
        }
    }

    #[test]
    fn schema_six_with_mismatched_preexisting_diary_table_is_rejected_unchanged() {
        let root = isolated_database_root();
        let path = root.join("courses.sqlite3");
        create_populated_schema_six_database(&path);
        let connection = Connection::open(&path).expect("open mismatched drift fixture");
        connection
            .execute_batch(
                "CREATE TABLE diary_entries (id TEXT PRIMARY KEY, body TEXT NOT NULL);
                 INSERT INTO diary_entries VALUES ('mismatched-diary', 'keep');",
            )
            .expect("create mismatched preexisting table");
        drop(connection);

        assert!(CourseDatabase::open(&path).is_err());
        let connection = Connection::open(&path).expect("reopen rejected mismatch");
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .expect("version remains six"),
            SCHEMA_SIX_VERSION
        );
        let sql: String = connection
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='diary_entries'",
                [],
                |row| row.get(0),
            )
            .expect("mismatched schema remains untouched");
        assert_eq!(
            sql,
            "CREATE TABLE diary_entries (id TEXT PRIMARY KEY, body TEXT NOT NULL)"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT body FROM diary_entries WHERE id='mismatched-diary'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .expect("mismatched table data remains"),
            "keep"
        );
        drop(connection);
        assert_eq!(migration_backups(&root).len(), 1);
        fs::remove_dir_all(root).expect("remove mismatched fixture");
    }

    #[test]
    fn schema_six_migration_preserves_phase_two_data_and_verified_source_backup() {
        let root = isolated_database_root();
        let path = root.join("courses.sqlite3");
        create_populated_schema_six_database(&path);

        let migrated = CourseDatabase::open(&path).expect("migrate schema six database");
        assert_eq!(migrated.schema_version().expect("schema version"), 8);
        validate_schema_eight(&migrated.connection).expect("schema eight integrity");
        assert_eq!(
            migrated.load_courses().expect("courses").courses,
            vec![course()]
        );
        assert_eq!(
            migrated
                .load_personal_tasks()
                .expect("personal tasks")
                .len(),
            1
        );
        assert_eq!(
            migrated
                .load_planner_events("2026-09-24", "2026-09-24")
                .expect("events")
                .len(),
            1
        );
        assert_eq!(
            migrated
                .load_time_blocks("2026-09-24", "2026-09-24")
                .expect("time blocks")
                .len(),
            1
        );
        assert!(migrated
            .load_diary_entry("2026-09-24")
            .expect("new diary table")
            .is_none());
        for table in [
            "semesters",
            "course_overrides",
            "academic_tasks",
            "exams",
            "reminder_rules",
            "reminder_instances",
        ] {
            let count: i64 = migrated
                .connection
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("count preserved Academic table");
            assert_eq!(count, 1, "{table} data should be preserved");
        }

        let backups = migration_backups(&root);
        assert_eq!(backups.len(), 1);
        assert!(backups[0]
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("courses-v6-to-v8-"));
        let backup = Connection::open(&backups[0]).expect("open schema six backup");
        assert_eq!(
            backup
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .expect("backup version"),
            6
        );
        validate_schema_six(&backup).expect("verified schema six backup");
        assert_eq!(
            backup
                .query_row("SELECT count(*) FROM time_blocks", [], |row| row
                    .get::<_, i64>(0))
                .expect("backup time block"),
            1
        );
        drop(backup);
        drop(migrated);
        fs::remove_dir_all(root).expect("remove schema six migration fixture");
    }

    #[test]
    fn schema_seven_migration_rolls_back_tables_and_version_after_failure() {
        let root = isolated_database_root();
        let path = root.join("courses.sqlite3");
        create_populated_schema_six_database(&path);
        let mut connection = Connection::open(&path).expect("open rollback fixture");
        connection
            .execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .expect("configure rollback connection");
        create_validated_migration_backup(&connection, &root, 6).expect("create source backup");

        let error = migrate_schema_six_to_seven_with_hook(&mut connection, || {
            Err(StorageError::InvalidData("注入迁移失败".into()))
        })
        .expect_err("injected failure must abort migration");
        assert!(matches!(error, StorageError::InvalidData(_)));
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .expect("rollback version"),
            6
        );
        for table in ["diary_entries", "inbox_items", "routines"] {
            let count: i64 = connection
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |row| row.get(0),
                )
                .expect("check absent table");
            assert_eq!(count, 0, "{table} must be rolled back");
        }
        for table in ["personal_tasks", "planner_events", "time_blocks"] {
            let count: i64 = connection
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("preserved Phase 2 rows");
            assert_eq!(count, 1, "{table} data must be preserved");
        }
        validate_schema_six(&connection).expect("source schema remains valid");
        let backup =
            Connection::open(migration_backups(&root).remove(0)).expect("reopen source backup");
        validate_schema_six(&backup).expect("source backup remains valid");
        drop(backup);
        drop(connection);
        fs::remove_dir_all(root).expect("remove rollback fixture");
    }

    #[test]
    fn diary_entries_upsert_by_date_and_survive_reopen_without_logging_text() {
        let path = temporary_database_path();
        remove_database_files(&path);
        let first = diary_entry(
            "diary-a",
            "2026-09-24",
            "private first text",
            "2026-09-24T01:00:00Z",
        );
        {
            let database = CourseDatabase::open(&path).expect("create diary database");
            assert!(database.save_diary_entry(&first).expect("save diary entry") == first);
            assert!(database
                .has_diary_entry("2026-09-24")
                .expect("check diary status"));
            let mut updated = diary_entry(
                "diary-b",
                "2026-09-24",
                "private updated text",
                "2026-09-24T02:00:00Z",
            );
            updated.created_at = "2026-09-24T02:00:00Z".into();
            let saved = database
                .save_diary_entry(&updated)
                .expect("upsert existing date");
            assert_eq!(saved.id, first.id);
            assert_eq!(saved.created_at, first.created_at);
            assert_eq!(saved.body, updated.body);
            assert_eq!(
                database.load_diary_content_dates().expect("content dates"),
                vec!["2026-09-24"]
            );
        }
        let reopened = CourseDatabase::open(&path).expect("reopen diary database");
        let loaded = reopened
            .load_diary_entry("2026-09-24")
            .expect("load diary entry")
            .expect("entry exists");
        assert_eq!(loaded.body, "private updated text");
        assert!(!reopened
            .has_diary_entry("2026-09-25")
            .expect("empty date status"));
        assert!(reopened.load_diary_entry("2026-02-30").is_err());
        reopened
            .save_diary_entry(&diary_entry(
                "diary-empty",
                "2026-09-25",
                "   ",
                "2026-09-25T01:00:00Z",
            ))
            .expect("save blank entry without exposing it as recorded");
        assert!(!reopened
            .has_diary_entry("2026-09-25")
            .expect("blank status"));
        assert_eq!(
            reopened.load_diary_content_dates().expect("content dates"),
            vec!["2026-09-24"]
        );
        let searchable_entries = reopened
            .load_diary_entries_for_search()
            .expect("load local diary search entries");
        assert!(searchable_entries.len() == 1 && searchable_entries[0] == loaded);
        drop(reopened);
        remove_database_files(&path);
    }

    #[test]
    fn inbox_preserves_raw_before_parse_and_counts_only_unresolved_items() {
        let database = database();
        let raw = database
            .create_inbox_item("inbox-raw", "任务：整理材料", "2026-09-24T08:00:00Z")
            .expect("persist raw capture first");
        assert_eq!(raw.status, "pending");
        assert!(raw.parse_kind.is_none());
        assert_eq!(raw.raw_text, "任务：整理材料");
        assert_eq!(database.count_pending_inbox_items().unwrap(), 1);

        let parsed = database
            .save_inbox_parse_result(
                "inbox-raw",
                "task",
                r#"{"kind":"task","title":"整理材料"}"#,
                "inbox-parser-v1",
                "2026-09-24T08:00:01Z",
            )
            .expect("save local parse result");
        assert_eq!(parsed.status, "ready");
        assert_eq!(parsed.raw_text, "任务：整理材料");
        assert_eq!(database.count_pending_inbox_items().unwrap(), 1);

        database
            .dismiss_inbox_item("inbox-raw", "2026-09-24T08:01:00Z")
            .expect("dismiss item");
        assert_eq!(database.count_pending_inbox_items().unwrap(), 0);
        assert_eq!(database.load_inbox_items().unwrap()[0].status, "dismissed");
    }

    #[test]
    fn inbox_confirm_is_transactional_idempotent_and_delete_keeps_target() {
        let database = database();
        database
            .create_inbox_item("inbox-task", "任务：准备材料", "2026-09-24T08:00:00Z")
            .unwrap();
        database
            .save_inbox_parse_result(
                "inbox-task",
                "task",
                r#"{"kind":"task","title":"准备材料"}"#,
                "inbox-parser-v1",
                "2026-09-24T08:00:01Z",
            )
            .unwrap();
        let task = personal_task("inbox-created-task");
        let first = database
            .confirm_inbox_as_task("inbox-task", &task)
            .expect("create task and confirm inbox atomically");
        let mut invalid_repeat = personal_task("invalid-repeat");
        invalid_repeat.title.clear();
        let second = database
            .confirm_inbox_as_task("inbox-task", &invalid_repeat)
            .expect("repeated confirmation is idempotent");
        assert_eq!(first, second);
        assert_eq!(first.target_type, "personalTask");
        assert_eq!(database.load_personal_tasks().unwrap().len(), 1);

        database
            .create_inbox_item("inbox-wrong-kind", "raw only", "2026-09-24T08:00:00Z")
            .unwrap();
        database
            .save_inbox_parse_result(
                "inbox-wrong-kind",
                "event",
                r#"{"kind":"event","title":"raw only"}"#,
                "inbox-parser-v1",
                "2026-09-24T08:00:01Z",
            )
            .unwrap();
        assert!(database
            .confirm_inbox_as_task("inbox-wrong-kind", &personal_task("wrong-kind-task"))
            .is_err());
        assert_eq!(database.load_personal_tasks().unwrap().len(), 1);
        assert_eq!(
            database
                .load_inbox_item("inbox-task")
                .unwrap()
                .unwrap()
                .status,
            "confirmed"
        );

        database
            .delete_inbox_item("inbox-task")
            .expect("delete raw inbox row without cascading");
        assert_eq!(database.load_personal_tasks().unwrap().len(), 1);

        database
            .create_inbox_item("inbox-event", "日程：讨论", "2026-09-24T08:00:00Z")
            .unwrap();
        database
            .save_inbox_parse_result(
                "inbox-event",
                "event",
                r#"{"kind":"event","title":"讨论"}"#,
                "inbox-parser-v1",
                "2026-09-24T08:00:01Z",
            )
            .unwrap();
        database
            .confirm_inbox_as_event(
                "inbox-event",
                &planner_event("inbox-event-target", "2026-09-25"),
            )
            .unwrap();
        database.delete_inbox_item("inbox-event").unwrap();
        assert_eq!(
            database
                .load_planner_events("2026-09-25", "2026-09-25")
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn ai_inbox_confirmation_accepts_unparsed_and_ambiguous_items_without_changing_raw_text() {
        let database = database();
        database
            .create_inbox_item("ai-pending-task", "任务：复习材料", "2026-09-24T08:00:00Z")
            .unwrap();
        let task = personal_task("ai-task-target");
        database
            .confirm_inbox_as_task("ai-pending-task", &task)
            .expect("confirmed AI task proposal can atomically use a fresh Inbox capture");
        let confirmed_task = database
            .load_inbox_item("ai-pending-task")
            .unwrap()
            .unwrap();
        assert_eq!(confirmed_task.raw_text, "任务：复习材料");
        assert_eq!(confirmed_task.status, "confirmed");
        assert_eq!(confirmed_task.parse_kind, None);

        database
            .create_inbox_item("ai-ambiguous-event", "周末去图书馆", "2026-09-24T08:00:00Z")
            .unwrap();
        database
            .save_inbox_parse_result(
                "ai-ambiguous-event",
                "unknown",
                r#"{"kind":"unknown","title":"周末去图书馆"}"#,
                "inbox-parser-v1",
                "2026-09-24T08:00:01Z",
            )
            .unwrap();
        let event = planner_event("ai-event-target", "2026-09-26");
        database
            .confirm_inbox_as_event("ai-ambiguous-event", &event)
            .expect("confirmed AI event proposal can resolve an ambiguous Inbox capture");
        let confirmed_event = database
            .load_inbox_item("ai-ambiguous-event")
            .unwrap()
            .unwrap();
        assert_eq!(confirmed_event.raw_text, "周末去图书馆");
        assert_eq!(confirmed_event.status, "confirmed");
        assert_eq!(confirmed_event.parse_kind.as_deref(), Some("unknown"));
        assert_eq!(database.load_personal_tasks().unwrap().len(), 1);
        assert_eq!(
            database
                .load_planner_events("2026-09-26", "2026-09-26")
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn inbox_event_confirmation_and_failed_confirmation_roll_back_target() {
        let database = database();
        database
            .create_inbox_item("inbox-event", "日程：明天开会", "2026-09-24T08:00:00Z")
            .unwrap();
        database
            .save_inbox_parse_result(
                "inbox-event",
                "event",
                r#"{"kind":"event","title":"明天开会"}"#,
                "inbox-parser-v1",
                "2026-09-24T08:00:01Z",
            )
            .unwrap();
        let event = planner_event("inbox-created-event", "2026-09-25");
        let confirmed = database
            .confirm_inbox_as_event("inbox-event", &event)
            .expect("create event and confirm inbox");
        assert_eq!(confirmed.target_type, "plannerEvent");
        assert_eq!(
            database
                .load_planner_events("2026-09-25", "2026-09-25")
                .unwrap()
                .len(),
            1
        );

        database
            .create_inbox_item("inbox-rollback", "日程：测试", "2026-09-24T08:00:00Z")
            .unwrap();
        database
            .save_inbox_parse_result(
                "inbox-rollback",
                "task",
                r#"{"kind":"task","title":"测试"}"#,
                "inbox-parser-v1",
                "2026-09-24T08:00:01Z",
            )
            .unwrap();
        database
            .connection
            .execute_batch(
                "CREATE TRIGGER fail_inbox_confirm
                 BEFORE UPDATE OF status ON inbox_items
                 WHEN NEW.status = 'confirmed'
                 BEGIN SELECT RAISE(ABORT, 'test rollback'); END;",
            )
            .unwrap();
        assert!(database
            .confirm_inbox_as_task("inbox-rollback", &personal_task("rollback-task"))
            .is_err());
        let task_count: i64 = database
            .connection
            .query_row(
                "SELECT count(*) FROM personal_tasks WHERE id = 'rollback-task'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(task_count, 0);
        assert_eq!(
            database
                .load_inbox_item("inbox-rollback")
                .unwrap()
                .unwrap()
                .status,
            "ready"
        );
    }

    #[test]
    fn inbox_rejects_invalid_parse_and_cannot_confirm_dismissed_item() {
        let database = database();
        database
            .create_inbox_item("inbox-invalid", "some raw", "2026-09-24T08:00:00Z")
            .unwrap();
        assert!(database
            .save_inbox_parse_result("inbox-invalid", "unknown", "not json", "v1", "now")
            .is_err());
        database
            .dismiss_inbox_item("inbox-invalid", "2026-09-24T08:01:00Z")
            .unwrap();
        assert!(database
            .confirm_inbox_as_task("inbox-invalid", &personal_task("dismissed-task"))
            .is_err());
        assert!(database.load_personal_tasks().unwrap().is_empty());
    }

    #[test]
    fn schema_seven_enforces_personal_context_constraints() {
        let database = database();
        let entry = diary_entry("unique-date", "2026-09-24", "local body", "now");
        database
            .save_diary_entry(&entry)
            .expect("insert unique date");
        assert!(database
            .connection
            .execute(
                "INSERT INTO diary_entries (id, entry_date, body, created_at, updated_at)
                 VALUES ('duplicate-date', '2026-09-24', 'another', 'now', 'now')",
                [],
            )
            .is_err());
        assert!(database
            .connection
            .execute(
                "INSERT INTO inbox_items (id, raw_text, status, created_at, updated_at)
                 VALUES ('invalid-inbox', '  ', 'pending', 'now', 'now')",
                [],
            )
            .is_err());
        assert!(database
            .connection
            .execute(
                "INSERT INTO inbox_items (id, raw_text, status, created_at, updated_at)
                 VALUES ('invalid-status', 'capture', 'unknown-status', 'now', 'now')",
                [],
            )
            .is_err());
        for (id, duration, weekdays, start, end) in [
            ("short", 4, 1, None, None),
            ("no-weekday", 30, 0, None, None),
            ("half-window", 30, 1, Some("09:00"), None),
            ("invalid-clock", 30, 1, Some("99:00"), Some("99:30")),
        ] {
            assert!(
                database
                    .connection
                    .execute(
                        "INSERT INTO routines
                     (id, title, target_duration_minutes, weekdays_mask, preferred_start_time,
                      preferred_end_time, enabled, created_at, updated_at)
                     VALUES (?1, 'Routine', ?2, ?3, ?4, ?5, 1, 'now', 'now')",
                        params![id, duration, weekdays, start, end],
                    )
                    .is_err(),
                "invalid routine case {id} should fail"
            );
        }
    }

    fn diary_entry(id: &str, date: &str, body: &str, timestamp: &str) -> DiaryEntry {
        DiaryEntry {
            id: id.into(),
            entry_date: date.into(),
            body: body.into(),
            created_at: timestamp.into(),
            updated_at: timestamp.into(),
        }
    }

    fn daily_summary(id: &str, date: &str, overview: &str, timestamp: &str) -> DailySummary {
        DailySummary {
            id: id.into(),
            summary_date: date.into(),
            overview: overview.into(),
            highlights: vec!["完成一项重要事项".into()],
            unfinished: vec!["继续推进未完成事项".into()],
            tomorrow_notes: vec!["准备明日材料".into()],
            created_at: timestamp.into(),
            updated_at: timestamp.into(),
            revision: 1,
        }
    }

    fn downgrade_empty_schema_eight_to_seven(path: &Path) {
        let database = CourseDatabase::open(path).expect("create schema eight fixture");
        drop(database);
        let connection = Connection::open(path).expect("open schema eight fixture");
        connection
            .execute_batch("DROP TABLE daily_summaries; PRAGMA user_version = 7;")
            .expect("prepare canonical schema seven fixture");
    }

    #[test]
    fn schema_seven_migrates_to_eight_with_existing_data_and_verified_backup() {
        let root = isolated_database_root();
        let path = root.join("courses.sqlite3");
        {
            let database = CourseDatabase::open(&path).expect("create source database");
            database.insert_course(&course()).expect("seed course");
            database
                .save_diary_entry(&diary_entry("migration-diary", "2026-09-24", "keep", "now"))
                .expect("seed diary entry");
        }
        downgrade_empty_schema_eight_to_seven(&path);
        let source = Connection::open(&path).expect("open schema seven fixture for seeding");
        source
            .execute_batch(
                "INSERT INTO personal_tasks
                    (id, title, status, priority, created_at, updated_at)
                 VALUES ('migration-task', '保留个人任务', 'OPEN', 'MEDIUM', 'created', 'updated');
                 INSERT INTO planner_events
                    (id, title, date, start_time, end_time, buffer_before_minutes,
                     buffer_after_minutes, created_at, updated_at)
                 VALUES ('migration-event', '保留日程', '2026-09-24', '10:00', '11:00', 0, 0, 'created', 'updated');
                 INSERT INTO time_blocks
                    (id, personal_task_id, date, start_time, end_time,
                     buffer_before_minutes, buffer_after_minutes, created_at, updated_at)
                 VALUES ('migration-block', 'migration-task', '2026-09-24', '13:00', '14:00', 0, 0, 'created', 'updated');
                 INSERT INTO inbox_items (id, raw_text, status, created_at, updated_at)
                 VALUES ('migration-inbox', '保留收件箱条目', 'pending', 'created', 'updated');
                 INSERT INTO routines
                    (id, title, target_duration_minutes, weekdays_mask, enabled, created_at, updated_at)
                 VALUES ('migration-routine', '保留日常习惯', 30, 127, 1, 'created', 'updated');
                 INSERT INTO semesters
                    (id, name, first_week_monday, total_weeks, timezone, status, created_at, updated_at)
                 VALUES ('migration-semester', '旧学期', '2026-09-21', 16, 'Asia/Shanghai', 'ARCHIVED', 'created', 'updated');
                 INSERT INTO academic_tasks
                    (id, semester_id, type, title, due_at, priority, status, created_at, updated_at)
                 VALUES ('migration-academic-task', 'migration-semester', 'ASSIGNMENT', '保留学业任务',
                         '2026-09-25T12:00:00+08:00', 1, 'TODO', 'created', 'updated');
                 INSERT INTO app_settings (key, value) VALUES ('migration-context-fixture', 'keep');
                 INSERT INTO handled_reminders (occurrence_key, handled_at_milliseconds)
                 VALUES ('migration-reminder', 12345);",
            )
            .expect("seed schema seven records across existing data domains");
        drop(source);

        let migrated = CourseDatabase::open(&path).expect("migrate schema seven to eight");
        assert_eq!(migrated.schema_version().expect("schema version"), 8);
        assert_eq!(
            migrated.load_courses().expect("courses").courses,
            vec![course()]
        );
        assert_eq!(
            migrated
                .load_diary_entry("2026-09-24")
                .expect("load preserved diary")
                .expect("diary remains")
                .body,
            "keep"
        );
        assert!(migrated
            .load_daily_summary("2026-09-24")
            .expect("new summary table")
            .is_none());
        for table in [
            "personal_tasks",
            "planner_events",
            "time_blocks",
            "diary_entries",
            "inbox_items",
            "routines",
            "academic_tasks",
            "app_settings",
            "handled_reminders",
        ] {
            let count: i64 = migrated
                .connection
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("count schema seven data after migration");
            assert_eq!(count, 1, "schema seven {table} data must be preserved");
        }
        validate_schema_eight(&migrated.connection).expect("schema eight validates");

        let backups = migration_backups(&root);
        assert_eq!(backups.len(), 1);
        assert!(backups[0]
            .file_name()
            .expect("backup filename")
            .to_string_lossy()
            .starts_with("courses-v7-to-v8-"));
        let backup = Connection::open(&backups[0]).expect("open pre-migration backup");
        validate_schema_seven(&backup).expect("backup remains valid schema seven");
        assert_eq!(
            backup
                .query_row("SELECT name FROM courses WHERE id='course-id'", [], |row| {
                    row.get::<_, String>(0)
                })
                .expect("backup course remains"),
            "机械设计基础"
        );
        drop(backup);
        drop(migrated);
        fs::remove_dir_all(root).expect("remove schema seven migration fixture");
    }

    #[test]
    fn schema_seven_to_eight_failure_rolls_back_table_and_version() {
        let root = isolated_database_root();
        let path = root.join("courses.sqlite3");
        downgrade_empty_schema_eight_to_seven(&path);
        let mut connection = Connection::open(&path).expect("open schema seven rollback fixture");

        let error = migrate_schema_seven_to_eight_with_hook(&mut connection, || {
            Err(StorageError::InvalidData("注入迁移失败".into()))
        })
        .expect_err("injected failure aborts migration");
        assert!(matches!(error, StorageError::InvalidData(_)));
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .expect("source version retained"),
            7
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='daily_summaries'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("target table absent"),
            0
        );
        validate_schema_seven(&connection).expect("schema seven remains valid");
        drop(connection);
        fs::remove_dir_all(root).expect("remove rollback fixture");
    }

    #[test]
    fn schema_seven_with_unexpected_daily_summary_table_is_rejected_without_overwrite() {
        let root = isolated_database_root();
        let path = root.join("courses.sqlite3");
        downgrade_empty_schema_eight_to_seven(&path);
        let mut connection = Connection::open(&path).expect("open partial migration fixture");
        connection
            .execute_batch("CREATE TABLE daily_summaries (unexpected TEXT NOT NULL);")
            .expect("simulate partial schema eight table");

        let error = migrate_schema_seven_to_eight(&mut connection)
            .expect_err("partial migration must be rejected");
        assert!(matches!(error, StorageError::InvalidData(_)));
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .expect("source version stays seven"),
            7
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM pragma_table_info('daily_summaries')",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("unexpected table remains untouched"),
            1
        );
        drop(connection);
        fs::remove_dir_all(root).expect("remove partial migration fixture");
    }

    #[test]
    fn schema_eight_rejects_missing_or_weak_daily_summary_date_constraint() {
        let missing = database();
        missing
            .connection
            .execute_batch("DROP TABLE daily_summaries;")
            .expect("remove required schema eight table");
        assert!(validate_schema_eight(&missing.connection).is_err());

        let composite = database();
        composite
            .connection
            .execute_batch(
                "DROP TABLE daily_summaries;
                 CREATE TABLE daily_summaries (
                    id TEXT PRIMARY KEY NOT NULL,
                    summary_date TEXT NOT NULL,
                    overview TEXT NOT NULL,
                    highlights_json TEXT NOT NULL,
                    unfinished_json TEXT NOT NULL,
                    tomorrow_notes_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    UNIQUE(summary_date, id)
                 );",
            )
            .expect("create weak composite uniqueness fixture");
        assert!(validate_schema_eight(&composite.connection).is_err());
    }

    #[test]
    fn daily_summary_upserts_one_record_per_date_and_survives_reopen() {
        let root = isolated_database_root();
        let path = root.join("courses.sqlite3");
        let original = daily_summary("summary-first", "2026-09-24", "今天完成了计划。", "t1");
        {
            let database = CourseDatabase::open(&path).expect("create summary database");
            let saved = database
                .save_daily_summary(&original)
                .expect("save new summary");
            assert!(saved == original);
            let mut edited = daily_summary("ignored-new-id", "2026-09-24", "更新后的总结。", "t2");
            edited.highlights = vec!["修订后的亮点".into()];
            let saved = database
                .save_daily_summary(&edited)
                .expect("update same date");
            assert_eq!(saved.id, original.id);
            assert_eq!(saved.created_at, original.created_at);
            assert_eq!(saved.updated_at, "t2");
            assert_eq!(saved.revision, 2);
            assert_eq!(saved.overview, edited.overview);
            assert_eq!(saved.highlights, edited.highlights);
        }
        let reopened = CourseDatabase::open(&path).expect("reopen summary database");
        assert_eq!(
            reopened
                .load_daily_summary("2026-09-24")
                .expect("read summary")
                .expect("saved summary exists")
                .revision,
            2
        );
        assert!(reopened.load_daily_summary("2026-02-30").is_err());
        drop(reopened);
        fs::remove_dir_all(root).expect("remove summary database fixture");
    }

    #[test]
    fn daily_summary_validates_content_and_recent_range_is_bounded_to_three() {
        let database = database();
        for day in ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27"] {
            let summary = daily_summary(&format!("summary-{day}"), day, "日总结", "now");
            database
                .save_daily_summary(&summary)
                .expect("save daily summary");
        }
        let recent = database
            .load_daily_summaries_in_range("2026-09-24", "2026-09-27")
            .expect("load bounded range");
        assert_eq!(recent.len(), 3);
        assert_eq!(recent[0].summary_date, "2026-09-27");
        assert_eq!(recent[2].summary_date, "2026-09-25");
        assert!(database
            .load_daily_summaries_in_range("2026-09-28", "2026-09-24")
            .is_err());

        let mut invalid = daily_summary("invalid-summary", "2026-09-28", " ", "now");
        assert!(database.save_daily_summary(&invalid).is_err());
        invalid.overview = "有效概览".into();
        invalid.unfinished = vec![" ".into()];
        assert!(database.save_daily_summary(&invalid).is_err());
        assert!(database
            .load_daily_summary("2026-09-28")
            .expect("invalid summary not saved")
            .is_none());
    }

    #[test]
    fn populated_schema_five_gets_a_validated_backup_before_schema_six_migration() {
        let root = isolated_database_root();
        let path = root.join("courses.sqlite3");
        create_populated_schema_five_database(&path);

        let migrated = CourseDatabase::open(&path).expect("migrate populated schema five");
        assert_eq!(migrated.schema_version().expect("schema version"), 8);
        assert_eq!(
            migrated.load_courses().expect("courses").courses,
            vec![course()]
        );
        assert_eq!(
            migrated
                .load_period_times()
                .expect("periods")
                .unwrap()
                .len(),
            1
        );
        for table in [
            "app_settings",
            "handled_reminders",
            "semesters",
            "course_overrides",
            "academic_tasks",
            "exams",
            "reminder_rules",
            "reminder_instances",
        ] {
            let count: i64 = migrated
                .connection
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("count preserved academic table");
            assert_eq!(count, 1, "{table} data should be preserved");
        }
        for (table, key_column, expected) in [
            ("app_settings", "key", "reminder_settings"),
            ("handled_reminders", "occurrence_key", "handled-key"),
            ("semesters", "id", "semester-id"),
            ("course_overrides", "id", "override-id"),
            ("academic_tasks", "id", "academic-task-id"),
            ("exams", "id", "exam-id"),
            ("reminder_rules", "id", "rule-id"),
            ("reminder_instances", "id", "instance-id"),
        ] {
            let value: String = migrated
                .connection
                .query_row(&format!("SELECT {key_column} FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("read preserved record identity");
            assert_eq!(value, expected, "{table} record identity is preserved");
        }
        validate_schema_eight(&migrated.connection).expect("schema eight integrity");
        assert_eq!(migration_backups(&root).len(), 1);
        let backup_path = migration_backups(&root).remove(0);
        assert!(backup_path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("courses-v5-to-v8-"));
        let backup = Connection::open(&backup_path).expect("open verified backup");
        assert_eq!(
            backup
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .expect("backup version"),
            5
        );
        validate_integrity(&backup).expect("backup integrity");
        assert_eq!(
            backup
                .query_row("SELECT count(*) FROM courses", [], |row| row
                    .get::<_, i64>(0))
                .expect("backup course count"),
            1
        );
        drop(backup);
        drop(migrated);

        let reopened = CourseDatabase::open(&path).expect("reopen schema eight without migration");
        assert_eq!(reopened.schema_version().expect("reopened schema"), 8);
        assert_eq!(migration_backups(&root).len(), 1);
        drop(reopened);
        fs::remove_dir_all(root).expect("remove migration fixture");
    }

    #[test]
    fn schema_six_transaction_rolls_back_after_injected_mid_migration_failure() {
        let root = isolated_database_root();
        let path = root.join("courses.sqlite3");
        create_populated_schema_five_database(&path);
        let mut connection = Connection::open(&path).expect("open rollback fixture");
        connection
            .execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .expect("configure rollback connection");
        create_validated_migration_backup(&connection, &root, 5).expect("create rollback backup");
        let error = migrate_schema_five_to_six_with_hook(&mut connection, || {
            Err(StorageError::InvalidData(
                "injected migration failure".into(),
            ))
        })
        .expect_err("failure must abort migration");
        assert!(matches!(error, StorageError::InvalidData(_)));
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .expect("rollback version"),
            5
        );
        for table in ["personal_tasks", "planner_events"] {
            let count: i64 = connection
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .expect("check rolled back table");
            assert_eq!(count, 0, "{table} must not remain partially migrated");
        }
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM courses", [], |row| row
                    .get::<_, i64>(0))
                .expect("original course remains"),
            1
        );
        assert_eq!(migration_backups(&root).len(), 1);
        let backup = Connection::open(migration_backups(&root).remove(0))
            .expect("rollback backup remains readable");
        assert_eq!(
            backup
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .expect("backup schema version"),
            5
        );
        validate_integrity(&backup).expect("rollback backup remains valid");
        drop(backup);
        drop(connection);
        fs::remove_dir_all(root).expect("remove rollback fixture");
    }

    #[test]
    fn backup_failure_aborts_migration_without_changing_schema_five_data() {
        let root = isolated_database_root();
        let path = root.join("courses.sqlite3");
        create_populated_schema_five_database(&path);
        fs::write(root.join("backups"), "not a directory").expect("block backup directory");

        assert!(CourseDatabase::open(&path).is_err());
        let connection = Connection::open(&path).expect("reopen after backup failure");
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .expect("schema remains five"),
            5
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM courses", [], |row| row
                    .get::<_, i64>(0))
                .expect("course remains after backup failure"),
            1
        );
        assert!(migration_backups(&root).is_empty());
        drop(connection);
        fs::remove_dir_all(root).expect("remove backup failure fixture");
    }

    #[test]
    fn time_blocks_enforce_task_foreign_key_and_cascade_on_task_delete() {
        let database = database();
        let invalid = database.connection.execute(
            "INSERT INTO time_blocks
                (id, personal_task_id, date, start_time, end_time, created_at, updated_at)
             VALUES ('orphan-block', 'missing-task', '2026-09-24', '09:00', '10:00', 'now', 'now')",
            [],
        );
        assert!(invalid.is_err());

        database
            .connection
            .execute(
                "INSERT INTO personal_tasks (id, title, status, priority, created_at, updated_at)
                 VALUES ('task-id', '测试任务', 'OPEN', 'NONE', 'now', 'now')",
                [],
            )
            .expect("insert task");
        database
            .connection
            .execute(
                "INSERT INTO time_blocks
                    (id, personal_task_id, date, start_time, end_time, created_at, updated_at)
                 VALUES ('block-id', 'task-id', '2026-09-24', '09:00', '10:00', 'now', 'now')",
                [],
            )
            .expect("insert task time block");
        database
            .connection
            .execute("DELETE FROM personal_tasks WHERE id = 'task-id'", [])
            .expect("delete task");
        let remaining: i64 = database
            .connection
            .query_row("SELECT count(*) FROM time_blocks", [], |row| row.get(0))
            .expect("count cascaded time blocks");
        assert_eq!(remaining, 0);
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
            assert_eq!(database.schema_version().expect("new schema version"), 8);
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
                 PRAGMA user_version = 9;",
            )
            .expect("create future database");
        drop(connection);
        assert!(matches!(
            CourseDatabase::open(&path),
            Err(StorageError::UnsupportedSchema(9))
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
        assert_eq!(version, 9);
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
        assert_eq!(database.schema_version().expect("migrated version"), 8);
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
        assert_eq!(database.schema_version().expect("schema version"), 8);
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
        assert_eq!(database.schema_version().expect("schema version"), 8);
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
        assert_eq!(database.schema_version().expect("schema version"), 8);
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
