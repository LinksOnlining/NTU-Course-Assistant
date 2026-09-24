import type { CapabilityContribution } from "../../modules/contracts.ts";
import { bindCapabilityImplementations, workplaceModuleRegistry } from "../../modules/registry.ts";
import type { Routine, RoutineSuggestion } from "../../types/routine.ts";
import type { WeatherSnapshot } from "../../types/weather.ts";
import type { TimelineItem } from "../timeline/types.ts";
import { suggestRoutine } from "../planner/routines.ts";
import { formatTemperature, weatherCodeLabel } from "../weather/weather.ts";

/** 输入按 provider ID 隔离：天气只拿天气数据，个人模块只拿其最小结构摘要。 */
export interface WorkspaceContextProviderInputMap {
  readonly "diary.context": { readonly hasDiaryToday: boolean };
  readonly "inbox.context": { readonly pendingInboxCount: number };
  readonly "weather.context": { readonly weatherSnapshot: WeatherSnapshot | null };
  readonly "routine.context": {
    readonly today: string;
    readonly now: string;
    readonly routines: readonly Routine[];
    readonly timelineItems: readonly TimelineItem[];
  };
}

export interface WorkspaceContextWeatherSummary {
  readonly location: string;
  readonly condition: string;
  readonly temperature: string;
}

/** Context 模块可通过声明合并扩展本机结构化片段，不把正文或存储对象放入 Core。 */
export interface WorkspaceContextFragmentMap {
  readonly hasDiaryToday: boolean;
  readonly pendingInboxCount: number;
  readonly weatherSummary: WorkspaceContextWeatherSummary | null;
  readonly routineSuggestion: RoutineSuggestion | null;
}

export type WorkspaceContextFragment = Partial<WorkspaceContextFragmentMap>;

type ContextProviderFor<Id extends keyof WorkspaceContextProviderInputMap> =
  CapabilityContribution & {
    readonly id: Id;
    provide(input: NonNullable<WorkspaceContextProviderInputMap[Id]>): WorkspaceContextFragment;
  };

export type WorkspaceContextProvider = {
  [Id in keyof WorkspaceContextProviderInputMap]-?: ContextProviderFor<Id>;
}[keyof WorkspaceContextProviderInputMap];

export type WorkspaceContextProviderInputs = WorkspaceContextProviderInputMap;

function providerWeatherSummary(
  snapshot: WeatherSnapshot | null,
): WorkspaceContextWeatherSummary | null {
  if (!snapshot) return null;
  return {
    location: snapshot.location.displayName,
    condition: weatherCodeLabel(snapshot.current.weatherCode),
    temperature: formatTemperature(snapshot.current.temperatureCelsius, "celsius"),
  };
}

const CONTEXT_PROVIDER_IMPLEMENTATIONS = [
  {
    id: "diary.context",
    moduleId: "diary",
    order: 10,
    provide: (input) => ({ hasDiaryToday: input.hasDiaryToday }),
  },
  {
    id: "inbox.context",
    moduleId: "inbox",
    order: 20,
    provide: (input) => ({
      pendingInboxCount: Number.isFinite(input.pendingInboxCount)
        ? Math.max(0, Math.floor(input.pendingInboxCount))
        : 0,
    }),
  },
  {
    id: "weather.context",
    moduleId: "weather",
    order: 30,
    provide: (input) => ({
      weatherSummary: providerWeatherSummary(input.weatherSnapshot),
    }),
  },
  {
    id: "routine.context",
    moduleId: "routine",
    order: 40,
    provide: (input) => ({ routineSuggestion: suggestRoutine(input) }),
  },
] satisfies readonly WorkspaceContextProvider[];

export const workspaceContextProviders = bindCapabilityImplementations(
  "Context provider",
  workplaceModuleRegistry.contextProviders,
  CONTEXT_PROVIDER_IMPLEMENTATIONS,
);

/** 单个可选 provider 异常会退化为安全默认值，不阻断其余 Context。 */
export function collectWorkspaceContextFragments(
  inputs: WorkspaceContextProviderInputs,
  providers: readonly WorkspaceContextProvider[] = workspaceContextProviders,
): WorkspaceContextFragment {
  const result: Record<string, unknown> = {};

  for (const provider of providers) {
    try {
      const input = inputs[provider.id];
      if (input === undefined) continue;
      Object.assign(result, provideContextFragment(provider, input));
    } catch {
      // 可选 Context contribution 隔离；继续收集其他 provider。
    }
  }

  return Object.freeze(result) as WorkspaceContextFragment;
}

function provideContextFragment<Id extends keyof WorkspaceContextProviderInputMap>(
  provider: ContextProviderFor<Id>,
  input: NonNullable<WorkspaceContextProviderInputMap[Id]>,
): WorkspaceContextFragment {
  return provider.provide(input);
}
