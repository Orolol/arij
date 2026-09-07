import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { reviewComments } from "@/lib/db/schema";
import type { PromptComment } from "@/lib/claude/prompt-builder";
import {
  buildMentionContextBlock,
  enrichPromptWithDocumentMentions,
  userAuthoredTexts,
} from "@/lib/documents/mentions";
import {
  createPromptSectionCapture,
  finalizeCapturedPrompt,
} from "@/lib/tokens/dispatch-prompt";
import {
  buildEpicTargetUrl,
  createUnresolvedMentionsNotification,
} from "@/lib/notifications/create";
import type { PipelineStageKind } from "./runner";

/**
 * Prompt pieces shared by the code and review stage prompts: the
 * open-findings blocks with their caps, the open-findings query, and the
 * common tail (document mentions, token estimate, unresolved-mention
 * notification) applied to every stage prompt.
 */

export type PromptSectionCapture = ReturnType<typeof createPromptSectionCapture>;
export type EstimatedStagePrompt = ReturnType<typeof finalizeCapturedPrompt>;

/**
 * Ceilings for the open-findings blocks below. A finding body is a filed
 * review comment — normally a few hundred characters; the caps only bite on
 * degenerate rows and on tickets that accumulated findings across many
 * cycles, where an unbounded list was one of the feeders of the 4.9 MB
 * prompt measured on 2026-08-26.
 */
const FINDING_BODY_MAX_CHARS = 1_200;
const FINDINGS_LIST_MAX = 80;

/** The most recent rows within the list cap, original order preserved. */
function capOpenFindings<T>(openComments: T[]): { kept: T[]; dropped: number } {
  if (openComments.length <= FINDINGS_LIST_MAX) {
    return { kept: openComments, dropped: 0 };
  }
  return {
    kept: openComments.slice(-FINDINGS_LIST_MAX),
    dropped: openComments.length - FINDINGS_LIST_MAX,
  };
}

function findingBodyLine(rc: { lineNumber: number; body: string }): string {
  const body =
    rc.body.length > FINDING_BODY_MAX_CHARS
      ? `${rc.body.slice(0, FINDING_BODY_MAX_CHARS)} _[… finding truncated …]_`
      : rc.body;
  return `- **Line ${rc.lineNumber}**: ${body}`;
}

/**
 * Byte-pattern of the epic build route's "Code Review Feedback" block over
 * the currently-open review comments (blocking findings appear verbatim with
 * their [severity] prefixes).
 */
export function buildReviewFeedbackSection(
  openComments: Array<{ filePath: string; lineNumber: number; body: string }>
): string {
  if (openComments.length === 0) return "";
  const { kept, dropped } = capOpenFindings(openComments);
  const byFile = new Map<string, typeof openComments>();
  for (const rc of kept) {
    const existing = byFile.get(rc.filePath) || [];
    existing.push(rc);
    byFile.set(rc.filePath, existing);
  }
  const parts = [
    "## Code Review Feedback\n\nThe following review comments were left on your previous changes. Address each one:\n",
  ];
  if (dropped > 0) {
    parts.push(
      `_[${dropped} older open finding${dropped > 1 ? "s" : ""} omitted — the ${FINDINGS_LIST_MAX} most recent are listed.]_\n`
    );
  }
  for (const [filePath, fileComments] of byFile) {
    parts.push(`### ${filePath}`);
    for (const rc of fileComments) {
      parts.push(findingBodyLine(rc));
    }
    parts.push("");
  }
  return parts.join("\n");
}

/**
 * The reviewer's own memory of the run: findings still open from earlier
 * cycles, plus the scope rules that make a multi-cycle review converge.
 *
 * Without this the review prompt is cycle-blind — it asks the agent to "read
 * the relevant source files" with no record of what previous cycles already
 * examined or reported. On epic E-arij-096 that produced four reviews with
 * four almost disjoint sets of Major findings: each cycle re-audited the whole
 * epic surface and reported whatever it noticed that time, so the ticket could
 * never reach a green review no matter how much the builders fixed.
 *
 * Two rules do the work. Re-verify what is already filed, so a fixed finding
 * gets retired instead of silently replaced by a new one. And bound fresh
 * findings to the branch diff, so ground a previous cycle passed over stays
 * passed — an issue that could have been filed in cycle 1 and was not is not a
 * reason to block cycle 4.
 */
