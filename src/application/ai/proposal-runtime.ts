import { loadAcademicTermConfig } from "../academic/index.ts";
import { createPersonalTask, validatePersonalTaskDraft } from "../planner/personal-tasks.ts";
import {
  createPlannerEvent,
  createTimeBlock,
  validatePlannerEventDraft,
  validateTimeBlockDraft,
} from "../planner/planner-schedule.ts";
import { findTimelineConflicts } from "../timeline/planner-interactions.ts";
import {
  projectPlannerEventsToTimelineItems,
  projectTimeBlocksToTimelineItems,
} from "../timeline/planner-timeline.ts";
import { loadWorkspaceScheduleDay } from "../workspace/workspace-schedule.ts";
import type { PersonalTask, PersonalTaskDraft } from "../../types/personal-task.ts";
import type { PlannerEventDraft, TimeBlockDraft } from "../../types/planner.ts";
import type {
  AiPlannerProposal,
  AiProposalPreview,
  AiProposalSource,
  AiProposalWarning,
  EventProposalPayload,
  TaskProposalPayload,
  TimeBlockProposalPayload,
} from "./proposal.ts";
import { transitionAiProposal } from "./proposal.ts";
import { durationMinutes } from "../../core/time.ts";

const PROPOSAL_TTL_MS = 15 * 60_000;
const MAX_PENDING_PROPOSALS = 50;

class StaleProposalError extends Error {}

export interface AiProposalStore {
  get(id: string): AiPlannerProposal | undefined;
  set(proposal: AiPlannerProposal): void;
  delete(id: string): void;
  list(): readonly AiPlannerProposal[];
}

export function createInMemoryAiProposalStore(): AiProposalStore {
  const proposals = new Map<string, AiPlannerProposal>();
  return {
    get: (id) => proposals.get(id),
    set: (proposal) => proposals.set(proposal.id, proposal),
    delete: (id) => proposals.delete(id),
    list: () => Object.freeze([...proposals.values()]),
  };
}

export interface AiProposalRuntimePorts {
  readonly now: () => Date;
  readonly createId: () => string;
  readonly loadTermConfig: typeof loadAcademicTermConfig;
  readonly loadScheduleDay: typeof loadWorkspaceScheduleDay;
  readonly createTask: typeof createPersonalTask;
  readonly createEvent: typeof createPlannerEvent;
  readonly createBlock: typeof createTimeBlock;
}

const DEFAULT_PORTS: AiProposalRuntimePorts = {
  now: () => new Date(),
  createId: () => crypto.randomUUID(),
  loadTermConfig: loadAcademicTermConfig,
  loadScheduleDay: loadWorkspaceScheduleDay,
  createTask: createPersonalTask,
  createEvent: createPlannerEvent,
  createBlock: createTimeBlock,
};

export type AiProposalApplyResult =
  | { readonly status: "applied"; readonly proposal: AiPlannerProposal; readonly entityId: string }
  | { readonly status: "needsReconfirmation"; readonly proposal: AiPlannerProposal }
  | { readonly status: "stale" | "expired" | "notFound" | "notConfirmed" | "alreadyApplied" }
  | { readonly status: "failed"; readonly proposal: AiPlannerProposal; readonly message: string };

export interface AiPlannerProposalRuntime {
  proposeTask(input: TaskProposalPayload, source: AiProposalSource): Promise<AiPlannerProposal>;
  proposeEvent(input: EventProposalPayload, source: AiProposalSource): Promise<AiPlannerProposal>;
  proposeTimeBlock(
    input: TimeBlockProposalPayload,
    source: AiProposalSource,
  ): Promise<AiPlannerProposal>;
  get(id: string): AiPlannerProposal | undefined;
  cancel(id: string): AiPlannerProposal | undefined;
  apply(input: {
    readonly id: string;
    readonly confirmed: boolean;
    readonly expectedPreviewRevision: number;
    readonly permissionIds: readonly string[];
  }): Promise<AiProposalApplyResult>;
}

