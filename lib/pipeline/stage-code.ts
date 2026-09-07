import { db } from "@/lib/db";
import { epics, projects, ticketComments, userStories } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import { resolveSessionOutput } from "@/lib/claude/resolve-session-output";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import type { AgentType } from "@/lib/agent-config/constants";
import {
  buildBuildPrompt,
  buildDeterministicVerificationFixSection,
  buildTicketBuildPrompt,
  type PromptComment,
} from "@/lib/claude/prompt-builder";
import { isVisualProofEnabled } from "@/lib/claude/visual-proof";
import { buildRegressionFixSection } from "@/lib/verify/regression-report";
import { readRegressionConfig } from "@/lib/pipeline/verify";
import { buildGradingFixSection } from "@/lib/grading/report";
import type { ClaudeResult } from "@/lib/claude/spawn";
import {
  emitSessionCompleted,
  emitSessionFailed,
} from "@/lib/events/emit";
import {
  finalizeBuildTerminalOutcome,
  SILENT_BUILD_ERROR,
  type BuildTerminalOutcome,
} from "@/lib/workflow/automatic-transitions";
import type { PipelineStageRequest } from "./runner";
import type { PipelineStageDriverInit } from "./stage-driver-init";
import {
  buildReviewFeedbackSection,
  readOpenReviewComments,
  type PromptSectionCapture,
} from "./stage-prompt";

/**
 * Code stage (build retry and fix) of the pipeline: the prompt a code
 * session receives, and the post-completion effects of its run — a
 * build-route replica, so the board cannot tell a pipeline stage from a
 * human dispatch.
 *
 * Fix stages resume the run's previous code-writing session on attempt 1
 * (stage-resume.ts) and append the open review feedback + pipeline fix
 * instructions — plus the exact grading / regression / verification
 * failure that triggered the cycle — to the standard build prompt.
 */

export const PIPELINE_FIX_INSTRUCTIONS_SECTION = `## Pipeline fix instructions

A code review found blocking findings (listed above). Fix every [critical] and [major] item, keep the existing implementation approach unless a finding demands otherwise, run the tests, and commit.`;

type ProjectRow = typeof projects.$inferSelect;
type EpicRow = typeof epics.$inferSelect;
type UserStoryRow = typeof userStories.$inferSelect;

/** Standard build prompt + the fix-cycle sections (mirror of the build routes). */
export async function buildCodeStagePrompt(input: {
  init: PipelineStageDriverInit;
  request: PipelineStageRequest;
  codeAgentType: AgentType;
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

  const buildSystemPrompt = await resolveAgentPrompt(
    input.codeAgentType,
    projectId
  );
  let prompt =
    scope === "epic"
      ? buildBuildPrompt(
          project,
          [],
          epic,
          usList,
          buildSystemPrompt,
          promptComments,
          {
            visualProofEnabled: isVisualProofEnabled(),
            sectionCollector: promptSections.collect,
          },
        )
      : buildTicketBuildPrompt(
          project,
          [],
          epic,
          story!,
          promptComments,
          buildSystemPrompt,
          {
            visualProofEnabled: isVisualProofEnabled(),
            sectionCollector: promptSections.collect,
          },
        );

  // Open review feedback (includes the blocking findings verbatim with
  // their [severity] prefixes), then the fix instructions.
  const openReviewComments = readOpenReviewComments(epicId);
  const reviewContext = buildReviewFeedbackSection(openReviewComments);
  if (reviewContext) {
    prompt = prompt + "\n\n" + reviewContext;
    promptSections.append("findings", reviewContext);
  }
  if (request.stage === "fix") {
    // A grading-only fix must not be described as a code-review rejection.
    // When open review findings also exist, retain both instruction blocks.
    if (!request.gradingFailure || reviewContext) {
      prompt = prompt + "\n\n" + PIPELINE_FIX_INSTRUCTIONS_SECTION;
      promptSections.append("other", PIPELINE_FIX_INSTRUCTIONS_SECTION);
    }
    if (request.gradingFailure) {
      const gradingFixSection = buildGradingFixSection(request.gradingFailure);
      prompt =
        prompt +
        "\n\n" +
        gradingFixSection;
      promptSections.append("findings", gradingFixSection);
    }
    // A regression-gate rejection carries its exact red→green verdict so
    // the agent repairs the real problem instead of guessing.
    if (request.verifyFailure) {
      // Same patterns the gate filtered the diff with, so the prompt states
      // the rule the agent actually has to satisfy.
      const regressionFixSection = buildRegressionFixSection(
        request.verifyFailure,
        readRegressionConfig(projectId).patterns,
      );
      prompt = prompt + "\n\n" + regressionFixSection;
      promptSections.append("findings", regressionFixSection);
    }
    if (request.verificationFailure) {
      const verificationFixSection =
        buildDeterministicVerificationFixSection(
          request.verificationFailure,
        );
      prompt = prompt + "\n\n" + verificationFixSection;
      promptSections.append("findings", verificationFixSection);
    }
  }

  return prompt;
}

/** Post-completion effects of a code (build/fix) stage — build-route replica. */
export function finalizeCodeSession(input: {
  init: PipelineStageDriverInit;
  sessionId: string;
  result: ClaudeResult | undefined;
  outcome: string | null;
  completedAt: string;
}): BuildTerminalOutcome {
  const { init, sessionId, result, outcome, completedAt } = input;
  const { projectId, epicId, userStoryId, scope } = init;

  const terminal = finalizeBuildTerminalOutcome({
    projectId,
    epicId,
    scope,
    userStoryId,
    sessionId,
    success: !!result?.success,
    outcome,
    error: result?.error,
    reason:
      scope === "epic"
        ? "Build completed successfully"
        : "Story build completed successfully",
  });
  if (scope === "epic") {
    // `silent` sits with the failures: the run delivered nothing, so the desk
    // must not light up as if a build had landed.
    if (
      terminal.kind === "failed" ||
      terminal.kind === "refused" ||
      terminal.kind === "silent"
    ) {
      emitSessionFailed(
        projectId,
        epicId,
        sessionId,
        terminal.kind === "refused"
          ? terminal.error
          : terminal.kind === "silent"
            ? SILENT_BUILD_ERROR
            : result?.error || "Build failed"
      );
    } else {
      emitSessionCompleted(projectId, epicId, sessionId);
    }
  }

  // The stored comment stays complete — agents can pull it whole through
  // get_ticket; only the PROMPT rendering is budgeted
  // (commentHistorySection). resolveSessionOutput scrubs prompt echoes.
  const output = resolveSessionOutput(result, sessionId);
  db.insert(ticketComments)
    .values({
      id: createId(),
      ...(scope === "story" && userStoryId
        ? { userStoryId }
        : { epicId }),
      author: "agent",
      content: output,
      agentSessionId: sessionId,
      createdAt: completedAt,
    })
    .run();

  return terminal;
}
