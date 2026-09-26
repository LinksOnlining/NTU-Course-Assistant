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