export function createAiPlannerProposalRuntime(
  input: {
    readonly store?: AiProposalStore;
    readonly ports?: Partial<AiProposalRuntimePorts>;
  } = {},
): AiPlannerProposalRuntime {
  const store = input.store ?? createInMemoryAiProposalStore();
  const ports = { ...DEFAULT_PORTS, ...input.ports };
  const applying = new Map<string, Promise<AiProposalApplyResult>>();

  function save(proposal: AiPlannerProposal): AiPlannerProposal {
    pruneExpired(store, ports.now().getTime());
    const entries = store.list();
    if (entries.length >= MAX_PENDING_PROPOSALS) {
      const removable = entries
        .filter((entry) => entry.status !== "reviewRequired" && entry.status !== "draft")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      for (const entry of removable) {
        store.delete(entry.id);
        if (store.list().length < MAX_PENDING_PROPOSALS) break;
      }
    }
    if (store.list().length >= MAX_PENDING_PROPOSALS) {
      throw new Error("待审提案数量已达上限，请先处理已有提案。");
    }
    store.set(proposal);
    return proposal;
  }

  async function makeProposal<Type extends AiPlannerProposal["type"]>(input: {
    readonly type: Type;
    readonly payload: Type extends "task"
      ? TaskProposalPayload
      : Type extends "event"
        ? EventProposalPayload
        : TimeBlockProposalPayload;
    readonly source: AiProposalSource;
    readonly title: string;
    readonly fields: AiProposalPreview["fields"];
    readonly warnings?: readonly AiProposalWarning[];
    readonly preconditionFingerprint?: string;
    readonly linkedTask?: PersonalTask;
  }): Promise<AiPlannerProposal> {
    const now = ports.now();
    const id = ports.createId();
    const warnings = input.warnings ?? [];
    const proposal = {
      id,
      type: input.type,
      source: input.source,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS).toISOString(),
      status: "reviewRequired" as const,
      requiredPermission: "planner.propose" as const,
      requiresConfirmation: true as const,
      title: input.title,
      description: "这是一个待确认的规划提案；确认前不会写入数据。",
      payload: input.payload,
      preview: Object.freeze({
        title: input.title,
        fields: freezeFields(input.fields),
        warnings: Object.freeze(
          warnings.map((warning) =>
            Object.freeze({
              ...warning,
              details: Object.freeze([...warning.details]),
            }),
          ),
        ),
        revision: 1,
      }),
      preconditions: Object.freeze({
        warningFingerprint: input.preconditionFingerprint ?? fingerprintWarnings(warnings),
        ...(input.linkedTask
          ? {
              linkedTask: {
                id: input.linkedTask.id,
                updatedAt: input.linkedTask.updatedAt,
                status: input.linkedTask.status,
              },
            }
          : {}),
      }),
    } as AiPlannerProposal;
    Object.freeze(proposal);
    return save(proposal);
  }

  async function createWarnings(
    date: string,
    type: "event" | "timeBlock",
    payload: EventProposalPayload | TimeBlockProposalPayload,
  ) {
    const termConfig = await ports.loadTermConfig();
    const day = await ports.loadScheduleDay(date, termConfig);
    const task =
      type === "timeBlock"
        ? day.tasks.find(
            (candidate) => candidate.id === (payload as TimeBlockProposalPayload).personalTaskId,
          )
        : undefined;
    if (type === "timeBlock" && (!task || task.status !== "open")) {
      throw new StaleProposalError("关联任务不存在或已完成，无法创建时间块提案。");
    }
    const id = `proposal-${ports.createId()}`;
    const proposed =
      type === "event"
        ? projectPlannerEventsToTimelineItems([
            {
              id,
              title: (payload as EventProposalPayload).title,
              description: null,
              date,
              startTime: (payload as EventProposalPayload).startTime,
              endTime: (payload as EventProposalPayload).endTime,
              location: (payload as EventProposalPayload).location,
              bufferBeforeMinutes: payload.bufferBeforeMinutes,
              bufferAfterMinutes: payload.bufferAfterMinutes,
              createdAt: "",
              updatedAt: "",
            },
          ])[0]
        : projectTimeBlocksToTimelineItems(
            [
              {
                id,
                personalTaskId: (payload as TimeBlockProposalPayload).personalTaskId,
                date,
                startTime: (payload as TimeBlockProposalPayload).startTime,
                endTime: (payload as TimeBlockProposalPayload).endTime,
                bufferBeforeMinutes: payload.bufferBeforeMinutes,
                bufferAfterMinutes: payload.bufferAfterMinutes,
                createdAt: "",
                updatedAt: "",
              },
            ],
            day.tasks,
          )[0];
    const conflicts = findTimelineConflicts(day.timelineItems, proposed);
    const warnings = conflicts.map((conflict): AiProposalWarning => ({
      code: "timeConflict",
      message: "与已有安排的占用时间冲突。",
      details: [`${conflict.title} · ${conflict.startTime}–${conflict.endTime}`],
    }));
    return {
      warnings: Object.freeze(warnings),
      task,
      fingerprint: fingerprintItems(conflicts, task),
    };
  }

  const runtime: AiPlannerProposalRuntime = {
    async proposeTask(raw, source) {
      const payload = normalizeTaskPayload(raw);
      const draft: PersonalTaskDraft = {
        title: payload.title,
        description: "",
        priority: payload.priority,
        deadlineDate: payload.deadlineDate ?? "",
        deadlineTime: payload.deadlineTime ?? "",
      };
      assertNoErrors(validatePersonalTaskDraft(draft));
      return makeProposal({
        type: "task",
        payload,
        source,
        title: "建议创建任务",
        fields: [
          { label: "任务", value: payload.title },
          { label: "优先级", value: priorityLabel(payload.priority) },
          { label: "截止日期", value: payload.deadlineDate ?? "未设置" },
          { label: "截止时间", value: payload.deadlineTime ?? "未设置" },
        ],
      });
    },
    async proposeEvent(raw, source) {
      const payload = normalizeEventPayload(raw);
      const draft: PlannerEventDraft = {
        title: payload.title,
        description: "",
        date: payload.date,
        startTime: payload.startTime,
        endTime: payload.endTime,
        location: payload.location ?? "",
        bufferBeforeMinutes: payload.bufferBeforeMinutes,
        bufferAfterMinutes: payload.bufferAfterMinutes,
      };
      assertNoErrors(validatePlannerEventDraft(draft));
      const result = await createWarnings(payload.date, "event", payload);
      return makeProposal({
        type: "event",
        payload,
        source,
        title: "建议创建日程",
        fields: eventFields(payload),
        warnings: result.warnings,
        preconditionFingerprint: result.fingerprint,
      });
    },
    async proposeTimeBlock(raw, source) {
      const payload = normalizeTimeBlockPayload(raw);
      const draft: TimeBlockDraft = payload;
      assertNoErrors(validateTimeBlockDraft(draft));
      const result = await createWarnings(payload.date, "timeBlock", payload);
      return makeProposal({
        type: "timeBlock",
        payload,
        source,
        title: "建议安排任务时间块",
        fields: [
          { label: "任务", value: result.task?.title ?? "关联任务" },
          { label: "日期", value: payload.date },
          { label: "开始", value: payload.startTime },
          { label: "结束", value: payload.endTime },
          { label: "时长", value: `${durationMinutes(payload)} 分钟` },
          {
            label: "提前 / 延后缓冲",
            value: `${payload.bufferBeforeMinutes} / ${payload.bufferAfterMinutes} 分钟`,
          },
        ],
        warnings: result.warnings,
        preconditionFingerprint: result.fingerprint,
        linkedTask: result.task,
      });
    },
    get: (id) => store.get(id),
    cancel(id) {
      const proposal = store.get(id);
      if (!proposal || proposal.status !== "reviewRequired") return proposal;
      const rejected = transitionAiProposal(proposal, "rejected");
      store.set(rejected);
      return rejected;
    },
    async apply(applyInput) {
      const active = applying.get(applyInput.id);
      if (active) return active;
      const operation = applyProposal(applyInput);
      applying.set(applyInput.id, operation);
      try {
        return await operation;
      } finally {
        applying.delete(applyInput.id);
      }
    },
  };

  async function applyProposal(applyInput: {
    readonly id: string;
    readonly confirmed: boolean;
    readonly expectedPreviewRevision: number;
    readonly permissionIds: readonly string[];
  }): Promise<AiProposalApplyResult> {
    const proposal = store.get(applyInput.id);
    if (!proposal) return { status: "notFound" };
    if (proposal.status === "applied") return { status: "alreadyApplied" };
    if (proposal.status !== "reviewRequired") return { status: "stale" };
    if (!applyInput.confirmed) return { status: "notConfirmed" };
    if (!applyInput.permissionIds.includes("planner.propose")) return { status: "notConfirmed" };
    if (ports.now().getTime() > Date.parse(proposal.expiresAt)) {
      store.set(transitionAiProposal(proposal, "stale"));
      return { status: "expired" };
    }
    if (applyInput.expectedPreviewRevision !== proposal.preview.revision) {
      return { status: "needsReconfirmation", proposal };
    }
    if (scheduleProposalIsPast(proposal, ports.now())) {
      store.set(transitionAiProposal(proposal, "stale"));
      return { status: "stale" };
    }

    try {
      const latest = await refreshProposalPreview(proposal);
      const changed =
        latest.preconditions.warningFingerprint !== proposal.preconditions.warningFingerprint ||
        linkedTaskChanged(proposal, latest);
      if (changed) {
        const refreshed = Object.freeze({
          ...proposal,
          preview: Object.freeze({ ...latest.preview, revision: proposal.preview.revision + 1 }),
          preconditions: latest.preconditions,
        }) as AiPlannerProposal;
        store.set(refreshed);
        return { status: "needsReconfirmation", proposal: refreshed };
      }

      const approved = transitionAiProposal(proposal, "approved");
      store.set(approved);
      let entityId: string;
      if (approved.type === "task") {
        const payload = approved.payload as TaskProposalPayload;
        const created = await ports.createTask({
          title: payload.title,
          description: "",
          priority: payload.priority,
          deadlineDate: payload.deadlineDate ?? "",
          deadlineTime: payload.deadlineTime ?? "",
        });
        entityId = created.id;
      } else if (approved.type === "event") {
        const payload = approved.payload as EventProposalPayload;
        const created = await ports.createEvent({
          title: payload.title,
          description: "",
          date: payload.date,
          startTime: payload.startTime,
          endTime: payload.endTime,
          location: payload.location ?? "",
          bufferBeforeMinutes: payload.bufferBeforeMinutes,
          bufferAfterMinutes: payload.bufferAfterMinutes,
        });
        entityId = created.id;
      } else {
        const payload = approved.payload as TimeBlockProposalPayload;
        const created = await ports.createBlock(payload);
        entityId = created.id;
      }
      const applied = transitionAiProposal(approved, "applied");
      store.set(applied);
      return { status: "applied", proposal: applied, entityId };
    } catch (error) {
      const current = store.get(proposal.id);
      if (error instanceof StaleProposalError && current?.status === "reviewRequired") {
        store.set(transitionAiProposal(current, "stale"));
        return { status: "stale" };
      }
      if (current?.status === "approved") {
        const failed = transitionAiProposal(current, "failed");
        store.set(failed);
        return { status: "failed", proposal: failed, message: safeErrorMessage(error) };
      }
      return { status: "failed", proposal, message: safeErrorMessage(error) };
    }
  }

  async function refreshProposalPreview(proposal: AiPlannerProposal): Promise<AiPlannerProposal> {
    if (proposal.type === "task") return proposal;
    const result = await createWarnings(
      proposal.payload.date,
      proposal.type,
      proposal.payload as EventProposalPayload | TimeBlockProposalPayload,
    );
    const fields =
      proposal.type === "event"
        ? eventFields(proposal.payload)
        : [
            { label: "任务", value: result.task?.title ?? "关联任务" },
            ...eventFields({
              ...proposal.payload,
              title: result.task?.title ?? "时间块",
              location: null,
            }),
          ];
    const refreshed = Object.freeze({
      ...proposal,
      preview: Object.freeze({
        ...proposal.preview,
        fields: freezeFields(fields),
        warnings: result.warnings,
      }),
      preconditions: Object.freeze({
        warningFingerprint: result.fingerprint,
        ...(result.task
          ? {
              linkedTask: {
                id: result.task.id,
                updatedAt: result.task.updatedAt,
                status: result.task.status,
              },
            }
          : {}),
      }),
    }) as AiPlannerProposal;
    return refreshed;
  }

  return runtime;
}

