use std::{
    fmt,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OpenFlags, MAIN_DB};
use serde::{Deserialize, Serialize};

use crate::db::{self, CourseDatabase};

pub(crate) const LEGACY_IDENTIFIER: &str = "com.ntu-course-assistant.desktop";
#[allow(dead_code)]
pub(crate) const LEGACY_PRODUCT_NAME: &str = "NTU Course Assistant";
#[allow(dead_code)]
pub(crate) const LEGACY_EXECUTABLE_NAME: &str = "ntu-course-assistant.exe";
pub(crate) const LINKS_IDENTIFIER: &str = "com.links.workplace.desktop";
pub(crate) const LINKS_PRODUCT_NAME: &str = "Links Workplace";
const DATABASE_FILE: &str = "courses.sqlite3";
const MIGRATION_MARKER: &str = "migration-complete.json";
const STAGING_PREFIX: &str = "links-migration-staging-";
const STAGING_STATE: &str = "migration-state.json";
const STAGING_STATE_TEMP: &str = ".links-migration-state.tmp";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DataSourceClass {
    None,
    LegacySchema5,
    LegacySchema6,
    LegacySchema7,
    OldIdentifierSchema8,
    NewIdentifierSchema8,
    Conflict,
    Invalid,
}

impl DataSourceClass {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::None => "NONE",
            Self::LegacySchema5 => "LEGACY_SCHEMA_5",
            Self::LegacySchema6 => "LEGACY_SCHEMA_6",
            Self::LegacySchema7 => "LEGACY_SCHEMA_7",
            Self::OldIdentifierSchema8 => "OLD_IDENTIFIER_SCHEMA_8",
            Self::NewIdentifierSchema8 => "NEW_IDENTIFIER_SCHEMA_8",
            Self::Conflict => "CONFLICT",
            Self::Invalid => "INVALID",
        }
    }
}

#[derive(Debug)]
pub(crate) struct MigrationFailure {
    class: DataSourceClass,
    schema: Option<i64>,
    stage: &'static str,
    code: &'static str,
    backup_path: Option<PathBuf>,
}

impl MigrationFailure {
    fn new(
        class: DataSourceClass,
        schema: Option<i64>,
        stage: &'static str,
        code: &'static str,
        backup_path: Option<PathBuf>,
    ) -> Self {
        Self {
            class,
            schema,
            stage,
            code,
            backup_path,
        }
    }

    pub(crate) fn log_line(&self) -> String {
        format!(
            "[migration] source_class={} source_schema={} stage={} result=failed error_code={}",
            self.class.label(),
            self.schema
                .map_or_else(|| "unknown".into(), |v| v.to_string()),
            self.stage,
            self.code
        )
    }
}

impl fmt::Display for MigrationFailure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.class == DataSourceClass::Conflict {
            return write!(
                formatter,
                "发现多个不同的数据来源，为避免覆盖数据，Links Workplace 未自动迁移。所有旧数据均已保留。"
            );
        }
        if self.class == DataSourceClass::Invalid {
            return write!(
                formatter,
                "发现无法安全读取的本地数据库。旧数据没有被修改；请保留现有文件并先确认备份。"
            );
        }
        write!(
            formatter,
            "Links Workplace 未能在“{}”阶段安全迁移数据。旧数据库没有被修改。",
            stage_label(self.stage)
        )?;
        if let Some(path) = &self.backup_path {
            write!(formatter, " 已创建可恢复备份：{}", path.display())?;
        } else {
            formatter.write_str(" 尚未完成可验证备份。")?;
        }
        Ok(())
    }
}

fn stage_label(stage: &str) -> &'static str {
    match stage {
        "source_open" | "source_validation" | "source_revalidation" => "检查旧数据库",
        "source_backup" | "backup_validation" | "backup_directory" | "backup_persist" => {
            "创建并验证迁移备份"
        }
        "target_directory" | "staging_create" | "staging_initialize" | "staging_work_copy" => {
            "准备迁移副本"
        }
        "schema_migration" => "升级数据库格式",
        "target_validation" | "staging_checkpoint" | "staging_finalize" | "staging_validation" => {
            "验证迁移结果"
        }
        "migration_marker_write" => "记录迁移状态",
        "atomic_activation" | "activated_database_validation" => "启用迁移后的数据库",
        "staging_cleanup" => "清理未完成的迁移",
        _ => "执行数据迁移",
    }
}

impl std::error::Error for MigrationFailure {}

#[derive(Clone, Debug)]
struct SourceCandidate {
    path: PathBuf,
    identifier: &'static str,
    path_identity: &'static str,
}

#[derive(Clone, Debug)]
struct SourceInfo {
    candidate: SourceCandidate,
    schema: i64,
    class: DataSourceClass,
}

