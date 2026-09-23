import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const source = (pathFromRoot) =>
  readFileSync(new URL(`../../${pathFromRoot}`, import.meta.url), "utf8");
const applicationFiles = readdirSync(new URL("../../src/application/academic/", import.meta.url))
  .filter((name) => name.endsWith(".ts"))
  .map((name) => `src/application/academic/${name}`);

test("Academic application has no dependency on presentation", () => {
  for (const pathFromRoot of applicationFiles) {
    assert.doesNotMatch(source(pathFromRoot), /(?:components|App\.tsx|main\.tsx)/);
  }
});

test("core and services do not depend on the application layer", () => {
  for (const layer of ["core", "services"]) {
    const directory = new URL(`../../src/${layer}/`, import.meta.url);
    for (const name of readdirSync(directory, { recursive: true })) {
      if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
      const relativeName = name.replaceAll("\\", "/");
      assert.doesNotMatch(source(`src/${layer}/${relativeName}`), /(?:\.\.\/)+application\//);
    }
  }
});

test("main Academic presentation no longer imports raw read functions", () => {
  const rawAcademicReads =
    /\b(?:loadStoredCourses|loadStoredPeriodTimes|loadSemesters|loadCourseOverrides|loadAcademicTasks|loadExams)\b/;
  for (const file of ["src/App.tsx", "src/components/AcademicHub.tsx"]) {
    assert.doesNotMatch(source(file), rawAcademicReads, `${file} bypasses Academic Application`);
    assert.match(source(file), /application\/academic\/index\.ts/);
  }
});

test("occurrence application API transparently delegates to the canonical resolver", () => {
  const application = source("src/application/academic/academic-application.ts");
  assert.match(application, /from "\.\.\/\.\.\/core\/course-occurrence\.ts"/);
  assert.match(
    application,
    /return resolveCourseOccurrences\(courses, semester, overrides, range, periods\);/,
  );
  assert.equal((application.match(/resolveCourseOccurrences\(/g) ?? []).length, 1);
});