export const aiPlannerProposalRuntime = createAiPlannerProposalRuntime();

function normalizeTaskPayload(input: TaskProposalPayload): TaskProposalPayload {
  return Object.freeze({
    title: normalizeText(input.title, 200),
    deadlineDate: input.deadlineDate ? validateDate(input.deadlineDate) : null,
    deadlineTime: input.deadlineTime ? validateTime(input.deadlineTime) : null,
    priority: input.priority,
  });
}

function normalizeEventPayload(input: EventProposalPayload): EventProposalPayload {
  return Object.freeze({
    title: normalizeText(input.title, 200),
    date: validateDate(input.date),
    startTime: validateTime(input.startTime),
    endTime: validateTime(input.endTime),
    location: input.location ? normalizeText(input.location, 200) : null,
    bufferBeforeMinutes: input.bufferBeforeMinutes,
    bufferAfterMinutes: input.bufferAfterMinutes,
  });
}

function normalizeTimeBlockPayload(input: TimeBlockProposalPayload): TimeBlockProposalPayload {
  return Object.freeze({
    personalTaskId: normalizeText(input.personalTaskId, 128),
    date: validateDate(input.date),
    startTime: validateTime(input.startTime),
    endTime: validateTime(input.endTime),
    bufferBeforeMinutes: input.bufferBeforeMinutes,
    bufferAfterMinutes: input.bufferAfterMinutes,
  });
}