#[derive(Debug)]
struct ReleaseDataSourceDiscovery {
    class: DataSourceClass,
    source: Option<SourceInfo>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct MigrationMarker {
    format_version: u32,
    source_identifier: String,
    source_path_identity: String,
    source_schema: i64,
    target_identifier: String,
    target_schema: i64,
    completed: bool,
    completed_at_unix_milliseconds: u128,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StagingState {
    format_version: u32,
    source_identifier: String,
    target_identifier: String,
    source_schema: i64,
    state: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct MigrationRowCounts {
    pub courses: i64,
    pub period_times: i64,
    pub semesters: i64,
    pub academic_tasks: i64,
    pub personal_tasks: i64,
    pub planner_events: i64,
    pub time_blocks: i64,
    pub diary_entries: i64,
    pub inbox_items: i64,
    pub routines: i64,
}

#[derive(Clone, Debug)]
pub(crate) struct MigrationReport {
    pub source_class: DataSourceClass,
    pub source_schema: i64,
    pub target_schema: i64,
    pub schema_migrations: u8,
    pub backup_path: PathBuf,
    pub rows: MigrationRowCounts,
}

#[derive(Debug)]
pub(crate) enum InitializationOutcome {
    Fresh,
    Existing,
    Migrated(MigrationReport),
}

#[derive(Debug)]
struct StagingDirectory(PathBuf);

impl Drop for StagingDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(crate) fn prepare_release_database(
    new_identifier_directory: &Path,
    local_data_directory: &Path,
) -> Result<InitializationOutcome, MigrationFailure> {
    let new_database = new_identifier_directory.join(DATABASE_FILE);
    let legacy_database = local_data_directory
        .join(LEGACY_IDENTIFIER)
        .join(DATABASE_FILE);

    cleanup_interrupted_artifacts(new_identifier_directory)?;
    let discovery = discover_sources(
        &[SourceCandidate {
            path: legacy_database,
            identifier: LEGACY_IDENTIFIER,
            path_identity: "local-data/com.ntu-course-assistant.desktop/courses.sqlite3",
        }],
        &new_database,
        &new_identifier_directory.join(MIGRATION_MARKER),
    )?;

    match discovery.class {
        DataSourceClass::None => Ok(InitializationOutcome::Fresh),
        DataSourceClass::NewIdentifierSchema8 => Ok(InitializationOutcome::Existing),
        DataSourceClass::LegacySchema5
        | DataSourceClass::LegacySchema6
        | DataSourceClass::LegacySchema7
        | DataSourceClass::OldIdentifierSchema8 => {
            let source = discovery.source.expect("classified source must exist");
            let marker_path = new_identifier_directory.join(MIGRATION_MARKER);
            if marker_path.exists() {
                validate_stale_marker(&marker_path, &source)?;
                fs::remove_file(&marker_path).map_err(|_| {
                    MigrationFailure::new(
                        source.class,
                        Some(source.schema),
                        "stale_marker_cleanup",
                        "io",
                        None,
                    )
                })?;
            }
            migrate_and_activate(&source, new_identifier_directory)
                .map(InitializationOutcome::Migrated)
        }
        DataSourceClass::Conflict => Err(MigrationFailure::new(
            discovery.class,
            None,
            "source_discovery",
            "multiple_sources",
            None,
        )),
        DataSourceClass::Invalid => Err(MigrationFailure::new(
            discovery.class,
            None,
            "source_validation",
            "invalid_database",
            None,
        )),
    }
}

fn discover_sources(
    legacy_candidates: &[SourceCandidate],
    new_database: &Path,
    marker_path: &Path,
) -> Result<ReleaseDataSourceDiscovery, MigrationFailure> {
    let legacy_paths: Vec<_> = legacy_candidates
        .iter()
        .filter(|candidate| candidate.path.exists())
        .collect();
    if legacy_paths.len() > 1 {
        return Ok(ReleaseDataSourceDiscovery {
            class: DataSourceClass::Conflict,
            source: None,
        });
    }

    let source = if let Some(candidate) = legacy_paths.first() {
        let schema = inspect_candidate(candidate)?;
        Some(SourceInfo {
            candidate: (*candidate).clone(),
            schema,
            class: match schema {
                5 => DataSourceClass::LegacySchema5,
                6 => DataSourceClass::LegacySchema6,
                7 => DataSourceClass::LegacySchema7,
                8 => DataSourceClass::OldIdentifierSchema8,
                _ => unreachable!("release schema was validated"),
            },
        })
    } else {
        None
    };

    let new_database_exists = new_database.exists();
    let new_schema = if new_database_exists {
        let candidate = SourceCandidate {
            path: new_database.to_path_buf(),
            identifier: LINKS_IDENTIFIER,
            path_identity: "local-data/com.links.workplace.desktop/courses.sqlite3",
        };
        Some(inspect_candidate(&candidate).map_err(|_| {
            MigrationFailure::new(
                DataSourceClass::Invalid,
                None,
                "new_database_validation",
                "invalid_new_database",
                None,
            )
        })?)
    } else {
        None
    };

    if let Some(schema) = new_schema {
        if schema != 8 {
            return Err(MigrationFailure::new(
                DataSourceClass::Invalid,
                Some(schema),
                "new_database_validation",
                "new_schema_must_be_8",
                None,
            ));
        }
        if let Some(source) = &source {
            let matching_marker = read_marker(marker_path)
                .ok()
                .flatten()
                .is_some_and(|marker| marker_matches(&marker, source));
            if !matching_marker {
                return Ok(ReleaseDataSourceDiscovery {
                    class: DataSourceClass::Conflict,
                    source: None,
                });
            }
        } else if marker_path.exists() && read_marker(marker_path).is_err() {
            return Err(MigrationFailure::new(
                DataSourceClass::Invalid,
                Some(schema),
                "migration_marker_validation",
                "invalid_marker",
                None,
            ));
        }
        return Ok(ReleaseDataSourceDiscovery {
            class: DataSourceClass::NewIdentifierSchema8,
            source: source.clone(),
        });
    }

    if let Some(source) = &source {
        if marker_path.exists() {
            let marker = read_marker(marker_path).map_err(|_| {
                MigrationFailure::new(
                    DataSourceClass::Invalid,
                    Some(source.schema),
                    "migration_marker_validation",
                    "invalid_marker",
                    None,
                )
            })?;
            if marker.is_some_and(|marker| !marker_matches(&marker, source)) {
                return Err(MigrationFailure::new(
                    DataSourceClass::Invalid,
                    Some(source.schema),
                    "migration_marker_validation",
                    "marker_source_mismatch",
                    None,
                ));
            }
        }
        return Ok(ReleaseDataSourceDiscovery {
            class: source.class,
            source: Some(source.clone()),
        });
    }

    if marker_path.exists() {
        return Err(MigrationFailure::new(
            DataSourceClass::Invalid,
            None,
            "migration_marker_validation",
            "orphan_marker",
            None,
        ));
    }
    let backups = new_database
        .parent()
        .map(|directory| directory.join("backups").join("migrations"));
    if backups.as_ref().is_some_and(|path| {
        path.is_dir()
            && fs::read_dir(path)
                .ok()
                .is_some_and(|mut entries| entries.next().is_some())
    }) {
        return Err(MigrationFailure::new(
            DataSourceClass::Invalid,
            None,
            "orphaned_migration_backup",
            "target_database_missing",
            None,
        ));
    }
    Ok(ReleaseDataSourceDiscovery {
        class: DataSourceClass::None,
        source: None,
    })
}

fn inspect_candidate(candidate: &SourceCandidate) -> Result<i64, MigrationFailure> {
    let metadata = fs::symlink_metadata(&candidate.path).map_err(|_| {
        MigrationFailure::new(DataSourceClass::Invalid, None, "source_open", "io", None)
    })?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(MigrationFailure::new(
            DataSourceClass::Invalid,
            None,
            "source_open",
            "not_regular_file",
            None,
        ));
    }
    db::inspect_release_database(&candidate.path).map_err(|error| {
        let schema = match error {
            db::StorageError::UnsupportedSchema(version) => Some(version),
            _ => None,
        };
        MigrationFailure::new(
            DataSourceClass::Invalid,
            schema,
            "source_validation",
            "database_validation",
            None,
        )
    })
}

fn migrate_and_activate(
    source: &SourceInfo,
    target_directory: &Path,
) -> Result<MigrationReport, MigrationFailure> {
    fs::create_dir_all(target_directory).map_err(|_| {
        MigrationFailure::new(
            source.class,
            Some(source.schema),
            "target_directory",
            "io",
            None,
        )
    })?;
    let staging_path = unique_staging_path(target_directory, source)?;
    let staging = create_staging_directory(&staging_path, source)?;

    let snapshot = staging_path.join("source-backup.sqlite3");
    create_source_snapshot(source, &snapshot)?;

    let backup_path = persist_verified_backup(source, &snapshot, target_directory)?;
    let work_directory = staging_path.join("work");
    fs::create_dir(&work_directory).map_err(|_| {
        MigrationFailure::new(
            source.class,
            Some(source.schema),
            "staging_work_copy",
            "io",
            Some(backup_path.clone()),
        )
    })?;
    let working_database = work_directory.join(DATABASE_FILE);
    fs::copy(&snapshot, &working_database).map_err(|_| {
        MigrationFailure::new(
            source.class,
            Some(source.schema),
            "staging_work_copy",
            "io",
            Some(backup_path.clone()),
        )
    })?;

    let database = CourseDatabase::open(&working_database).map_err(|_| {
        MigrationFailure::new(
            source.class,
            Some(source.schema),
            "schema_migration",
            "migration_failed",
            Some(backup_path.clone()),
        )
    })?;
    let target_schema = database.schema_version().map_err(|_| {
        MigrationFailure::new(
            source.class,
            Some(source.schema),
            "target_validation",
            "schema_read_failed",
            Some(backup_path.clone()),
        )
    })?;
    if target_schema != 8 {
        return Err(MigrationFailure::new(
            source.class,
            Some(source.schema),
            "target_validation",
            "target_schema_mismatch",
            Some(backup_path),
        ));
    }
    let counts = database.migration_row_counts().map_err(|_| {
        MigrationFailure::new(
            source.class,
            Some(source.schema),
            "target_validation",
            "row_count_failed",
            Some(backup_path.clone()),
        )
    })?;
    let rows = MigrationRowCounts {
        courses: counts[0],
        period_times: counts[1],
        semesters: counts[2],
        academic_tasks: counts[3],
        personal_tasks: counts[4],
        planner_events: counts[5],
        time_blocks: counts[6],
        diary_entries: counts[7],
        inbox_items: counts[8],
        routines: counts[9],
    };
    database.checkpoint_for_migration().map_err(|_| {
        MigrationFailure::new(
            source.class,
            Some(source.schema),
            "staging_checkpoint",
            "checkpoint_failed",
            Some(backup_path.clone()),
        )
    })?;
    drop(database);

    let ready_database = staging_path.join("ready.sqlite3");
    fs::copy(&working_database, &ready_database).map_err(|_| {
        MigrationFailure::new(
            source.class,
            Some(source.schema),
            "staging_finalize",
            "io",
            Some(backup_path.clone()),
        )
    })?;
    let ready_schema = db::inspect_release_database(&ready_database).map_err(|_| {
        MigrationFailure::new(
            source.class,
            Some(source.schema),
            "staging_validation",
            "integrity_failed",
            Some(backup_path.clone()),
        )
    })?;
    if ready_schema != 8 {
        return Err(MigrationFailure::new(
            source.class,
            Some(source.schema),
            "staging_validation",
            "target_schema_mismatch",
            Some(backup_path),
        ));
    }

    let marker = MigrationMarker {
        format_version: 1,
        source_identifier: source.candidate.identifier.into(),
        source_path_identity: source.candidate.path_identity.into(),
        source_schema: source.schema,
        target_identifier: LINKS_IDENTIFIER.into(),
        target_schema: 8,
        completed: true,
        completed_at_unix_milliseconds: now_milliseconds(),
    };
    let marker_path = target_directory.join(MIGRATION_MARKER);
    write_marker_atomically(&marker_path, &marker).map_err(|_| {
        MigrationFailure::new(
            source.class,
            Some(source.schema),
            "migration_marker_write",
            "io",
            Some(backup_path.clone()),
        )
    })?;

    let target_database = target_directory.join(DATABASE_FILE);
    activate_staged_database(
        &ready_database,
        &target_database,
        &marker_path,
        source,
        &backup_path,
    )?;

    let activated_schema = db::inspect_release_database(&target_database).map_err(|_| {
        MigrationFailure::new(
            source.class,
            Some(source.schema),
            "activated_database_validation",
            "integrity_failed",
            Some(backup_path.clone()),
        )
    })?;
    if activated_schema != 8 {
        return Err(MigrationFailure::new(
            source.class,
            Some(source.schema),
            "activated_database_validation",
            "target_schema_mismatch",
            Some(backup_path),
        ));
    }

    drop(staging);
    Ok(MigrationReport {
        source_class: source.class,
        source_schema: source.schema,
        target_schema: 8,
        schema_migrations: (8 - source.schema) as u8,
        backup_path,
        rows,
    })
}

fn create_source_snapshot(
    source: &SourceInfo,
    snapshot_path: &Path,
) -> Result<(), MigrationFailure> {
    let connection =
        Connection::open_with_flags(&source.candidate.path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|_| {
                MigrationFailure::new(
                    source.class,
                    Some(source.schema),
                    "source_backup",
                    "source_busy_or_unreadable",
                    None,
                )
            })?;
    connection
        .busy_timeout(std::time::Duration::from_secs(3))
        .map_err(|_| {
            MigrationFailure::new(
                source.class,
                Some(source.schema),
                "source_backup",
                "sqlite",
                None,
            )
        })?;
    let current_schema = db::validate_release_database_connection(&connection).map_err(|_| {
        MigrationFailure::new(
            DataSourceClass::Invalid,
            Some(source.schema),
            "source_revalidation",
            "source_changed_or_invalid",
            None,
        )
    })?;
    if current_schema != source.schema {
        return Err(MigrationFailure::new(
            DataSourceClass::Invalid,
            Some(current_schema),
            "source_revalidation",
            "source_schema_changed",
            None,
        ));
    }
    connection
        .backup(MAIN_DB, snapshot_path, None)
        .map_err(|_| {
            MigrationFailure::new(
                source.class,
                Some(source.schema),
                "source_backup",
                "sqlite_backup_failed",
                None,
            )
        })?;
    let snapshot_schema = db::inspect_release_database(snapshot_path).map_err(|_| {
        MigrationFailure::new(
            source.class,
            Some(source.schema),
            "backup_validation",
            "backup_integrity_failed",
            None,
        )
    })?;
    if snapshot_schema != source.schema {
        let _ = fs::remove_file(snapshot_path);
        return Err(MigrationFailure::new(
            source.class,
            Some(snapshot_schema),
            "backup_validation",
            "backup_schema_mismatch",
            None,
        ));
    }
    Ok(())
}

fn persist_verified_backup(
    source: &SourceInfo,
    snapshot: &Path,
    target_directory: &Path,
) -> Result<PathBuf, MigrationFailure> {
    let backup_directory = target_directory.join("backups").join("migrations");
    fs::create_dir_all(&backup_directory).map_err(|_| {
        MigrationFailure::new(
            source.class,
            Some(source.schema),
            "backup_directory",
            "io",
            None,
        )
    })?;
    let stamp = now_milliseconds();
    for suffix in 0..1000_u16 {
        let name = format!(
            "courses-pre-links-migration-v{}-{stamp}-{suffix}.sqlite3",
            source.schema
        );
        let final_path = backup_directory.join(name);
        if final_path.exists() {
            continue;
        }
        let temp_path =
            backup_directory.join(format!(".links-migration-backup-{stamp}-{suffix}.tmp"));
        let copy_result = (|| {
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp_path)?;
            std::io::copy(&mut File::open(snapshot)?, &mut output)?;
            output.sync_all()?;
            drop(output);
            let copied_schema = db::inspect_release_database(&temp_path)
                .map_err(|_| std::io::Error::other("backup validation failed"))?;
            if copied_schema != source.schema {
                return Err(std::io::Error::other("backup schema mismatch"));
            }
            fs::rename(&temp_path, &final_path)?;
            Ok::<_, std::io::Error>(())
        })();
        if let Err(_error) = copy_result {
            let _ = fs::remove_file(&temp_path);
            return Err(MigrationFailure::new(
                source.class,
                Some(source.schema),
                "backup_persist",
                "backup_validation_or_io",
                None,
            ));
        }
        return Ok(final_path);
    }
    Err(MigrationFailure::new(
        source.class,
        Some(source.schema),
        "backup_persist",
        "name_exhausted",
        None,
    ))
}

fn marker_matches(marker: &MigrationMarker, source: &SourceInfo) -> bool {
    marker.format_version == 1
        && marker.completed
        && marker.source_identifier == source.candidate.identifier
        && marker.source_path_identity == source.candidate.path_identity
        && marker.source_schema == source.schema
        && marker.target_identifier == LINKS_IDENTIFIER
        && marker.target_schema == 8
}

fn read_marker(path: &Path) -> Result<Option<MigrationMarker>, std::io::Error> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(path)?;
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| std::io::Error::other("invalid migration marker"))
}

