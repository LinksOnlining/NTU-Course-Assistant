use serde::{Deserialize, Serialize};

pub const MAX_TEACHING_WEEK: u8 = 30;
pub const MAX_PERIOD: u16 = 30;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TermConfig {
    pub first_week_monday: String,
    pub total_weeks: u8,
    pub timezone: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderSettings {
    pub enabled: bool,
    pub advance_minutes: u16,
}

/// Diary text is intentionally not `Debug` so accidental diagnostic formatting cannot expose it.
#[derive(Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiaryEntry {
    pub id: String,
    pub entry_date: String,
    pub body: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Structured, user-authored daily state. Do not derive `Debug` to avoid accidental text logging.
#[derive(Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailySummary {
    pub id: String,
    pub summary_date: String,
    pub overview: String,
    pub highlights: Vec<String>,
    pub unfinished: Vec<String>,
    pub tomorrow_notes: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    pub revision: i64,
}

/// Inbox raw text is intentionally not `Debug` so it cannot leak through diagnostics.
#[derive(Clone, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub id: String,
    pub raw_text: String,
    pub status: String,
    pub parse_kind: Option<String>,
    pub parse_payload_json: Option<String>,
    pub parser_version: Option<String>,
    pub confirmed_target_type: Option<String>,
    pub confirmed_target_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxConfirmation {
    pub target_type: String,
    pub target_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetSettings {
    pub enabled: bool,
    pub display_mode: String,
    pub locked: bool,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// A field-level update prevents delayed geometry events from replacing newer preferences.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetSettingsPatch {
    pub enabled: Option<bool>,
    pub display_mode: Option<String>,
    pub locked: Option<bool>,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

pub fn merge_widget_settings(
    current: &WidgetSettings,
    patch: &WidgetSettingsPatch,
) -> WidgetSettings {
    WidgetSettings {
        enabled: patch.enabled.unwrap_or(current.enabled),
        display_mode: patch
            .display_mode
            .clone()
            .unwrap_or_else(|| current.display_mode.clone()),
        locked: patch.locked.unwrap_or(current.locked),
        x: patch.x.or(current.x),
        y: patch.y.or(current.y),
        width: patch.width.or(current.width),
        height: patch.height.or(current.height),
    }
}

pub fn default_widget_settings() -> WidgetSettings {
    WidgetSettings {
        enabled: false,
        display_mode: "today".into(),
        locked: false,
        x: None,
        y: None,
        width: None,
        height: None,
    }
}

pub fn validate_widget_settings(settings: &WidgetSettings) -> Result<(), String> {
    if !matches!(
        settings.display_mode.as_str(),
        "today" | "week" | "next" | "deadlines"
    ) {
        return Err("小组件显示模式无效".into());
    }
    if settings.x.is_some() != settings.y.is_some() {
        return Err("小组件位置必须同时包含横纵坐标".into());
    }
    if settings.width.is_some() != settings.height.is_some() {
        return Err("小组件尺寸必须同时包含宽高".into());
    }
    if settings
        .x
        .is_some_and(|value| !(-10_000..=10_000).contains(&value))
        || settings
            .y
            .is_some_and(|value| !(-10_000..=10_000).contains(&value))
    {
        return Err("小组件位置超出允许范围".into());
    }
    if settings
        .width
        .is_some_and(|value| !(280..=1_200).contains(&value))
        || settings
            .height
            .is_some_and(|value| !(220..=1_200).contains(&value))
    {
        return Err("小组件尺寸超出允许范围".into());
    }
    Ok(())
}

pub fn validate_term_config(config: &TermConfig) -> Result<(), String> {
    if config.total_weeks == 0 || config.total_weeks > MAX_TEACHING_WEEK {
        return Err("总教学周数必须是 1–30 的整数".into());
    }
    if config.timezone != "Asia/Shanghai" {
        return Err("时区必须为 Asia/Shanghai".into());
    }
    let (year, month, day) = parse_date(&config.first_week_monday)?;
    if weekday(year, month, day) != 1 {
        return Err("第 1 教学周日期必须是星期一".into());
    }
    Ok(())
}

pub fn validate_reminder_settings(settings: &ReminderSettings) -> Result<(), String> {
    if settings.advance_minutes > 180 {
        return Err("提前提醒时间必须是 0–180 分钟的整数".into());
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodTime {
    pub period: u16,
    pub start_time: String,
    pub end_time: String,
}

pub fn validate_period_times(periods: &[PeriodTime]) -> Result<(), String> {
    if periods.is_empty() {
        return Err("至少需要一节课".into());
    }
    let mut previous_end = None;
    for (index, period) in periods.iter().enumerate() {
        if period.period != u16::try_from(index + 1).unwrap_or(u16::MAX)
            || period.period == 0
            || period.period > MAX_PERIOD
        {
            return Err("节次必须从第 1 节连续编号且不超过 30 节".into());
        }
        let start = parse_time(&period.start_time)?;
        let end = parse_time(&period.end_time)?;
        if end <= start {
            return Err(format!("第 {} 节结束时间必须晚于开始时间", period.period));
        }
        if let Some(previous_end) = previous_end {
            if start < previous_end {
                return Err(format!(
                    "第 {}、{} 节时间重叠",
                    period.period - 1,
                    period.period
                ));
            }
        }
        previous_end = Some(end);
    }
    Ok(())
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Course {
    pub id: String,
    pub name: String,
    pub teacher: Option<String>,
    pub classroom: Option<String>,
    pub weekday: u8,
    pub start_period: Option<u16>,
    pub end_period: Option<u16>,
    pub start_time: String,
    pub end_time: String,
    pub weeks: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum SemesterStatus {
    Active,
    Archived,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum CourseOverrideKind {
    #[serde(rename = "CANCEL")]
    Cancel,
    #[serde(rename = "RESCHEDULE")]
    Reschedule,
    #[serde(rename = "MODIFY")]
    Modify,
    #[serde(rename = "MAKEUP")]
    Makeup,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AcademicTaskType {
    #[serde(rename = "ASSIGNMENT")]
    Assignment,
    #[serde(rename = "LAB_REPORT")]
    LabReport,
    #[serde(rename = "PRESENTATION")]
    Presentation,
    #[serde(rename = "PROJECT")]
    Project,
    #[serde(rename = "CUSTOM")]
    Custom,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AcademicTaskStatus {
    #[serde(rename = "TODO")]
    Todo,
    #[serde(rename = "COMPLETED")]
    Completed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ExamStatus {
    #[serde(rename = "SCHEDULED")]
    Scheduled,
    #[serde(rename = "CANCELLED")]
    Cancelled,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Semester {
    pub id: String,
    pub name: String,
    pub first_week_monday: String,
    pub total_weeks: u8,
    pub timezone: String,
    pub status: SemesterStatus,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CourseOverride {
    pub id: String,
    pub course_id: Option<String>,
    pub semester_id: String,
    pub kind: CourseOverrideKind,
    pub original_occurrence_key: Option<String>,
    pub original_date: Option<String>,
    pub target_date: Option<String>,
    pub start_period: Option<u16>,
    pub end_period: Option<u16>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub classroom: Option<String>,
    pub teacher: Option<String>,
    pub note: Option<String>,
    pub active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademicTask {
    pub id: String,
    pub semester_id: String,
    pub course_id: Option<String>,
    #[serde(rename = "type")]
    pub task_type: AcademicTaskType,
    pub title: String,
    pub note: Option<String>,
    pub due_at: String,
    pub priority: u8,
    pub status: AcademicTaskStatus,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PersonalTaskStatus {
    Open,
    Completed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PersonalTaskPriority {
    None,
    Low,
    Medium,
    High,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonalTask {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: PersonalTaskStatus,
    pub priority: PersonalTaskPriority,
    pub deadline_date: Option<String>,
    pub deadline_time: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannerEvent {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub location: Option<String>,
    pub buffer_before_minutes: u16,
    pub buffer_after_minutes: u16,
    pub created_at: String,
    pub updated_at: String,
}

impl PlannerEvent {
    pub(crate) fn validate(&self) -> Result<(), String> {
        validate_planner_text(
            &self.id,
            &self.title,
            self.description.as_deref(),
            self.location.as_deref(),
            &self.created_at,
            &self.updated_at,
        )?;
        validate_planner_interval(
            &self.date,
            &self.start_time,
            &self.end_time,
            self.buffer_before_minutes,
            self.buffer_after_minutes,
        )
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Routine {
    pub id: String,
    pub title: String,
    pub target_duration_minutes: u16,
    pub weekdays_mask: u8,
    pub preferred_start_time: Option<String>,
    pub preferred_end_time: Option<String>,
    pub enabled: bool,
    pub last_scheduled_date: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl Routine {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if !(5..=720).contains(&self.target_duration_minutes) {
            return Err("日常习惯时长必须在 5–720 分钟之间".into());
        }
        if !(1..=127).contains(&self.weekdays_mask) {
            return Err("至少选择一个适用星期".into());
        }
        validate_planner_text(
            &self.id,
            &self.title,
            None,
            None,
            &self.created_at,
            &self.updated_at,
        )?;
        match (
            self.preferred_start_time.as_deref(),
            self.preferred_end_time.as_deref(),
        ) {
            (None, None) => {}
            (Some(start), Some(end)) if parse_time(start)? < parse_time(end)? => {}
            (Some(_), Some(_)) => return Err("偏好时间结束时间必须晚于开始时间".into()),
            _ => return Err("偏好时间窗口必须同时填写开始和结束时间".into()),
        }
        if let Some(date) = &self.last_scheduled_date {
            parse_date(date)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeBlock {
    pub id: String,
    pub personal_task_id: String,
    pub date: String,
    pub start_time: String,
    pub end_time: String,
    pub buffer_before_minutes: u16,
    pub buffer_after_minutes: u16,
    pub created_at: String,
    pub updated_at: String,
}

impl TimeBlock {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if self.personal_task_id.trim().is_empty()
            || self.personal_task_id.trim() != self.personal_task_id
        {
            return Err("时间块必须关联有效的个人任务".into());
        }
        validate_planner_text(
            &self.id,
            "计划时间",
            None,
            None,
            &self.created_at,
            &self.updated_at,
        )?;
        validate_planner_interval(
            &self.date,
            &self.start_time,
            &self.end_time,
            self.buffer_before_minutes,
            self.buffer_after_minutes,
        )
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exam {
    pub id: String,
    pub semester_id: String,
    pub course_id: Option<String>,
    pub title: String,
    pub starts_at: String,
    pub ends_at: Option<String>,
    pub location: Option<String>,
    pub seat_info: Option<String>,
    pub note: Option<String>,
    pub status: ExamStatus,
    pub created_at: String,
    pub updated_at: String,
}

impl Course {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.trim().is_empty() || self.id.trim() != self.id {
            return Err("课程 ID 无效".into());
        }
        if self.name.trim().is_empty()
            || self.name.trim() != self.name
            || self.name.chars().count() > 80
        {
            return Err("课程名称无效".into());
        }
        if self.teacher.as_ref().is_some_and(|value| {
            value.trim().is_empty() || value.trim() != value || value.chars().count() > 100
        }) {
            return Err("教师字段无效".into());
        }
        if self.classroom.as_ref().is_some_and(|value| {
            value.trim().is_empty() || value.trim() != value || value.chars().count() > 100
        }) {
            return Err("教室字段无效".into());
        }
        if !(1..=7).contains(&self.weekday) {
            return Err("星期必须在 1–7 之间".into());
        }
        let start = parse_time(&self.start_time)?;
        let end = parse_time(&self.end_time)?;
        if end <= start {
            return Err("结束时间必须晚于开始时间".into());
        }
        match (self.start_period, self.end_period) {
            (None, None) => {}
            (Some(start), Some(end)) if start > 0 && end >= start => {}
            _ => return Err("节次字段无效".into()),
        }
        if self.weeks.is_empty()
            || self
                .weeks
                .iter()
                .any(|week| !(1..=MAX_TEACHING_WEEK).contains(week))
            || self.weeks.windows(2).any(|pair| pair[0] >= pair[1])
        {
            return Err("周数必须是 1–30 内的排序去重数组".into());
        }
        Ok(())
    }
}

pub(crate) fn parse_time(value: &str) -> Result<u16, String> {
    let bytes = value.as_bytes();
    if bytes.len() != 5
        || bytes[2] != b':'
        || !bytes[0].is_ascii_digit()
        || !bytes[1].is_ascii_digit()
        || !bytes[3].is_ascii_digit()
        || !bytes[4].is_ascii_digit()
    {
        return Err("时间必须使用 HH:mm".into());
    }
    let hour = u16::from(bytes[0] - b'0') * 10 + u16::from(bytes[1] - b'0');
    let minute = u16::from(bytes[3] - b'0') * 10 + u16::from(bytes[4] - b'0');
    if hour > 23 || minute > 59 {
        return Err("时间超出有效范围".into());
    }
    Ok(hour * 60 + minute)
}

pub(crate) fn parse_date(value: &str) -> Result<(u32, u32, u32), String> {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return Err("日期必须使用 YYYY-MM-DD".into());
    }
    let number = |slice: &[u8]| -> Option<u32> {
        slice.iter().try_fold(0_u32, |result, byte| {
            byte.is_ascii_digit()
                .then_some(result * 10 + u32::from(byte - b'0'))
        })
    };
    let (year, month, day) = (
        number(&bytes[0..4]),
        number(&bytes[5..7]),
        number(&bytes[8..10]),
    );
    let (Some(year), Some(month), Some(day)) = (year, month, day) else {
        return Err("日期必须使用 YYYY-MM-DD".into());
    };
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let maximum = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    if year == 0 || day == 0 || day > maximum {
        return Err("日期不存在".into());
    }
    Ok((year, month, day))
}

pub(crate) fn validate_planner_date_range(start: &str, end: &str) -> Result<(), String> {
    if parse_date(start)? > parse_date(end)? {
        return Err("结束日期不得早于开始日期".into());
    }
    Ok(())
}

fn validate_planner_text(
    id: &str,
    title: &str,
    description: Option<&str>,
    location: Option<&str>,
    created_at: &str,
    updated_at: &str,
) -> Result<(), String> {
    if id.trim().is_empty() || id.trim() != id {
        return Err("日程 ID 无效".into());
    }
    if title.trim().is_empty() || title.chars().count() > 200 {
        return Err("标题不能为空且最多 200 个字符".into());
    }
    if description.is_some_and(|value| value.chars().count() > 5000) {
        return Err("描述最多 5000 个字符".into());
    }
    if location.is_some_and(|value| {
        value.trim().is_empty() || value.trim() != value || value.chars().count() > 200
    }) {
        return Err("地点字段无效".into());
    }
    if created_at.trim().is_empty() || updated_at.trim().is_empty() {
        return Err("日程审计时间无效".into());
    }
    Ok(())
}

fn validate_planner_interval(
    date: &str,
    start_time: &str,
    end_time: &str,
    buffer_before_minutes: u16,
    buffer_after_minutes: u16,
) -> Result<(), String> {
    parse_date(date)?;
    let start = parse_time(start_time)?;
    let end = if end_time == "24:00" {
        24 * 60
    } else {
        parse_time(end_time)?
    };
    if start == end {
        return Err("结束时间必须晚于开始时间".into());
    }
    if start > end {
        return Err("当前版本暂不支持跨午夜日程。".into());
    }
    if buffer_before_minutes > 240 || buffer_after_minutes > 240 {
        return Err("缓冲时间必须在 0–240 分钟之间".into());
    }
    Ok(())
}

fn weekday(year: u32, month: u32, day: u32) -> u8 {
    let month_days = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let days = (year - 1) * 365 + (year - 1) / 4 - (year - 1) / 100
        + (year - 1) / 400
        + month_days[(month - 1) as usize]
        + day
        - 1
        + u32::from(leap && month > 2);
    (days % 7 + 1) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn course_validation_rejects_invalid_persisted_values() {
        let mut course = Course {
            id: "id".into(),
            name: "机械设计基础".into(),
            teacher: None,
            classroom: None,
            weekday: 3,
            start_period: None,
            end_period: None,
            start_time: "14:00".into(),
            end_time: "15:30".into(),
            weeks: vec![1, 2, 3],
        };
        assert!(course.validate().is_ok());
        course.weeks = vec![1, 1];
        assert!(course.validate().is_err());
        course.weeks = vec![1, 2];
        course.end_time = "13:00".into();
        assert!(course.validate().is_err());
    }

    #[test]
    fn period_schedule_validation_requires_contiguous_non_overlapping_rows() {
        let valid = vec![
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
        assert!(validate_period_times(&valid).is_ok());
        let mut gap = valid.clone();
        gap[1].period = 3;
        assert!(validate_period_times(&gap).is_err());
        let mut overlap = valid;
        overlap[1].start_time = "08:40".into();
        assert!(validate_period_times(&overlap).is_err());
    }

    #[test]
    fn term_and_reminder_settings_require_supported_values() {
        let term = TermConfig {
            first_week_monday: "2026-09-07".into(),
            total_weeks: 18,
            timezone: "Asia/Shanghai".into(),
        };
        assert!(validate_term_config(&term).is_ok());
        assert!(validate_term_config(&TermConfig {
            first_week_monday: "2026-09-08".into(),
            ..term.clone()
        })
        .is_err());
        assert!(validate_reminder_settings(&ReminderSettings {
            enabled: true,
            advance_minutes: 180
        })
        .is_ok());
        assert!(validate_reminder_settings(&ReminderSettings {
            enabled: true,
            advance_minutes: 181
        })
        .is_err());
    }

    #[test]
    fn widget_settings_default_and_validation_are_stable() {
        let settings = default_widget_settings();
        assert!(!settings.enabled);
        assert_eq!(settings.display_mode, "today");
        assert!(!settings.locked);
        assert!(validate_widget_settings(&settings).is_ok());
        assert!(validate_widget_settings(&WidgetSettings {
            width: Some(200),
            height: Some(220),
            ..settings.clone()
        })
        .is_err());
        assert!(validate_widget_settings(&WidgetSettings {
            display_mode: "invalid".into(),
            ..settings
        })
        .is_err());
    }

    #[test]
    fn planner_events_validate_same_day_intervals_buffers_and_local_dates() {
        let event = PlannerEvent {
            id: "event-1".into(),
            title: "个人安排".into(),
            description: Some("说明".into()),
            date: "2026-09-24".into(),
            start_time: "09:00".into(),
            end_time: "10:00".into(),
            location: Some("图书馆".into()),
            buffer_before_minutes: 15,
            buffer_after_minutes: 20,
            created_at: "2026-09-23T08:00:00.000Z".into(),
            updated_at: "2026-09-23T08:00:00.000Z".into(),
        };
        assert!(event.validate().is_ok());
        assert!(PlannerEvent {
            start_time: "23:55".into(),
            end_time: "24:00".into(),
            ..event.clone()
        }
        .validate()
        .is_ok());
        assert!(PlannerEvent {
            end_time: "24:01".into(),
            ..event.clone()
        }
        .validate()
        .is_err());
        assert!(PlannerEvent {
            date: "2026-02-30".into(),
            ..event.clone()
        }
        .validate()
        .is_err());
        assert_eq!(
            PlannerEvent {
                start_time: "23:00".into(),
                end_time: "01:00".into(),
                ..event.clone()
            }
            .validate()
            .unwrap_err(),
            "当前版本暂不支持跨午夜日程。"
        );
        assert!(PlannerEvent {
            buffer_before_minutes: 241,
            ..event
        }
        .validate()
        .is_err());
    }

    #[test]
    fn time_blocks_require_a_task_and_valid_buffers() {
        let block = TimeBlock {
            id: "block-1".into(),
            personal_task_id: "task-1".into(),
            date: "2026-09-24".into(),
            start_time: "13:00".into(),
            end_time: "14:00".into(),
            buffer_before_minutes: 0,
            buffer_after_minutes: 240,
            created_at: "2026-09-23T08:00:00.000Z".into(),
            updated_at: "2026-09-23T08:00:00.000Z".into(),
        };
        assert!(block.validate().is_ok());
        assert!(TimeBlock {
            start_time: "23:55".into(),
            end_time: "24:00".into(),
            ..block.clone()
        }
        .validate()
        .is_ok());
        assert!(TimeBlock {
            personal_task_id: " ".into(),
            ..block.clone()
        }
        .validate()
        .is_err());
        assert!(TimeBlock {
            buffer_after_minutes: 241,
            ..block
        }
        .validate()
        .is_err());
        assert!(validate_planner_date_range("2026-09-25", "2026-09-24").is_err());
    }

    #[test]
    fn routines_validate_duration_weekdays_window_and_last_date() {
        let routine = Routine {
            id: "run".into(),
            title: "跑步".into(),
            target_duration_minutes: 40,
            weekdays_mask: 0b0010101,
            preferred_start_time: Some("18:00".into()),
            preferred_end_time: Some("21:00".into()),
            enabled: true,
            last_scheduled_date: Some("2026-09-21".into()),
            created_at: "2026-09-23T08:00:00.000Z".into(),
            updated_at: "2026-09-23T08:00:00.000Z".into(),
        };
        assert!(routine.validate().is_ok());
        assert!(Routine {
            weekdays_mask: 0,
            ..routine.clone()
        }
        .validate()
        .is_err());
        assert!(Routine {
            preferred_end_time: Some("17:00".into()),
            ..routine.clone()
        }
        .validate()
        .is_err());
        assert!(Routine {
            last_scheduled_date: Some("2026-02-30".into()),
            ..routine
        }
        .validate()
        .is_err());
    }
}