function normalizeText(value: string, maximum: number): string {
  const normalized = [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join("")
    .trim();
  if (!normalized || [...normalized].length > maximum) throw new Error("提案文本无效。");
  return normalized;
}

function validateDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error("提案日期无效。");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error("提案日期无效。");
  }
  return value;
}

function validateTime(value: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(value)) throw new Error("提案时间无效。");
  return value;
}

function assertNoErrors(errors: Readonly<Record<string, string | undefined>>): void {
  const first = Object.values(errors).find((value) => value !== undefined);
  if (first) throw new Error(first);
}

function eventFields(payload: EventProposalPayload): AiProposalPreview["fields"] {
  return Object.freeze([
    { label: "日期", value: payload.date },
    { label: "时间", value: `${payload.startTime}–${payload.endTime}` },
    { label: "地点", value: payload.location ?? "未设置" },
    {
      label: "提前 / 延后缓冲",
      value: `${payload.bufferBeforeMinutes} / ${payload.bufferAfterMinutes} 分钟`,
    },
  ]);
}

function freezeFields(fields: AiProposalPreview["fields"]): AiProposalPreview["fields"] {
  return Object.freeze(fields.map((field) => Object.freeze({ ...field })));
}

function priorityLabel(priority: TaskProposalPayload["priority"]): string {
  return { none: "无", low: "低", medium: "中", high: "高" }[priority];
}

