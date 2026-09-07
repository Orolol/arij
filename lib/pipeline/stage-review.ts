import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentSessions,
  epics,
  projects,
  ticketComments,
  userStories,
} from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import { resolveSessionOutput } from "@/lib/claude/resolve-session-output";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import type { AgentType } from "@/lib/agent-config/constants";
import {
  buildDeterministicVerificationReviewSection,
  buildEpicReviewPrompt,
  buildReviewPrompt,
  type PromptComment,
} from "@/lib/claude/prompt-builder";
import type { ClaudeResult } from "@/lib/claude/spawn";
import {
  emitSessionCompleted,
  emitSessionFailed,
} from "@/lib/events/emit";
import { handleAskedQuestionOutcome } from "@/lib/workflow/agent-question";
import {
  transitionReviewRejected,
  transitionReviewPassed,
} from "@/lib/workflow/automatic-transitions";
import { PIPELINE_REVIEW_TYPE } from "./constants";
import {
  assessReviewOutcome,
  resolveReviewVerdict,
  resolvePriorFindingsFromProse,
  collectBlockingFindings,
  readSessionFindingsWindow,
} from "./findings";
import type { PipelineReviewAssessment, PipelineStageRequest } from "./runner";
import type { PipelineStageDriverInit } from "./stage-driver-init";
import {
  buildPriorFindingsSection,
  readOpenReviewComments,
  type PromptSectionCapture,
} from "./stage-prompt";

/**
 * Review stage of the pipeline: the prompt a reviewer receives, the
 * blocking-findings assessment the runner asks for after a successful
 * review, and the post-completion effects of the review session — a
 * review-route replica (labeled comment, verdict channels, promotion to
 * to_merge or revert to in_progress).
 */

export const PIPELINE_REVIEW_LABEL = "Code Review";

type ProjectRow = typeof projects.$inferSelect;
type EpicRow = typeof epics.$inferSelect;
type UserStoryRow = typeof userStories.$inferSelect;

/** Standard review prompt + the run's own history (mirror of the review routes). */
export async function buildReviewStagePrompt(input: {
  init: PipelineStageDriverInit;
  request: PipelineStageRequest;
  reviewAgentType: AgentType;
  project: ProjectRow;
  epic: EpicRow;
  /** The run's story for story-scoped runs, else null. */
  story: UserStoryRow | null;
  usList: UserStoryRow[];
  promptComments: PromptComment[];
  promptSections: PromptSectionCapture;
}): Promise<string> {
  const { init, request, project, epic, story, usList, promptComments } =
    input;
  const { projectId, epicId, scope } = init;
  const { promptSections } = input;

  const reviewSystemPrompt = await resolveAgentPrompt(
    input.reviewAgentType,
    projectId
  );
  let prompt =
    scope === "epic"
      ? buildEpicReviewPrompt(
          project,
          [],
          epic,
          usList,
          PIPELINE_REVIEW_TYPE,
          reviewSystemPrompt,
          promptComments,
          promptSections.collect,
        )
      : buildReviewPrompt(
          project,
          [],
          epic,
          story!,
          PIPELINE_REVIEW_TYPE,
          reviewSystemPrompt,
          promptSections.collect,
        );

  // Give the reviewer the run's own history. Same open-findings query the
  // code stage uses — reviewComments is epic-keyed, so story-scoped
  // review stages see the epic's open findings too, which is what makes a
  // sibling story's unfixed finding stay visible instead of being rediscovered.
  const priorFindings = buildPriorFindingsSection(
    readOpenReviewComments(epicId),
    request.fixCycle + 1
  );
  if (priorFindings) {
    prompt = prompt + "\n\n" + priorFindings;
    promptSections.append("findings", priorFindings);
  }

  if (request.verificationReport) {
    const verificationReviewSection =
      buildDeterministicVerificationReviewSection(
        request.verificationReport.commands,
      );
    prompt = prompt + "\n\n" + verificationReviewSection;
    promptSections.append("findings", verificationReviewSection);
  }

  return prompt;
}

function readLastNonEmptyText(sessionId: string): string | null {
  return (
    db
      .select({ lastNonEmptyText: agentSessions.lastNonEmptyText })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get()?.lastNonEmptyText ?? null
  );
}

/**
 * Blocking-findings assessment for a successful review stage. The review
 * output cached by the launch closure feeds the prose fallback; the session
 * row's last non-empty text is the fallback when the cache has no entry.
 */
export async function assessPipelineReview(
  init: PipelineStageDriverInit,
  reviewOutputs: ReadonlyMap<string, string>,
  input: { sessionId: string; stageStartedAt: string }
): Promise<PipelineReviewAssessment> {
  const { sessionId, stageStartedAt } = input;
  const output =
    reviewOutputs.get(sessionId) ?? readLastNonEmptyText(sessionId) ?? "";
  const assessment = assessReviewOutcome({
    epicId: init.epicId,
    sinceIso: stageStartedAt,
    sessionOutput: output,
    reviewSessionId: sessionId || null,
  });
  return {
    blocking: assessment.blocking,
    blockingCount: assessment.blockingFindings.length,
    agentCommentCount: assessment.agentCommentCount,
    usedProseFallback: assessment.usedProseFallback,
    verdictSource: assessment.verdictSource,
    structuredVerdict: assessment.structuredVerdict,
    unverifiable: assessment.unverifiable,
  };
}

