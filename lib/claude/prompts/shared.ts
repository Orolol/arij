import { neutralizeControlMarkup, fenceUntrusted } from "../untrusted";
import type { PromptEpic, PromptUserStory } from "./types";

export function ticketBodySection(ticket: Pick<PromptEpic, "title" | "description"> & Partial<Pick<PromptUserStory, "acceptanceCriteria">>, heading: string): string {
  return `## ${heading}\n\n### ${neutralizeControlMarkup(ticket.title)}\n` +
    (ticket.description ? `${neutralizeControlMarkup(ticket.description.trim())}\n` : "") +
    (ticket.acceptanceCriteria ? `**Acceptance Criteria:**\n${neutralizeControlMarkup(ticket.acceptanceCriteria.trim())}\n` : "");
}
export function additionalInstructionsSection(text?: string | null): string {
  return text?.trim() ? `## Additional Instructions\n\n${fenceUntrusted(text)}\n` : "";
}
export function finalVerdictSection(kind: "code" | "feature" | "bug"): string {
  const verdicts = kind === "code" ? ["Approved", "Approved with Minor Issues", "Changes Requested"] : [kind === "bug" ? "Bug Fixed" : "Feature Complete", "Partially Complete", "Not Complete"];
  return "**IMPORTANT — Final Verdict:** Your report MUST end with exactly one of these lines:\n" + verdicts.map((verdict) => `- \`**Overall Verdict: ${verdict}**\``).join("\n");
}