function fingerprintWarnings(warnings: readonly AiProposalWarning[]): string {
  return JSON.stringify(warnings.map((warning) => [warning.code, [...warning.details].sort()]));
}

function fingerprintItems(
  items: readonly {
    readonly id: string;
    readonly date: string;
    readonly startTime: string;
    readonly endTime: string;
    readonly title: string;
  }[],
  task?: PersonalTask,
): string {
  return JSON.stringify({
    conflicts: items
      .map((item) => [item.id, item.date, item.startTime, item.endTime, item.title])
      .sort(),
    task: task ? [task.id, task.updatedAt, task.status, task.title] : null,
  });
}

function linkedTaskChanged(before: AiPlannerProposal, after: AiPlannerProposal): boolean {
  return (
    JSON.stringify(before.preconditions.linkedTask ?? null) !==
    JSON.stringify(after.preconditions.linkedTask ?? null)
  );
}

function scheduleProposalIsPast(proposal: AiPlannerProposal, now: Date): boolean {
  if (proposal.type === "task") return false;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  const localDateTime = `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
  return `${proposal.payload.date}T${proposal.payload.startTime}` <= localDateTime;
}

function pruneExpired(store: AiProposalStore, now: number): void {
  for (const proposal of store.list()) {
    if (proposal.status === "reviewRequired" && Date.parse(proposal.expiresAt) < now) {
      store.set(transitionAiProposal(proposal, "stale"));
    }
  }
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length <= 240) return error.message;
  return "保存提案失败，请检查当前数据后重试。";
}
