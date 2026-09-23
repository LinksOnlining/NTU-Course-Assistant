/** 日期沿用应用现有的 YYYY-MM-DD 表示。 */
export type LocalDate = string;

export type AppRoute =
  | { readonly area: "workspace"; readonly page: "home" }
  | { readonly area: "workspace"; readonly page: "schedule" }
  | { readonly area: "workspace"; readonly page: "tasks" }
  | { readonly area: "workspace"; readonly page: "diary" }
  | { readonly area: "workspace"; readonly page: "inbox" }
  | { readonly area: "workspace"; readonly page: "ai" }
  | { readonly area: "academic"; readonly page: "schedule" }
  | { readonly area: "academic"; readonly page: "changes" }
  /** 现有 AcademicTask 界面的临时入口，待后续工作台任务阶段迁移。 */
  | { readonly area: "academic"; readonly page: "tasks-legacy" }
  | { readonly area: "academic"; readonly page: "exams" }
  | { readonly area: "academic"; readonly page: "semesters" }
  | { readonly area: "settings"; readonly page: "main" };

/** AcademicHub 当前标签映射到 AppRoute，不再单独保存正式导航状态。 */
export type AcademicHubTab = "today" | "changes" | "tasks" | "exams" | "semesters";

/** 课程 occurrence 是派生对象；其 identity 使用课程 ID + 日期，不使用可能变化的 occurrenceKey。 */
export type AcademicOccurrenceRef = {
  readonly type: "academicOccurrence";
  readonly courseId: string;
  readonly date: LocalDate;
};

/** 引用稳定领域身份，不使用显示标题或 UI 数组下标。 */
export type ObjectRef =
  | { readonly type: "course"; readonly id: string }
  | AcademicOccurrenceRef
  | { readonly type: "academicTask"; readonly id: string }
  | { readonly type: "exam"; readonly id: string }
  | { readonly type: "semester"; readonly id: string }
  | { readonly type: "courseOverride"; readonly id: string }
  | { readonly type: "personalTask"; readonly id: string }
  | { readonly type: "plannerEvent"; readonly id: string }
  | { readonly type: "timeBlock"; readonly id: string }
  | { readonly type: "diaryEntry"; readonly id: string }
  | { readonly type: "inboxItem"; readonly id: string };

/** 纯数据导航请求；可选对象和日期用于描述目标上下文。 */
export interface NavigationTarget {
  readonly route: AppRoute;
  readonly object?: ObjectRef;
  readonly date?: LocalDate;
}