fn validate_stale_marker(path: &Path, source: &SourceInfo) -> Result<(), MigrationFailure> {
    let marker = read_marker(path).map_err(|_| {
        MigrationFailure::new(
            DataSourceClass::Invalid,
            Some(source.schema),
            "stale_marker_validation",
            "invalid_marker",
            None,
        )
    })?;
    if marker.is_some_and(|marker| !marker_matches(&marker, source)) {
        return Err(MigrationFailure::new(
            DataSourceClass::Invalid,
            Some(source.schema),
            "stale_marker_validation",
            "marker_source_mismatch",
            None,
        ));
    }
    Ok(())
}

fn write_marker_atomically(path: &Path, marker: &MigrationMarker) -> std::io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| std::io::Error::other("missing marker parent"))?;
    let temp = parent.join(format!(
        ".links-migration-marker-{}.tmp",
        now_milliseconds()
    ));
    let bytes = serde_json::to_vec(marker).map_err(std::io::Error::other)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    fs::rename(&temp, path)
}

fn write_staging_state(path: &Path, source: &SourceInfo) -> std::io::Result<()> {
    let state = StagingState {
        format_version: 1,
        source_identifier: source.candidate.identifier.into(),
        target_identifier: LINKS_IDENTIFIER.into(),
        source_schema: source.schema,
        state: "in_progress".into(),
    };
    let bytes = serde_json::to_vec(&state).map_err(std::io::Error::other)?;
    let temp = path.join(STAGING_STATE_TEMP);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(temp, path.join(STAGING_STATE))
}

