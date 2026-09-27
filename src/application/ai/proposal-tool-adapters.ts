import type { AiToolExecutionContext } from "./tool.ts";
import type { AiToolAdapter } from "./tool-registry.ts";
import { aiPlannerProposalRuntime } from "./proposal-runtime.ts";
import type {
  EventProposalPayload,
  TaskProposalPayload,
  TimeBlockProposalPayload,
  AiProposalSource,
} from "./proposal.ts";

const adapters: readonly AiToolAdapter[] = [
  {
    id: "planner.propose-task",
    parseInput: (value) => value as TaskProposalPayload,
    execute: async (value, context) => {
      requireProposalReporter(context);
      const proposal = await aiPlannerProposalRuntime.proposeTask(
        canonicalTaskPayload(value as TaskProposalPayload, context),
        source(context),
      );
      context.reportProposal(proposal);
      return { status: "reviewRequired", proposalId: proposal.id, proposalType: proposal.type };
    },
  },
  {
    id: "planner.propose-event",
    parseInput: (value) => value as PlannerCandidateSelection,
    execute: async (value, context) => {
      requireProposalReporter(context);
      const proposal = await aiPlannerProposalRuntime.proposeEvent(
        canonicalSchedulePayload<EventProposalPayload>(
          value as PlannerCandidateSelection,
          context,
          "planner.propose-event",
        ),
        source(context),
      );
      context.reportProposal(proposal);
      return { status: "reviewRequired", proposalId: proposal.id, proposalType: proposal.type };
    },
  },
  {
    id: "planner.propose-time-block",
    parseInput: (value) => value as PlannerCandidateSelection,
    execute: async (value, context) => {
      requireProposalReporter(context);
      const proposal = await aiPlannerProposalRuntime.proposeTimeBlock(
        canonicalSchedulePayload<TimeBlockProposalPayload>(
          value as PlannerCandidateSelection,
          context,
          "planner.propose-time-block",
        ),
        source(context),
      );
      context.reportProposal(proposal);
      return { status: "reviewRequired", proposalId: proposal.id, proposalType: proposal.type };
    },
  },
];

export const AI_PROPOSAL_TOOL_ADAPTERS = Object.freeze(adapters);

interface PlannerCandidateSelection {
  readonly candidateId: string;
}

function source(context?: AiToolExecutionContext): AiProposalSource {
  if (context?.providerId === "mock" || context?.providerId === "deepseek")
    return context.providerId;
  throw new Error("Proposal tool requires trusted provider context.");
}

function requireProposalReporter(
  context?: AiToolExecutionContext,
): asserts context is AiToolExecutionContext & {
  readonly reportProposal: (proposal: unknown) => void;
} {
  if (!context?.reportProposal) throw new Error("Proposal tool requires a local review boundary.");
}

function canonicalSchedulePayload<Value>(
  selection: PlannerCandidateSelection,
  context: AiToolExecutionContext,
  toolId: "planner.propose-event" | "planner.propose-time-block",
): Value {
  const constraint = context.proposalConstraint;
  const argumentsRecord =
    typeof constraint?.arguments === "object" && constraint.arguments !== null
      ? (constraint.arguments as Record<string, unknown>)
      : null;
  if (
    constraint?.toolId !== toolId ||
    argumentsRecord?.candidateId !== selection.candidateId ||
    constraint.canonicalPayload === undefined
  ) {
    throw new Error("规划候选已失效，请重新生成提案。");
  }
  return constraint.canonicalPayload as Value;
}

function canonicalTaskPayload(
  selection: TaskProposalPayload,
  context: AiToolExecutionContext,
): TaskProposalPayload {
  const constraint = context.proposalConstraint;
  if (!constraint?.canonicalPayload) return selection;
  const argumentsRecord =
    typeof constraint.arguments === "object" && constraint.arguments !== null
      ? (constraint.arguments as Record<string, unknown>)
      : null;
  if (
    constraint.toolId !== "planner.propose-task" ||
    argumentsRecord?.title !== selection.title ||
    argumentsRecord.deadlineDate !== selection.deadlineDate ||
    argumentsRecord.deadlineTime !== selection.deadlineTime ||
    argumentsRecord.priority !== selection.priority
  ) {
    throw new Error("任务提案参数与本地核验草稿不一致。");
  }
  return constraint.canonicalPayload as unknown as TaskProposalPayload;
}
