import type { ObjectRef } from "../../navigation/types.ts";
import type { WorkspaceContext } from "../workspace/workspace-context.ts";
import type { AiIntent } from "./types.ts";
import type { AiContextPermissionId, AiDataAccessSettings, AiPermissionId } from "./permission.ts";
import type { AiRequestGrant } from "./request-grant.ts";

export type AiJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly AiJsonValue[]
  | { readonly [key: string]: AiJsonValue };

export interface AiContextDateRange {
  readonly startDate: string;
  readonly endDate: string;
}

/** 已由上游按本机时区确定的时间，不在 AI Context 层重新解释时区。 */
export interface AiContextTime {
  readonly localDate: string;
  readonly localTime: string;
  readonly timeZone: string;
}

export interface AiContextRequest {
  readonly id: string;
  readonly intent: AiIntent;
  readonly generatedAt?: string;
  readonly requestedScopes: readonly string[];
  readonly selectedItems: readonly ObjectRef[];
  readonly timeContext: AiContextTime;
  readonly timeRange?: AiContextDateRange;
  /** 只能由 Application orchestration 在单次明确同意后提供。 */
  readonly requestGrants?: readonly AiRequestGrant[];
  readonly budget?: Partial<AiContextBudget>;
}

export interface AiWorkspaceSnapshot {
  readonly context: Pick<
    WorkspaceContext,
    | "date"
    | "localTime"
    | "nextFreeSlot"
    | "todayItemCount"
    | "remainingItemCount"
    | "openTaskCount"
    | "overdueTaskCount"
    | "todayTaskCount"
    | "hasDiaryToday"
    | "pendingInboxCount"
  >;
}

export interface AiAcademicOccurrence {
  readonly courseId: string;
  readonly date: string;
  readonly teachingWeek: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly room: string | null;
  readonly teacher: string | null;
  readonly status: string;
}

export interface AiExamSummary {
  readonly id: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly location: string | null;
  readonly status: string;
}

export interface AiAcademicDeadline {
  readonly id: string;
  readonly title: string;
  readonly dueAt: string;
  readonly priority: number;
  readonly status: string;
  readonly type: string;
}

export interface AiAcademicSnapshot {
  readonly occurrences: readonly AiAcademicOccurrence[];
  readonly exams: readonly AiExamSummary[];
  readonly deadlines: readonly AiAcademicDeadline[];
  /** 用 canonical occurrence ID 查询到的安全展示名，不是完整 Course entity。 */
  readonly courseNames: Readonly<Record<string, string>>;
  /** Source-side item cap signal; planning must not treat a partial calendar as complete. */
  readonly truncated?: boolean;
}

export interface AiPlannerTask {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly deadlineDate: string | null;
  readonly deadlineTime: string | null;
}

export interface AiPlannerEvent {
  readonly id: string;
  readonly title: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
}

export interface AiPlannerTimeBlock {
  readonly id: string;
  readonly personalTaskId: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly bufferBeforeMinutes: number;
  readonly bufferAfterMinutes: number;
}

export interface AiPlannerSnapshot {
  readonly tasks: readonly AiPlannerTask[];
  readonly events: readonly AiPlannerEvent[];
  readonly timeBlocks: readonly AiPlannerTimeBlock[];
  /** Source-side item cap signal; planning must not treat a partial schedule as complete. */
  readonly truncated?: boolean;
}

export interface AiRoutineSummary {
  readonly id: string;
  readonly title: string;
  readonly targetDurationMinutes: number;
  readonly weekdaysMask: number;
  readonly preferredStartTime: string | null;
  readonly preferredEndTime: string | null;
  readonly enabled: boolean;
  readonly lastScheduledDate: string | null;
}

export interface AiRoutineSnapshot {
  readonly routines: readonly AiRoutineSummary[];
}

export interface AiWeatherCurrent {
  readonly time: string;
  readonly weatherCode: number;
  readonly temperatureCelsius: number;
  readonly humidityPercent: number | null;
}