fn remove_incomplete_staging_directory(path: &Path) -> Result<(), MigrationFailure> {
    let entries = fs::read_dir(path)
        .map_err(|_| {
            MigrationFailure::new(
                DataSourceClass::Invalid,
                None,
                "staging_cleanup",
                "io",
                None,
            )
        })?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| {
            MigrationFailure::new(
                DataSourceClass::Invalid,
                None,
                "staging_cleanup",
                "io",
                None,
            )
        })?;
    match entries.as_slice() {
        [] => fs::remove_dir(path),
        [entry] if entry.file_name() == STAGING_STATE_TEMP => {
            let file = entry.path();
            let metadata = fs::symlink_metadata(&file).map_err(|_| {
                MigrationFailure::new(
                    DataSourceClass::Invalid,
                    None,
                    "staging_cleanup",
                    "io",
                    None,
                )
            })?;
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(MigrationFailure::new(
                    DataSourceClass::Invalid,
                    None,
                    "staging_cleanup",
                    "unexpected_partial_stage_type",
                    None,
                ));
            }
            fs::remove_file(file).and_then(|()| fs::remove_dir(path))
        }
        _ => {
            return Err(MigrationFailure::new(
                DataSourceClass::Invalid,
                None,
                "staging_cleanup",
                "unrecognized_staging_files",
                None,
            ));
        }
    }
    .map_err(|_| {
        MigrationFailure::new(
            DataSourceClass::Invalid,
            None,
            "staging_cleanup",
            "io",
            None,
        )
    })
}

fn create_staging_directory(
    path: &Path,
    source: &SourceInfo,
) -> Result<StagingDirectory, MigrationFailure> {
    fs::create_dir(path).map_err(|_| {
        MigrationFailure::new(
            source.class,
            Some(source.schema),
            "staging_create",
            "io",
            None,
        )
    })?;
    let staging = StagingDirectory(path.to_path_buf());
    write_staging_state(path, source).map_err(|_| {
        MigrationFailure::new(
            source.class,
            Some(source.schema),
            "staging_initialize",
            "io",
            None,
        )
    })?;
    Ok(staging)
}

fn activate_staged_database(
    staged_database: &Path,
    target_database: &Path,
    marker_path: &Path,
    source: &SourceInfo,
    backup_path: &Path,
) -> Result<(), MigrationFailure> {
    if target_database.exists() || fs::rename(staged_database, target_database).is_err() {
        let _ = fs::remove_file(marker_path);
        return Err(MigrationFailure::new(
            source.class,
            Some(source.schema),
            "atomic_activation",
            "target_exists_or_rename_failed",
            Some(backup_path.to_path_buf()),
        ));
    }
    Ok(())
}

