import { and, eq, inArray } from "drizzle-orm";
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
import type { PipelineStageKind } from "./runner";
import { postUnresolvedMentionsComment } from "@/lib/workflow/system-comment";

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
export { buildReviewFeedbackSection, buildPriorFindingsSection } from "@/lib/review/prompt-feedback";

/**
 * The epic's currently-open review comments, oldest first. reviewComments is
 * epic-keyed, so story-scoped stages see the epic's open findings too.
 */
export function readOpenReviewComments(epicId: string, includeDismissed = false) {
  return db
    .select()
    .from(reviewComments)
    .where(
      and(eq(reviewComments.epicId, epicId), inArray(reviewComments.status, includeDismissed ? ["open", "dismissed"] : ["open"]))
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
  postUnresolvedMentionsComment({
    epicId,
    missing: mentionEnrichment.missing,
    agentType: input.stage,
  });
  return { prompt, estimatedPrompt };
}