/** Post-completion effects of a review stage — review-route replica. */
export function finalizeReviewSession(input: {
  init: PipelineStageDriverInit;
  sessionId: string;
  result: ClaudeResult | undefined;
  outcome: string | null;
  completedAt: string;
  reviewOutputs: Map<string, string>;
}): void {
  const { init, sessionId, result, outcome, completedAt } = input;
  const { projectId, epicId, userStoryId, scope } = init;

  const output = resolveSessionOutput(
    result,
    sessionId,
    "Review agent completed without output."
  );
  input.reviewOutputs.set(sessionId, output);

  db.insert(ticketComments)
    .values({
      id: createId(),
      ...(scope === "story" && userStoryId
        ? { userStoryId }
        : { epicId }),
      author: "agent",
      content: `**${PIPELINE_REVIEW_LABEL}**\n\n${output}`,
      agentSessionId: sessionId,
      createdAt: completedAt,
    })
    .run();

  const askedQuestion = outcome === "asked_question";
  if (askedQuestion) {
    const heldStatus =
      scope === "story" && userStoryId
        ? db
            .select({ status: userStories.status })
            .from(userStories)
            .where(eq(userStories.id, userStoryId))
            .get()?.status ?? "review"
        : db
            .select({ status: epics.status })
            .from(epics)
            .where(eq(epics.id, epicId))
            .get()?.status ?? "review";
    handleAskedQuestionOutcome({
      projectId,
      epicIds: [epicId],
      sessionId,
      ticketStatus: heldStatus,
    });
  }

  // Prose fallback of submit_findings.prior_findings: [RC:id] FIXED lines in
  // the report resolve the prior findings they name. Idempotent — rows the
  // structured channel (or the runner's assessReview) already resolved are
  // skipped by the status filter.
  if (!askedQuestion) {
    resolvePriorFindingsFromProse({ epicId, sessionOutput: output });
  }

  // Verdict channels, in priority order: the reviewer's persisted
  // submit_findings verdict, else the prose scan of its final message (see
  // lib/pipeline/findings.ts). A reviewer that asked a question delivered no
  // verdict at all, so neither channel is consulted.
  const decision = askedQuestion
    ? null
    : resolveReviewVerdict({
        epicId,
        reviewSessionId: sessionId,
        sessionOutput: output,
      });
  const isNegativeVerdict = decision?.negative ?? false;

  if (scope === "epic") {
    if (result?.success) {
      emitSessionCompleted(projectId, epicId, sessionId);
    } else {
      emitSessionFailed(
        projectId,
        epicId,
        sessionId,
        result?.error || "Review failed"
      );
    }
  }

  if (!isNegativeVerdict) {
    // A verdict that PASSED promotes the ticket to the merge boundary. An
    // unverifiable review proves nothing and a failed session delivered
    // nothing: both leave the ticket in review to earn another review.
    //
    // The blocking-findings check closes the prose gap: a review with no
    // structured verdict that still filed an open [critical]/[major] row in
    // its window is judged by prose here (resolveReviewVerdict ignores
    // findings on that path for bit-compatibility), while the runner's
    // assessReviewOutcome counts the finding and dispatches a fix. Promoting
    // in that state would show To Merge with an open critical for the length
    // of the fix cycle — and invite a manual merge that resolves it. A
    // structured non-negative verdict implies zero blocking findings, so the
    // check only ever bites on the prose path.
    const findingsWindow = readSessionFindingsWindow(sessionId);
    const blockingInWindow = findingsWindow
      ? collectBlockingFindings(epicId, findingsWindow)
      : [];
    if (
      decision &&
      !decision.unverifiable &&
      blockingInWindow.length === 0 &&
      result?.success &&
      scope === "epic"
    ) {
      try {
        transitionReviewPassed({
          projectId,
          epicId,
          scope: "epic",
          reason: `Review verdict: passed (${PIPELINE_REVIEW_LABEL})`,
          sessionId,
          verdictSource:
            decision.source === "structured" ? "structured" : "prose",
        });
      } catch (err) {
        // A refused promotion (e.g. a concurrent move) holds the ticket in
        // review; the refusal is already in the activity log.
        console.warn(
          "[pipeline] review passed but to_merge promotion was refused:",
          (err as Error).message
        );
      }
    }
    return;
  }

  if (scope === "epic") {
    const currentEpic = db
      .select()
      .from(epics)
      .where(eq(epics.id, epicId))
      .get();
    if (
      currentEpic &&
      (currentEpic.status === "done" ||
        currentEpic.status === "review" ||
        currentEpic.status === "to_merge")
    ) {
      transitionReviewRejected({
        projectId,
        epicId,
        scope: "epic",
        reason: `Review verdict: changes requested (${PIPELINE_REVIEW_LABEL})`,
        sessionId,
        verdictSource: decision?.source,
      });
    }
  } else if (userStoryId) {
    const currentStory = db
      .select()
      .from(userStories)
      .where(eq(userStories.id, userStoryId))
      .get();
    if (
      currentStory &&
      (currentStory.status === "done" || currentStory.status === "review")
    ) {
      transitionReviewRejected({
        projectId,
        epicId,
        scope: "story",
        userStoryId,
        reason: `Review verdict: changes requested (${PIPELINE_REVIEW_LABEL})`,
        sessionId,
        verdictSource: decision?.source,
      });
    }
  }
}
