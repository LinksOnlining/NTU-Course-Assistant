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

fn parse_time(value: &str) -> Result<u16, String> {
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

fn parse_date(value: &str) -> Result<(u32, u32, u32), String> {
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
}