export interface AiWeatherHour {
  readonly time: string;
  readonly weatherCode: number;
  readonly temperatureCelsius: number;
  readonly precipitationProbability: number | null;
}

export interface AiWeatherSummary {
  readonly locationLabel: string | null;
  readonly current: AiWeatherCurrent | null;
  readonly hourly: readonly AiWeatherHour[];
}

export interface AiWeatherSnapshot {
  readonly snapshot: AiWeatherSummary | null;
}

export interface AiDiarySnapshot {
  readonly entries: readonly {
    readonly id: string;
    readonly date: string;
    readonly body: string;
  }[];
}

export interface AiInboxSnapshot {
  readonly items: readonly {
    readonly id: string;
    readonly capturedAt: string;
    readonly rawText: string;
  }[];
}

export interface AiContextSnapshotMap {
  readonly workspace: AiWorkspaceSnapshot;
  readonly academic: AiAcademicSnapshot;
  readonly planner: AiPlannerSnapshot;
  readonly routine: AiRoutineSnapshot;
  readonly weather: AiWeatherSnapshot;
  readonly diary: AiDiarySnapshot;
  readonly inbox: AiInboxSnapshot;
}

export type AiContextModuleId = keyof AiContextSnapshotMap;

/** Source port 由 Application 组合层用各模块公开 query/use case 接入；AI 不访问存储。 */
export interface AiContextSourceRequest {
  readonly intent: AiIntent;
  readonly timeRange: AiContextDateRange;
  readonly selectedItems: readonly ObjectRef[];
  readonly timeContext: AiContextTime;
}

export type AiContextSources = Partial<{
  readonly [Module in AiContextModuleId]: (
    request: AiContextSourceRequest,
  ) => Promise<AiContextSnapshotMap[Module]>;
}>;

export interface AiContextBudget {
  readonly maxTotalBytes: number;
  readonly maxModuleBytes: number;
  readonly maxStringLength: number;
  readonly maxItemsPerModule: number;
  readonly maxSelectedItems: number;
}

export const DEFAULT_AI_CONTEXT_BUDGET: AiContextBudget = Object.freeze({
  maxTotalBytes: 32 * 1024,
  maxModuleBytes: 8 * 1024,
  maxStringLength: 512,
  maxItemsPerModule: 50,
  maxSelectedItems: 20,
});

export type AiContextOmissionReason =
  | "permission"
  | "unknownPermission"
  | "requestConsentRequired"
  | "inactiveMutation"
  | "sourceUnavailable"
  | "budget";

export interface AiContextOmittedScope {
  readonly permissionId: string;
  readonly reason: AiContextOmissionReason;
}

export interface AiContextRedaction {
  readonly scope: string;
  readonly reason: AiContextOmissionReason | "privacy";
}

export interface AiContextBundle {
  readonly requestId: string;
  readonly generatedAt: string;
  readonly timeContext: AiContextTime;
  readonly selectedItems: readonly ObjectRef[];
  readonly moduleContexts: Readonly<Partial<Record<AiContextModuleId, AiJsonValue>>>;
  readonly permissions: {
    readonly includedScopes: readonly AiContextPermissionId[];
    readonly omittedScopes: readonly AiContextOmittedScope[];
  };
  readonly redactions: readonly AiContextRedaction[];
  readonly providerFailures: readonly {
    readonly moduleId: AiContextModuleId;
    readonly category: "sourceUnavailable";
  }[];
  readonly budget: AiContextBudget & {
    readonly usedBytes: number;
    readonly truncated: boolean;
    readonly omittedCount: number;
    readonly truncatedModules: readonly AiContextModuleId[];
    readonly moduleBytes: Readonly<Partial<Record<AiContextModuleId, number>>>;
  };
}

/** 纯上下文装配能力；sources 必须来自各模块公开 Application Query / UseCase。 */
export interface AiContextProvider {
  buildContext(
    request: AiContextRequest,
    settings: AiDataAccessSettings,
    sources: AiContextSources,
  ): Promise<AiContextBundle>;
}

export type { AiContextPermissionId, AiPermissionId };
