import { useMemo, useState } from "react";
import { CourseForm } from "./components/CourseForm.tsx";
import { Timetable } from "./components/Timetable.tsx";
import { TEST_TIMETABLE } from "./config/timetable.ts";
import { TEST_COURSES } from "./fixtures/courses.ts";
import type { Course } from "./types/course.ts";

export function App() {
  const [userCourses, setUserCourses] = useState<readonly Course[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const courses = useMemo(() => [...TEST_COURSES, ...userCourses], [userCourses]);
  const userCourseIds = useMemo(
    () => new Set(userCourses.map((course) => course.id)),
    [userCourses],
  );

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <p className="eyebrow">NTU COURSE ASSISTANT</p>
          <div className="title-row">
            <h1>大学课程表</h1>
            <span className="prototype-badge">桌面原型</span>
          </div>
          <p className="subtitle">时间决定位置，空闲时段按真实比例保留</p>
        </div>
        <div className="header-actions">
          <button type="button" className="add-course-button" onClick={() => setIsAdding(true)}>
            <span aria-hidden="true">＋</span> 添加课程
          </button>
          <div className="week-status" aria-label={`当前为测试第 ${TEST_TIMETABLE.currentWeek} 周`}>
            <span>测试教学周</span>
            <strong>第 {TEST_TIMETABLE.currentWeek} 周</strong>
            <small>周一至周日</small>
          </div>
        </div>
      </header>
      <p className="fixture-notice" role="status">
        <strong>测试数据</strong>
        测试课程仍用于自动化验证；新增课程会标记为“用户添加”，本阶段关闭应用后会丢失。
      </p>
      <Timetable
        courses={courses}
        userCourseIds={userCourseIds}
        currentWeek={TEST_TIMETABLE.currentWeek}
        axis={TEST_TIMETABLE.axis}
        pxPerMinute={TEST_TIMETABLE.pxPerMinute}
        onEditCourse={(course) => setEditingCourse(course)}
      />
      {(isAdding || editingCourse) && (
        <CourseForm
          axis={TEST_TIMETABLE.axis}
          course={editingCourse ?? undefined}
          onSave={(course) => {
            setUserCourses((current) =>
              editingCourse
                ? current.map((item) => (item.id === editingCourse.id ? course : item))
                : [...current, course],
            );
            setIsAdding(false);
            setEditingCourse(null);
          }}
          onDelete={(id) => {
            setUserCourses((current) => current.filter((course) => course.id !== id));
            setEditingCourse(null);
          }}
          onCancel={() => {
            setIsAdding(false);
            setEditingCourse(null);
          }}
        />
      )}
    </main>
  );
}
