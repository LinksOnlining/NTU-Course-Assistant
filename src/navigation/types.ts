/** 日期沿用应用现有的 YYYY-MM-DD 表示。 */
export type LocalDate = string;

/** 内置路由字面量；内置模块可在自己的声明文件中增补新的 area，仍保持 page 类型化。 */
export interface AppRouteMap {
  readonly workspace: "home" | "schedule" | "tasks" | "diary" | "inbox" | "search" | "ai";
  readonly academic: "schedule" | "changes" | "tasks-legacy" | "exams" | "semesters";
  readonly settings: "main";
}

export type AppRoute = {
  [Area in keyof AppRouteMap]: { readonly area: Area; readonly page: AppRouteMap[Area] };
}[keyof AppRouteMap];

/** AcademicHub 当前标签映射到 AppRoute，不再单独保存正式导航状态。 */
export type AcademicHubTab = "today" | "changes" | "tasks" | "exams" | "semesters";

/** 课程 occurrence 是派生对象；其 identity 使用课程 ID + 日期，不使用可能变化的 occurrenceKey。 */
export type AcademicOccurrenceRef = {
  readonly type: "academicOccurrence";
  readonly courseId: string;
  readonly date: LocalDate;
};

/** 引用稳定领域身份，不使用显示标题或 UI 数组下标。 */
/** 对象定位契约保留精确 discriminant，模块可通过类型声明合并增加自己的引用种类。 */
export interface ObjectRefMap {
  readonly course: { readonly type: "course"; readonly id: string };
  readonly academicOccurrence: AcademicOccurrenceRef;
  readonly academicTask: { readonly type: "academicTask"; readonly id: string };
  readonly exam: { readonly type: "exam"; readonly id: string };
  readonly semester: { readonly type: "semester"; readonly id: string };
  readonly courseOverride: { readonly type: "courseOverride"; readonly id: string };
  readonly personalTask: { readonly type: "personalTask"; readonly id: string };
  readonly plannerEvent: { readonly type: "plannerEvent"; readonly id: string };
  readonly timeBlock: { readonly type: "timeBlock"; readonly id: string };
  readonly diaryEntry: { readonly type: "diaryEntry"; readonly id: string };
  readonly inboxItem: { readonly type: "inboxItem"; readonly id: string };
}

export type ObjectRef = ObjectRefMap[keyof ObjectRefMap];

/** 纯数据导航请求；可选对象和日期用于描述目标上下文。 */
export interface NavigationTarget {
  readonly route: AppRoute;
  readonly object?: ObjectRef;
  readonly date?: LocalDate;
}
