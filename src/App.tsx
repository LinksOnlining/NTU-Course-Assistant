import { Timetable } from "./components/Timetable.tsx";
import { TEST_TIMETABLE } from "./config/timetable.ts";
import { TEST_COURSES } from "./fixtures/courses.ts";

export function App() {
  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">NTU COURSE ASSISTANT</p>
          <h1>大学课程表</h1>
          <p className="subtitle">时间决定位置，空闲时段按真实比例保留</p>
        </div>
        <div className="week-status" aria-label={`当前为测试第 ${TEST_TIMETABLE.currentWeek} 周`}>
          <span>测试教学周</span>
          <strong>第 {TEST_TIMETABLE.currentWeek} 周</strong>
          <small>周一至周日</small>
        </div>
      </header>
      <p className="fixture-notice">当前显示测试课程，不代表南通大学正式课表或作息。</p>
      <Timetable
        courses={TEST_COURSES}
        currentWeek={TEST_TIMETABLE.currentWeek}
        axis={TEST_TIMETABLE.axis}
        pxPerMinute={TEST_TIMETABLE.pxPerMinute}
      />
    </main>
  );
}
