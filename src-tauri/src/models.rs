use serde::{Deserialize, Serialize};

pub const MAX_TEACHING_WEEK: u8 = 30;

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
}
