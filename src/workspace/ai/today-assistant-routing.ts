import type { AiWorkflowId } from "../../application/ai/today-workflows.ts";

/** Conservative local routing: only clear time-block requests receive proposal capability. */
export function resolveTodayAssistantWorkflow(instruction: string): AiWorkflowId {
  const text = instruction.trim();
  if (
    /(?:不要|不用|无需|不必|别)\s*(?:帮我|给我|为我)?\s*(?:安排|规划|创建|排)(?:.{0,8})(?:时间块|时间段|时间)/u.test(
      text,
    )
  ) {
    return "today.analyze";
  }
  return /安排今天/u.test(text) ||
    /(?:安排|规划|创建|排(?:出|一段|一下|个)?).{0,20}(?:时间块|时间段|时间|\d{1,3}\s*分钟)/u.test(
      text,
    ) ||
    /(?:时间块|时间段).{0,12}(?:安排|创建|规划)/u.test(text)
    ? "today.plan"
    : "today.analyze";
}

/** Render provider text as plain text; structured fields remain separate UI sections. */
export function plainAssistantText(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s*/gmu, "")
    .replace(/\*\*(.*?)\*\*/gsu, "$1")
    .replace(/__(.*?)__/gsu, "$1")
    .replace(/`{1,3}([^`]+)`{1,3}/gu, "$1")
    .replace(/^\s*[*+-]\s+/gmu, "")
    .replace(/^\s*\*{1,2}\s*$/gmu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