export function buildPriorFindingsSection(
  openComments: Array<{
    id: string;
    filePath: string;
    lineNumber: number;
    body: string;
  }>,
  cycle: number
): string {
  if (openComments.length === 0) return "";

  const { kept, dropped } = capOpenFindings(openComments);
  const parts = [
    "## Findings Still Open From Previous Reviews\n",
    `This is review cycle ${cycle} on this ticket. ${openComments.length} finding(s) ` +
      "filed by earlier cycles are still open. Each carries its Arij id as an " +
      "`[RC:id]` token:\n",
  ];
  if (dropped > 0) {
    parts.push(
      `_[${dropped} older open finding${dropped > 1 ? "s" : ""} omitted — the ${FINDINGS_LIST_MAX} most recent are listed.]_\n`
    );
  }

  const byFile = new Map<string, typeof openComments>();
  for (const rc of kept) {
    const existing = byFile.get(rc.filePath) || [];
    existing.push(rc);
    byFile.set(rc.filePath, existing);
  }
  for (const [filePath, fileComments] of byFile) {
    parts.push(`### ${filePath}`);
    for (const rc of fileComments) {
      parts.push(`- \`[RC:${rc.id}]\` ${findingBodyLine(rc).slice(2)}`);
    }
    parts.push("");
  }

  parts.push(
    `**Work through that list before looking for anything new.** For each open
finding, verify at the current HEAD whether it is fixed, then REPORT the
verdict through the structured channel: include it in \`submit_findings\`'s
\`prior_findings\` array as \`{id, status: "fixed" | "still_open"}\` using the
id from its \`[RC:id]\` token — "fixed" is what resolves the finding in Arij,
prose alone changes nothing. Also echo one line per finding in your report,
in the exact form \`[RC:id] FIXED\` or \`[RC:id] STILL OPEN\`, naming the
evidence you checked — that line is the fallback Arij parses when the
structured channel is unavailable. A finding you do not mention is treated as
unverified, not as resolved.

**Then bound new findings to what this branch changed** — the diff against the
base branch. Do not re-audit code earlier cycles already passed over: an issue
that could have been filed in cycle 1 and was not is out of scope now. Raising
fresh Majors in untouched adjacent code every cycle is what keeps a ticket
looping forever instead of shipping.`
  );

  return parts.join("\n");
}

/**
 * The epic's currently-open review comments, oldest first. reviewComments is
 * epic-keyed, so story-scoped stages see the epic's open findings too.
 */
export function readOpenReviewComments(epicId: string) {
  return db
    .select()
    .from(reviewComments)
    .where(
      and(eq(reviewComments.epicId, epicId), eq(reviewComments.status, "open"))
    )
    .orderBy(reviewComments.createdAt)
    .all();
}

/**
 * Common tail of every stage prompt. Document mentions: user-written
 * comments only. An agent comment naming a codebase file is not an Arij
 * document reference, and an unresolved mention never stops a background
 * stage — it is reported, not raised.
 */
export function finalizeStagePrompt(input: {
  projectId: string;
  epicId: string;
  stage: PipelineStageKind;
  prompt: string;
  promptSections: PromptSectionCapture;
  promptComments: PromptComment[];
}): { prompt: string; estimatedPrompt: EstimatedStagePrompt } {
  const { projectId, epicId, promptSections, promptComments } = input;

  const mentionEnrichment = enrichPromptWithDocumentMentions({
    projectId,
    prompt: input.prompt,
    textSources: userAuthoredTexts(promptComments),
  });
  const prompt = mentionEnrichment.prompt;
  promptSections.append(
    "documents",
    buildMentionContextBlock(mentionEnrichment.resolvedDocuments),
  );
  const estimatedPrompt = finalizeCapturedPrompt(
    prompt,
    promptSections,
    mentionEnrichment.missing,
  );
  createUnresolvedMentionsNotification({
    projectId,
    missing: mentionEnrichment.missing,
    agentType: input.stage,
    targetUrl: buildEpicTargetUrl(projectId, epicId),
  });

  return { prompt, estimatedPrompt };
}