fn cleanup_interrupted_artifacts(target_directory: &Path) -> Result<(), MigrationFailure> {
    if !target_directory.is_dir() {
        return Ok(());
    }
    let entries = fs::read_dir(target_directory).map_err(|_| {
        MigrationFailure::new(
            DataSourceClass::Invalid,
            None,
            "staging_cleanup",
            "io",
            None,
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|_| {
            MigrationFailure::new(
                DataSourceClass::Invalid,
                None,
                "staging_cleanup",
                "io",
                None,
            )
        })?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let path = entry.path();
        if name.starts_with(STAGING_PREFIX) {
            let metadata = fs::symlink_metadata(&path).map_err(|_| {
                MigrationFailure::new(
                    DataSourceClass::Invalid,
                    None,
                    "staging_cleanup",
                    "io",
                    None,
                )
            })?;
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err(MigrationFailure::new(
                    DataSourceClass::Invalid,
                    None,
                    "staging_cleanup",
                    "unexpected_staging_type",
                    None,
                ));
            }
            let state_path = path.join(STAGING_STATE);
            match fs::symlink_metadata(&state_path) {
                Ok(state_metadata)
                    if state_metadata.is_file() && !state_metadata.file_type().is_symlink() =>
                {
                    let bytes = fs::read(&state_path).map_err(|_| {
                        MigrationFailure::new(
                            DataSourceClass::Invalid,
                            None,
                            "staging_cleanup",
                            "io",
                            None,
                        )
                    })?;
                    let state = serde_json::from_slice::<StagingState>(&bytes).map_err(|_| {
                        MigrationFailure::new(
                            DataSourceClass::Invalid,
                            None,
                            "staging_cleanup",
                            "invalid_stage_marker",
                            None,
                        )
                    })?;
                    if state.format_version != 1
                        || state.target_identifier != LINKS_IDENTIFIER
                        || state.source_identifier != LEGACY_IDENTIFIER
                        || !(5..=8).contains(&state.source_schema)
                        || state.state != "in_progress"
                    {
                        return Err(MigrationFailure::new(
                            DataSourceClass::Invalid,
                            Some(state.source_schema),
                            "staging_cleanup",
                            "unrecognized_staging_state",
                            None,
                        ));
                    }
                    fs::remove_dir_all(&path).map_err(|_| {
                        MigrationFailure::new(
                            DataSourceClass::Invalid,
                            Some(state.source_schema),
                            "staging_cleanup",
                            "io",
                            None,
                        )
                    })?;
                }
                Ok(_) => {
                    return Err(MigrationFailure::new(
                        DataSourceClass::Invalid,
                        None,
                        "staging_cleanup",
                        "invalid_stage_marker_type",
                        None,
                    ));
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    remove_incomplete_staging_directory(&path)?;
                }
                Err(_) => {
                    return Err(MigrationFailure::new(
                        DataSourceClass::Invalid,
                        None,
                        "staging_cleanup",
                        "io",
                        None,
                    ));
                }
            }
        } else if name.starts_with(".links-migration-marker-")
            || name.starts_with(".links-migration-backup-")
        {
            let metadata = fs::symlink_metadata(&path).map_err(|_| {
                MigrationFailure::new(
                    DataSourceClass::Invalid,
                    None,
                    "staging_cleanup",
                    "io",
                    None,
                )
            })?;
            if metadata.is_file() && !metadata.file_type().is_symlink() {
                fs::remove_file(&path).map_err(|_| {
                    MigrationFailure::new(
                        DataSourceClass::Invalid,
                        None,
                        "staging_cleanup",
                        "io",
                        None,
                    )
                })?;
            }
        }
    }
    let backup_directory = target_directory.join("backups").join("migrations");
    if backup_directory.is_dir() {
        for entry in fs::read_dir(&backup_directory).map_err(|_| {
            MigrationFailure::new(
                DataSourceClass::Invalid,
                None,
                "staging_cleanup",
                "io",
                None,
            )
        })? {
            let entry = entry.map_err(|_| {
                MigrationFailure::new(
                    DataSourceClass::Invalid,
                    None,
                    "staging_cleanup",
                    "io",
                    None,
                )
            })?;
            let path = entry.path();
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with(".links-migration-backup-")
            {
                let metadata = fs::symlink_metadata(&path).map_err(|_| {
                    MigrationFailure::new(
                        DataSourceClass::Invalid,
                        None,
                        "staging_cleanup",
                        "io",
                        None,
                    )
                })?;
                if metadata.is_file() && !metadata.file_type().is_symlink() {
                    fs::remove_file(&path).map_err(|_| {
                        MigrationFailure::new(
                            DataSourceClass::Invalid,
                            None,
                            "staging_cleanup",
                            "io",
                            None,
                        )
                    })?;
                }
            }
        }
    }
    Ok(())
}

fn unique_staging_path(
    target_directory: &Path,
    source: &SourceInfo,
) -> Result<PathBuf, MigrationFailure> {
    let stamp = now_milliseconds();
    for suffix in 0..1000_u16 {
        let path = target_directory.join(format!(
            "{STAGING_PREFIX}{stamp}-{}-{suffix}",
            std::process::id()
        ));
        if !path.exists() {
            return Ok(path);
        }
    }
    Err(MigrationFailure::new(
        source.class,
        Some(source.schema),
        "staging_create",
        "name_exhausted",
        None,
    ))
}

