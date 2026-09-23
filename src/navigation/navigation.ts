import type { AcademicHubTab, AppRoute, LocalDate, NavigationTarget } from "./types.ts";

export type AcademicRoute = Extract<AppRoute, { area: "academic" }>;
export type ProductMode = "workspace" | "academic";
export type ShellRouteView =
  "workspace-home" | "academic-schedule" | "academic-hub" | "unsupported";

export function createWorkspaceHomeTarget(): NavigationTarget {
  return { route: { area: "workspace", page: "home" } };
}

export function createAcademicScheduleTarget(): NavigationTarget {
  return { route: { area: "academic", page: "schedule" } };
}

export function routeForProductMode(
  mode: ProductMode,
  lastAcademicRoute: AcademicRoute | null = null,
): AppRoute {
  if (mode === "workspace") return createWorkspaceHomeTarget().route;
  return lastAcademicRoute ?? createAcademicScheduleTarget().route;
}

export function getShellRouteView(route: AppRoute): ShellRouteView {
  if (route.area === "workspace") {
    return route.page === "home" ? "workspace-home" : "unsupported";
  }
  if (route.area === "settings") return "unsupported";
  return route.page === "schedule" ? "academic-schedule" : "academic-hub";
}

export function createAcademicTaskTarget(id: string): NavigationTarget {
  return {
    route: { area: "academic", page: "tasks-legacy" },
    object: { type: "academicTask", id },
  };
}

export function createExamTarget(id: string): NavigationTarget {
  return {
    route: { area: "academic", page: "exams" },
    object: { type: "exam", id },
  };
}

export function createAcademicOccurrenceTarget(
  courseId: string,
  date: LocalDate,
): NavigationTarget {
  return {
    route: { area: "academic", page: "schedule" },
    object: { type: "academicOccurrence", courseId, date },
    date,
  };
}

export function isWorkspaceRoute(
  route: AppRoute,
): route is Extract<AppRoute, { area: "workspace" }> {
  return route.area === "workspace";
}

export function isAcademicRoute(route: AppRoute): route is Extract<AppRoute, { area: "academic" }> {
  return route.area === "academic";
}

export function getAcademicHubTab(route: AppRoute): AcademicHubTab | null {
  if (route.area === "workspace" && route.page === "home") return "today";
  if (route.area !== "academic") return null;

  switch (route.page) {
    case "changes":
      return "changes";
    case "tasks-legacy":
      return "tasks";
    case "exams":
      return "exams";
    case "semesters":
      return "semesters";
    default:
      return null;
  }
}

export function routeForAcademicHubTab(tab: AcademicHubTab): AppRoute {
  switch (tab) {
    case "today":
      return { area: "workspace", page: "home" };
    case "changes":
      return { area: "academic", page: "changes" };
    case "tasks":
      return { area: "academic", page: "tasks-legacy" };
    case "exams":
      return { area: "academic", page: "exams" };
    case "semesters":
      return { area: "academic", page: "semesters" };
  }
}
