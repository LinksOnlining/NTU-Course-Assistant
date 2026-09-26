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
        value as TaskProposalPayload,
        source(context),
      );
      context.reportProposal(proposal);
      return { status: "reviewRequired", proposalId: proposal.id, proposalType: proposal.type };
    },
  },
  {
    id: "planner.propose-event",
    parseInput: (value) => value as EventProposalPayload,
    execute: async (value, context) => {
      requireProposalReporter(context);
      const proposal = await aiPlannerProposalRuntime.proposeEvent(
        value as EventProposalPayload,
        source(context),
      );
      context.reportProposal(proposal);
      return { status: "reviewRequired", proposalId: proposal.id, proposalType: proposal.type };
    },
  },
  {
    id: "planner.propose-time-block",
    parseInput: (value) => value as TimeBlockProposalPayload,
    execute: async (value, context) => {
      requireProposalReporter(context);
      const proposal = await aiPlannerProposalRuntime.proposeTimeBlock(
        value as TimeBlockProposalPayload,
        source(context),
      );
      context.reportProposal(proposal);
      return { status: "reviewRequired", proposalId: proposal.id, proposalType: proposal.type };
    },
  },
];

export const AI_PROPOSAL_TOOL_ADAPTERS = Object.freeze(adapters);

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
