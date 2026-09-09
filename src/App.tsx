import { useEffect, useMemo, useState } from "react";
import { CourseForm } from "./components/CourseForm.tsx";
import { PeriodSettings } from "./components/PeriodSettings.tsx";
import { Timetable } from "./components/Timetable.tsx";
import { TEST_TIMETABLE } from "./config/timetable.ts";
import { getTimelineBounds } from "./core/period-time.ts";
import { courseTiming } from "./core/timetable-layout.ts";
import { TEST_COURSES } from "./fixtures/courses.ts";
import {
  deleteStoredCourse,
  insertStoredCourse,
  loadStoredCourses,
  loadStoredPeriodTimes,
  updateStoredCourse,
  saveStoredPeriodTimes,
} from "./services/course-storage.ts";
import type { Course } from "./types/course.ts";
import type { PeriodTime } from "./types/time.ts";

export function App() {
  const [userCourses, setUserCourses] = useState<readonly Course[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [periods, setPeriods] = useState<readonly PeriodTime[]>(TEST_TIMETABLE.periods);
  const [isPeriodSettingsOpen, setIsPeriodSettingsOpen] = useState(false);
  const [isUsingTestSchedule, setIsUsingTestSchedule] = useState(true);
  const [periodMessage, setPeriodMessage] = useState("");
  const [storageStatus, setStorageStatus] = useState<"loading" | "ready" | "error">("loading");
  const [storageMessage, setStorageMessage] = useState("");
  const fixtureCourses = import.meta.env.DEV ? TEST_COURSES : [];
  const courses = useMemo(() => [...fixtureCourses, ...userCourses], [fixtureCourses, userCourses]);
  const axis = useMemo(() => getTimelineBounds(TEST_TIMETABLE.axis, periods), [periods]);
  const userCourseIds = useMemo(
    () => new Set(userCourses.map((course) => course.id)),
    [userCourses],
  );

  useEffect(() => {
    let active = true;
    void Promise.all([loadStoredCourses(), loadStoredPeriodTimes()])
      .then(([result, storedPeriods]) => {
        if (!active) return;
        const activePeriods = storedPeriods ?? TEST_TIMETABLE.periods;
        setPeriods(activePeriods);
        setIsUsingTestSchedule(storedPeriods === null);
        setPeriodMessage(
          storedPeriods === null ? "当前使用测试作息，请在设置中确认。" : "已使用自定义作息。",
        );
        const displayAxis = getTimelineBounds(TEST_TIMETABLE.axis, activePeriods);
        const warnings = [...result.warnings];
        const renderableCourses = result.courses.filter((course) => {
          try {
            courseTiming(course, displayAxis);
            return true;
          } catch {
            warnings.push(`课程“${course.name}”超出当前显示范围，已跳过且未修改原数据。`);
            return false;
          }
        });
        setUserCourses(renderableCourses);
        setStorageMessage(warnings.join(" "));
        setStorageStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStorageMessage(error instanceof Error ? error.message : "本地课程数据库不可用。");
        setStorageStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

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
          <button
            type="button"
            className="add-course-button"
            onClick={() => setIsAdding(true)}
            disabled={storageStatus !== "ready"}
            title={storageStatus === "ready" ? "添加课程" : "正在准备本地课程数据库"}
          >
            <span aria-hidden="true">＋</span> 添加课程
          </button>
          <button
            type="button"
            className="settings-button"
            onClick={() => setIsPeriodSettingsOpen(true)}
            disabled={storageStatus !== "ready"}
            title="作息设置"
          >
            设置
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
        开发模式显示 fixture；用户课程单独保存在 Windows 应用数据目录。
      </p>
      {storageStatus === "loading" && <p className="storage-notice">正在读取本地课程…</p>}
      {storageMessage && (
        <p
          className={`storage-notice storage-notice--${storageStatus}`}
          role={storageStatus === "error" ? "alert" : "status"}
        >
          {storageMessage}
        </p>
      )}
      {periodMessage && (
        <p className="schedule-notice" role="status" data-testid="schedule-notice">
          {periodMessage}
        </p>
      )}
      <Timetable
        courses={courses}
        userCourseIds={userCourseIds}
        currentWeek={TEST_TIMETABLE.currentWeek}
        axis={axis}
        pxPerMinute={TEST_TIMETABLE.pxPerMinute}
        periods={periods}
        onEditCourse={(course) => setEditingCourse(course)}
      />
      {(isAdding || editingCourse) && (
        <CourseForm
          axis={axis}
          course={editingCourse ?? undefined}
          onSave={async (course) => {
            if (editingCourse) {
              await updateStoredCourse(course);
              setUserCourses((current) =>
                current.map((item) => (item.id === editingCourse.id ? course : item)),
              );
            } else {
              await insertStoredCourse(course);
              setUserCourses((current) => [...current, course]);
            }
            setIsAdding(false);
            setEditingCourse(null);
          }}
          onDelete={async (id) => {
            await deleteStoredCourse(id);
            setUserCourses((current) => current.filter((course) => course.id !== id));
            setEditingCourse(null);
          }}
          onCancel={() => {
            setIsAdding(false);
            setEditingCourse(null);
          }}
        />
      )}
      {isPeriodSettingsOpen && (
        <PeriodSettings
          periods={periods}
          isUsingTestSchedule={isUsingTestSchedule}
          onSave={async (nextPeriods) => {
            await saveStoredPeriodTimes(nextPeriods);
            setPeriods([...nextPeriods]);
            setIsUsingTestSchedule(false);
            setPeriodMessage("已使用自定义作息。");
            setIsPeriodSettingsOpen(false);
          }}
          onCancel={() => setIsPeriodSettingsOpen(false)}
        />
      )}
    </main>
  );
}