fn now_milliseconds() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
fn dry_run_source(
    source_path: &Path,
    source_identifier: &'static str,
    source_path_identity: &'static str,
    temp_root: &Path,
) -> Result<MigrationReport, MigrationFailure> {
    let candidate = SourceCandidate {
        path: source_path.to_path_buf(),
        identifier: source_identifier,
        path_identity: source_path_identity,
    };
    let schema = inspect_candidate(&candidate)?;
    let source = SourceInfo {
        candidate,
        schema,
        class: match schema {
            5 => DataSourceClass::LegacySchema5,
            6 => DataSourceClass::LegacySchema6,
            7 => DataSourceClass::LegacySchema7,
            8 => DataSourceClass::OldIdentifierSchema8,
            _ => unreachable!("release schema was validated"),
        },
    };
    fs::create_dir_all(temp_root).map_err(|_| {
        MigrationFailure::new(source.class, Some(schema), "dry_run_workspace", "io", None)
    })?;
    migrate_and_activate(&source, temp_root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_TEMP: AtomicU64 = AtomicU64::new(1);

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "links-workplace-{label}-{}-{}",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn create_schema_eight(path: &Path) {
        let database = CourseDatabase::open(path).expect("create schema eight fixture");
        drop(database);
        let connection = Connection::open(path).expect("open schema eight fixture");
        connection
            .execute_batch(
                "INSERT INTO semesters
                    (id, name, first_week_monday, total_weeks, timezone, status, created_at, updated_at)
                 VALUES ('sem-fixture', 'synthetic semester', '2026-09-07', 16,
                         'Asia/Shanghai', 'ACTIVE', 'fixture', 'fixture');
                 INSERT INTO courses
                    (id, name, teacher, classroom, weekday, start_time, end_time,
                     start_period, end_period, weeks)
                 VALUES ('course-fixture', 'COURSE_MIGRATION_SENTINEL', NULL, NULL, 1,
                         '08:00', '08:45', 1, 1, '[1]');
                 INSERT INTO academic_tasks
                    (id, semester_id, type, title, due_at, priority, status, created_at, updated_at)
                 VALUES ('academic-fixture', 'sem-fixture', 'ASSIGNMENT', 'synthetic academic task',
                         '2026-09-25T12:00:00+08:00', 1, 'TODO', 'fixture', 'fixture');
                 INSERT INTO app_settings (key, value) VALUES ('day_count', '5');
                 INSERT INTO personal_tasks
                    (id, title, status, priority, created_at, updated_at)
                 VALUES ('task-fixture', 'TASK_MIGRATION_SENTINEL', 'OPEN', 'MEDIUM', 'fixture', 'fixture');
                 INSERT INTO planner_events
                    (id, title, date, start_time, end_time, buffer_before_minutes,
                     buffer_after_minutes, created_at, updated_at)
                 VALUES ('event-fixture', 'synthetic event', '2026-09-24', '10:00', '11:00', 0, 0, 'fixture', 'fixture');
                 INSERT INTO time_blocks
                    (id, personal_task_id, date, start_time, end_time, buffer_before_minutes,
                     buffer_after_minutes, created_at, updated_at)
                 VALUES ('block-fixture', 'task-fixture', '2026-09-24', '13:00', '14:00', 0, 0, 'fixture', 'fixture');
                 INSERT INTO diary_entries (id, entry_date, body, created_at, updated_at)
                 VALUES ('diary-fixture', '2026-09-24', 'DIARY_MIGRATION_SENTINEL', 'fixture', 'fixture');
                 INSERT INTO inbox_items (id, raw_text, status, created_at, updated_at)
                 VALUES ('inbox-fixture', 'INBOX_MIGRATION_SENTINEL', 'pending', 'fixture', 'fixture');
                 INSERT INTO routines
                    (id, title, target_duration_minutes, weekdays_mask, enabled, created_at, updated_at)
                 VALUES ('routine-fixture', 'ROUTINE_MIGRATION_SENTINEL', 30, 127, 1, 'fixture', 'fixture');
                 INSERT INTO daily_summaries
                    (id, summary_date, overview, highlights_json, unfinished_json,
                     tomorrow_notes_json, created_at, updated_at, revision)
                 VALUES ('summary-fixture', '2026-09-24', 'synthetic summary', '[]', '[]', '[]', 'fixture', 'fixture', 1);",
            )
            .expect("seed synthetic entities and settings");
    }

    fn downgrade_to(path: &Path, schema: i64) {
        let connection = Connection::open(path).expect("open fixture to set historical schema");
        let sql = match schema {
            5 => {
                "PRAGMA foreign_keys=OFF; DROP TABLE daily_summaries; DROP TABLE routines;
                  DROP TABLE inbox_items; DROP TABLE diary_entries; DROP TABLE time_blocks;
                  DROP TABLE planner_events; DROP TABLE personal_tasks; PRAGMA user_version=5;"
            }
            6 => {
                "PRAGMA foreign_keys=OFF; DROP TABLE daily_summaries; DROP TABLE routines;
                  DROP TABLE inbox_items; DROP TABLE diary_entries; PRAGMA user_version=6;"
            }
            7 => "DROP TABLE daily_summaries; PRAGMA user_version=7;",
            8 => return,
            _ => panic!("unsupported fixture version"),
        };
        connection
            .execute_batch(sql)
            .expect("downgrade fixture tables");
    }

    fn legacy_candidate(path: &Path) -> SourceCandidate {
        SourceCandidate {
            path: path.to_path_buf(),
            identifier: LEGACY_IDENTIFIER,
            path_identity: "local-data/com.ntu-course-assistant.desktop/courses.sqlite3",
        }
    }

    fn count(path: &Path, table: &str) -> i64 {
        let connection = Connection::open(path).expect("open migrated fixture");
        connection
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("count synthetic rows")
    }

    fn text_value(path: &Path, query: &str) -> String {
        Connection::open(path)
            .expect("open migration fixture")
            .query_row(query, [], |row| row.get(0))
            .expect("read migration sentinel")
    }

    fn assert_integrity(path: &Path) {
        assert_eq!(
            text_value(path, "PRAGMA integrity_check"),
            "ok",
            "{} must pass SQLite integrity_check",
            path.display()
        );
    }

    #[test]
    fn schema_five_six_seven_and_eight_sources_copy_to_schema_eight_without_entity_loss() {
        for schema in 5..=8 {
            let root = temp_root("schema-chain");
            fs::create_dir_all(&root).expect("create fixture root");
            let source_path = root.join("legacy").join(DATABASE_FILE);
            fs::create_dir_all(source_path.parent().unwrap()).expect("create legacy root");
            create_schema_eight(&source_path);
            downgrade_to(&source_path, schema);

            let target = root.join("new-id");
            let candidate = legacy_candidate(&source_path);
            let discovered = discover_sources(
                std::slice::from_ref(&candidate),
                &target.join(DATABASE_FILE),
                &target.join(MIGRATION_MARKER),
            )
            .expect("classify source");
            assert_eq!(
                discovered.class,
                match schema {
                    5 => DataSourceClass::LegacySchema5,
                    6 => DataSourceClass::LegacySchema6,
                    7 => DataSourceClass::LegacySchema7,
                    _ => DataSourceClass::OldIdentifierSchema8,
                }
            );

            let source = discovered.source.expect("source candidate");
            let report = migrate_and_activate(&source, &target).expect("migrate source copy");
            assert_eq!(report.schema_migrations, (8 - schema) as u8);
            assert_eq!(
                db::inspect_release_database(&target.join(DATABASE_FILE)).unwrap(),
                8
            );
            assert_eq!(count(&target.join(DATABASE_FILE), "courses"), 1);
            assert_eq!(count(&target.join(DATABASE_FILE), "semesters"), 1);
            assert_eq!(count(&target.join(DATABASE_FILE), "academic_tasks"), 1);
            assert_eq!(count(&target.join(DATABASE_FILE), "app_settings"), 1);
            assert_eq!(count(&source_path, "courses"), 1);
            let target_path = target.join(DATABASE_FILE);
            assert_eq!(
                text_value(
                    &target_path,
                    "SELECT name FROM courses WHERE id = 'course-fixture'"
                ),
                "COURSE_MIGRATION_SENTINEL"
            );
            assert_eq!(
                text_value(
                    &source_path,
                    "SELECT name FROM courses WHERE id = 'course-fixture'"
                ),
                "COURSE_MIGRATION_SENTINEL"
            );
            if schema >= 6 {
                assert_eq!(count(&target.join(DATABASE_FILE), "personal_tasks"), 1);
                assert_eq!(count(&target.join(DATABASE_FILE), "planner_events"), 1);
                assert_eq!(count(&target.join(DATABASE_FILE), "time_blocks"), 1);
                assert_eq!(
                    text_value(
                        &target_path,
                        "SELECT title FROM personal_tasks WHERE id = 'task-fixture'"
                    ),
                    "TASK_MIGRATION_SENTINEL"
                );
            }
            if schema >= 7 {
                assert_eq!(count(&target.join(DATABASE_FILE), "diary_entries"), 1);
                assert_eq!(count(&target.join(DATABASE_FILE), "inbox_items"), 1);
                assert_eq!(count(&target.join(DATABASE_FILE), "routines"), 1);
                assert_eq!(
                    text_value(
                        &target_path,
                        "SELECT body FROM diary_entries WHERE id = 'diary-fixture'"
                    ),
                    "DIARY_MIGRATION_SENTINEL"
                );
                assert_eq!(
                    text_value(
                        &target_path,
                        "SELECT raw_text FROM inbox_items WHERE id = 'inbox-fixture'"
                    ),
                    "INBOX_MIGRATION_SENTINEL"
                );
                assert_eq!(
                    text_value(
                        &target_path,
                        "SELECT title FROM routines WHERE id = 'routine-fixture'"
                    ),
                    "ROUTINE_MIGRATION_SENTINEL"
                );
            }
            if schema == 8 {
                assert_eq!(count(&target.join(DATABASE_FILE), "daily_summaries"), 1);
            }
            assert!(report.backup_path.is_file());
            assert_integrity(&source_path);
            assert_integrity(&target_path);
            assert_integrity(&report.backup_path);
            fs::remove_dir_all(root).expect("remove fixture root");
        }
    }

    #[test]
    fn no_source_new_database_and_conflicting_sources_are_classified_without_merging() {
        let root = temp_root("classify");
        fs::create_dir_all(&root).unwrap();
        let target = root.join("new-id").join(DATABASE_FILE);
        let none = discover_sources(&[], &target, &root.join(MIGRATION_MARKER)).unwrap();
        assert_eq!(none.class, DataSourceClass::None);

        fs::create_dir_all(target.parent().unwrap()).unwrap();
        create_schema_eight(&target);
        let new_only = discover_sources(&[], &target, &root.join(MIGRATION_MARKER)).unwrap();
        assert_eq!(new_only.class, DataSourceClass::NewIdentifierSchema8);

        let old_a = root.join("old-a").join(DATABASE_FILE);
        let old_b = root.join("old-b").join(DATABASE_FILE);
        fs::create_dir_all(old_a.parent().unwrap()).unwrap();
        fs::create_dir_all(old_b.parent().unwrap()).unwrap();
        create_schema_eight(&old_a);
        create_schema_eight(&old_b);
        let conflict = discover_sources(
            &[legacy_candidate(&old_a), legacy_candidate(&old_b)],
            &target,
            &root.join(MIGRATION_MARKER),
        )
        .unwrap();
        assert_eq!(conflict.class, DataSourceClass::Conflict);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn old_and_new_databases_require_a_matching_completion_marker_and_reopen_idempotently() {
        let root = temp_root("marker");
        let local = root.join("local-data");
        let old = local.join(LEGACY_IDENTIFIER).join(DATABASE_FILE);
        fs::create_dir_all(old.parent().unwrap()).unwrap();
        create_schema_eight(&old);
        downgrade_to(&old, 7);
        let new_root = local.join(LINKS_IDENTIFIER);
        fs::create_dir_all(&new_root).unwrap();
        let new_db = new_root.join(DATABASE_FILE);
        create_schema_eight(&new_db);
        let marker_path = new_root.join(MIGRATION_MARKER);
        let source = SourceInfo {
            candidate: legacy_candidate(&old),
            schema: 7,
            class: DataSourceClass::LegacySchema7,
        };
        let conflict = discover_sources(
            std::slice::from_ref(&source.candidate),
            &new_db,
            &marker_path,
        )
        .unwrap();
        assert_eq!(conflict.class, DataSourceClass::Conflict);
        fs::remove_file(&new_db).unwrap();
        let report = migrate_and_activate(&source, &new_root).unwrap();
        assert_eq!(report.target_schema, 8);
        for _ in 0..2 {
            assert!(matches!(
                prepare_release_database(&new_root, &local).unwrap(),
                InitializationOutcome::Existing
            ));
        }
        assert_eq!(count(&old, "courses"), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn corrupt_source_and_unrecognized_staging_are_rejected_without_touching_source() {
        let root = temp_root("invalid");
        fs::create_dir_all(&root).unwrap();
        let corrupt = root.join("corrupt.sqlite3");
        fs::write(&corrupt, b"not sqlite").unwrap();
        let invalid = discover_sources(
            &[legacy_candidate(&corrupt)],
            &root.join("new").join(DATABASE_FILE),
            &root.join("new").join(MIGRATION_MARKER),
        )
        .unwrap_err();
        assert_eq!(invalid.class, DataSourceClass::Invalid);
        assert_eq!(fs::read(&corrupt).unwrap(), b"not sqlite");

        let unsupported = root.join("schema-nine.sqlite3");
        create_schema_eight(&unsupported);
        Connection::open(&unsupported)
            .unwrap()
            .pragma_update(None, "user_version", 9)
            .unwrap();
        let invalid_schema = discover_sources(
            &[legacy_candidate(&unsupported)],
            &root.join("new-schema-nine").join(DATABASE_FILE),
            &root.join("new-schema-nine").join(MIGRATION_MARKER),
        )
        .unwrap_err();
        assert_eq!(invalid_schema.class, DataSourceClass::Invalid);

        let new_root = root.join("new");
        fs::create_dir_all(&new_root).unwrap();
        let stage = new_root.join(format!("{STAGING_PREFIX}unknown"));
        fs::create_dir(&stage).unwrap();
        fs::write(stage.join("unknown.dat"), b"keep").unwrap();
        let cleanup_error = cleanup_interrupted_artifacts(&new_root).unwrap_err();
        assert_eq!(cleanup_error.class, DataSourceClass::Invalid);
        assert!(stage.join("unknown.dat").is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn interrupted_owned_staging_is_removed_before_safe_retry_and_dev_v2_is_not_a_source() {
        let root = temp_root("recover");
        let local = root.join("local-data");
        let old_root = local.join(LEGACY_IDENTIFIER);
        let old = old_root.join(DATABASE_FILE);
        fs::create_dir_all(&old_root).unwrap();
        create_schema_eight(&old);
        downgrade_to(&old, 5);
        let dev_db = old_root.join("dev-v2").join(DATABASE_FILE);
        fs::create_dir_all(dev_db.parent().unwrap()).unwrap();
        create_schema_eight(&dev_db);
        let new_root = local.join(LINKS_IDENTIFIER);
        fs::create_dir_all(&new_root).unwrap();
        let stage = new_root.join(format!("{STAGING_PREFIX}interrupted"));
        fs::create_dir(&stage).unwrap();
        let empty_stage = new_root.join(format!("{STAGING_PREFIX}empty-interrupted"));
        fs::create_dir(&empty_stage).unwrap();
        let partial_marker_stage = new_root.join(format!("{STAGING_PREFIX}partial-marker"));
        fs::create_dir(&partial_marker_stage).unwrap();
        fs::write(partial_marker_stage.join(STAGING_STATE_TEMP), b"partial").unwrap();
        write_staging_state(
            &stage,
            &SourceInfo {
                candidate: legacy_candidate(&old),
                schema: 5,
                class: DataSourceClass::LegacySchema5,
            },
        )
        .unwrap();
        fs::write(stage.join("partial.sqlite3"), b"partial").unwrap();

        let outcome = prepare_release_database(&new_root, &local).unwrap();
        assert!(matches!(outcome, InitializationOutcome::Migrated(_)));
        assert!(!stage.exists());
        assert!(!empty_stage.exists());
        assert!(!partial_marker_stage.exists());
        assert!(dev_db.is_file());
        assert_eq!(db::inspect_release_database(&dev_db).unwrap(), 8);
        assert_eq!(
            db::inspect_release_database(&new_root.join(DATABASE_FILE)).unwrap(),
            8
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_target_schema_is_rejected_and_failed_activation_keeps_target_and_removes_marker() {
        let root = temp_root("activation");
        fs::create_dir_all(&root).unwrap();
        let old = root.join("old.sqlite3");
        create_schema_eight(&old);
        downgrade_to(&old, 5);
        let source = SourceInfo {
            candidate: legacy_candidate(&old),
            schema: 5,
            class: DataSourceClass::LegacySchema5,
        };
        let target = root.join("target");
        fs::create_dir_all(&target).unwrap();
        let invalid_new = target.join(DATABASE_FILE);
        fs::write(&invalid_new, b"corrupt").unwrap();
        let invalid = discover_sources(
            std::slice::from_ref(&source.candidate),
            &invalid_new,
            &target.join(MIGRATION_MARKER),
        )
        .unwrap_err();
        assert_eq!(invalid.class, DataSourceClass::Invalid);
        fs::remove_file(invalid_new).unwrap();

        let staged = root.join("staged.sqlite3");
        fs::write(&staged, b"staged database").unwrap();
        let target_database = target.join(DATABASE_FILE);
        fs::write(&target_database, b"pre-existing target").unwrap();
        let marker_path = target.join(MIGRATION_MARKER);
        fs::write(&marker_path, b"completion marker").unwrap();
        let backup = target.join("verified-backup.sqlite3");
        fs::write(&backup, b"backup").unwrap();
        let error =
            activate_staged_database(&staged, &target_database, &marker_path, &source, &backup)
                .unwrap_err();
        assert_eq!(error.stage, "atomic_activation");
        assert!(!marker_path.exists());
        assert_eq!(fs::read(&target_database).unwrap(), b"pre-existing target");
        assert!(staged.is_file());
        assert_eq!(db::inspect_release_database(&old).unwrap(), 5);
        assert_eq!(count(&old, "courses"), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn staging_failure_preserves_source_and_backup_failure_can_retry() {
        let root = temp_root("failures");
        fs::create_dir_all(&root).unwrap();
        let old = root.join("old.sqlite3");
        create_schema_eight(&old);
        downgrade_to(&old, 6);
        let source = SourceInfo {
            candidate: legacy_candidate(&old),
            schema: 6,
            class: DataSourceClass::LegacySchema6,
        };

        let blocked_stage = root.join("blocked-stage");
        fs::write(&blocked_stage, b"not a directory").unwrap();
        let staging_error = create_staging_directory(&blocked_stage, &source).unwrap_err();
        assert_eq!(staging_error.stage, "staging_create");
        assert_eq!(db::inspect_release_database(&old).unwrap(), 6);

        let target = root.join("target");
        fs::create_dir_all(&target).unwrap();
        let backups = target.join("backups").join("migrations");
        fs::create_dir_all(&backups).unwrap();
        let verified_backup = backups.join("courses-pre-links.sqlite3");
        let interrupted_backup = backups.join(".links-migration-backup-abandoned.tmp");
        fs::write(&verified_backup, b"keep validated backup").unwrap();
        fs::write(&interrupted_backup, b"partial backup").unwrap();
        cleanup_interrupted_artifacts(&target).unwrap();
        assert!(verified_backup.is_file());
        assert!(!interrupted_backup.exists());
        fs::remove_dir_all(&target).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("backups"), b"not a directory").unwrap();
        let backup_error = migrate_and_activate(&source, &target).unwrap_err();
        assert_eq!(backup_error.stage, "backup_directory");
        assert!(backup_error.to_string().contains("创建并验证迁移备份"));
        assert_eq!(db::inspect_release_database(&old).unwrap(), 6);
        assert!(!target.join(DATABASE_FILE).exists());

        fs::remove_file(target.join("backups")).unwrap();
        let report = migrate_and_activate(&source, &target).unwrap();
        assert!(report.backup_path.is_file());
        assert_eq!(
            db::inspect_release_database(&target.join(DATABASE_FILE)).unwrap(),
            8
        );
        assert_eq!(db::inspect_release_database(&old).unwrap(), 6);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn locked_source_fails_safely_without_modifying_it() {
        use std::os::windows::fs::OpenOptionsExt;

        let root = temp_root("locked-source");
        fs::create_dir_all(&root).unwrap();
        let old = root.join("old.sqlite3");
        create_schema_eight(&old);
        downgrade_to(&old, 7);
        let source = SourceInfo {
            candidate: legacy_candidate(&old),
            schema: 7,
            class: DataSourceClass::LegacySchema7,
        };
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(&old)
            .unwrap();
        let error = migrate_and_activate(&source, &root.join("target")).unwrap_err();
        assert!(matches!(
            error.stage,
            "source_backup" | "source_revalidation"
        ));
        drop(lock);
        assert_eq!(db::inspect_release_database(&old).unwrap(), 7);
        assert_eq!(count(&old, "courses"), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "run only for the authorized real-database copy/dry-run; never activates the real target"]
    fn authorized_real_database_copy_dry_run() {
        let source = std::env::var_os("LINKS_MIGRATION_DRY_RUN_SOURCE")
            .expect("set LINKS_MIGRATION_DRY_RUN_SOURCE to the approved old-identifier database");
        let root = temp_root("real-dry-run");
        let report = dry_run_source(
            Path::new(&source),
            LEGACY_IDENTIFIER,
            "local-data/com.ntu-course-assistant.desktop/courses.sqlite3",
            &root,
        )
        .expect("real database dry-run must validate a temporary migrated copy");
        eprintln!(
            "real-data dry-run: source_class={} schema={}->{} migrations={} counts={:?}",
            report.source_class.label(),
            report.source_schema,
            report.target_schema,
            report.schema_migrations,
            report.rows
        );
        fs::remove_dir_all(root).expect("remove temporary dry-run copy");
    }
}
