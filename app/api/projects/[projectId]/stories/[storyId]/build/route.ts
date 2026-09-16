import { resolveAgentByNamedId } from "@/lib/agent-config/agent-resolution";
import { mintAssignedCliSessionId } from "@/lib/agent-sessions/dispatch-background-session";
import { dispatchBuildSession } from "@/lib/agent-sessions/dispatch-ticket-session";
import { isResumableProvider } from "@/lib/agent-sessions/resume-capability";
import { createSessionLogsPath } from "@/lib/agent-sessions/session-paths";
import { validateResumeSession } from "@/lib/agent-sessions/validate-resume";
import {
  createAgentAlreadyRunningPayload,
  getRunningSessionForTarget,
} from "@/lib/agents/concurrency";
import { withAgentResolutionErrors } from "@/lib/api/agent-resolution-response";
import {
  getEpicOr404,
  getProjectOr404,
  getStoryOr404,
  isErrorResponse,
} from "@/lib/api/route-helpers";
import {
  resolveSessionOutput
} from "@/lib/claude/resolve-session-output";
import { db } from "@/lib/db";
import {
  epics,
  ticketComments,
} from "@/lib/db/schema";
import { createWorktree, isGitRepo } from "@/lib/git/manager";
import {
  resolvePipelineEnabled,
  startPipelineRun
} from "@/lib/pipeline";
import { assembleStoryBuildPrompt } from "@/lib/tokens";
import { createId } from "@/lib/utils/nanoid";
import {
  finalizeBuildTerminalOutcome,
  resolveBuildSessionResult,
  transitionBuildStarted,
  WorkflowTransitionError,
} from "@/lib/workflow/automatic-transitions";
import { postUnresolvedMentionsComment } from "@/lib/workflow/system-comment";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ projectId: string; storyId: string }> };

export const POST = withAgentResolutionErrors(async function POST(request: NextRequest, { params }: Params) {
  const { projectId, storyId } = await params;
  const body = await request.json().catch(() => ({}));
  const namedAgentId: string | null = body.namedAgentId || null;
  // Autonomous pipeline flag: an explicit boolean forces on/off; absent, the
  // pipeline_enabled setting chain decides (default ON).
  const pipelineParam: boolean | undefined =
    typeof body.pipeline === "boolean" ? body.pipeline : undefined;

  // Validate story exists (project-scoped)
  const foundStory = getStoryOr404(projectId, storyId);
  if (isErrorResponse(foundStory)) return foundStory;
  const { story } = foundStory;

  // Validate status
  if (!["todo", "in_progress", "review"].includes(story.status ?? "")) {
    return NextResponse.json(
      { error: "Story must be in todo, in_progress, or review status to send to dev" },
      { status: 400 }
    );
  }

  // Get epic (project-scoped)
  const foundEpic = getEpicOr404(projectId, story.epicId);
  if (isErrorResponse(foundEpic)) return foundEpic;
  const { epic } = foundEpic;

  // Get project
  const foundProject = getProjectOr404(projectId, { requireGitRepo: true });
  if (isErrorResponse(foundProject)) return foundProject;
  const { project } = foundProject;

  const gitRepoPath = project.gitRepoPath;
  const isRepo = await isGitRepo(gitRepoPath);
  if (!isRepo) {
    return NextResponse.json(
      { error: `Path is not a git repository: ${gitRepoPath}` },
      { status: 400 }
    );
  }

  // Post optional comment before dispatch
  if (body.comment && body.comment.trim()) {
    const commentId = createId();
    db.insert(ticketComments)
      .values({
        id: commentId,
        userStoryId: storyId,
        author: "user",
        content: body.comment.trim(),
        createdAt: new Date().toISOString(),
      })
      .run();
  }

  // Create worktree (reuses existing)
  const { worktreePath, branchName } = await createWorktree(
    gitRepoPath,
    epic.id,
    epic.title,
    { defaultBranch: project.defaultBranch }
  );

  const assembled = await assembleStoryBuildPrompt({
    projectId,
    epicId: epic.id,
    storyId,
    project,
    epic,
    story,
    comment: body.comment,
    commentAlreadyPersisted: true,
  });
  const enrichedPrompt = assembled.prompt;
  postUnresolvedMentionsComment({ epicId: epic.id, missing: assembled.missingDocuments, agentType: "ticket_build" });
  const resolvedAgent = resolveAgentByNamedId("ticket_build", projectId, namedAgentId);

  // Resume support — scope-guarded
  let cliSessionId: string | undefined;
  let resumeSession = false;
  if (isResumableProvider(resolvedAgent.provider) && body.resumeSessionId) {
    const validated = validateResumeSession({
      resumeSessionId: body.resumeSessionId,
      epicId: epic.id,
      userStoryId: storyId,
      expectedProvider: resolvedAgent.provider,
    });
    if (validated) {
      cliSessionId = validated.cliSessionId;
      resumeSession = true;
    }
  }
  if (!cliSessionId) {
    cliSessionId = mintAssignedCliSessionId(resolvedAgent.provider);
  }

  // Create session
  const sessionId = createId();
  const now = new Date().toISOString();
  const logsPath = createSessionLogsPath(sessionId);

  // Check concurrency guard
  const conflict = getRunningSessionForTarget({
    scope: "story",
    projectId,
    storyId,
    epicId: epic.id,
  });
  if (conflict) {
    return NextResponse.json(
      createAgentAlreadyRunningPayload(
        { scope: "story", projectId, storyId, epicId: epic.id },
        conflict,
        "Another agent is already running for this story."
      ),
      { status: 409 }
    );
  }

  try {
    transitionBuildStarted({
      projectId,
      epicId: epic.id,
      scope: "story",
      userStoryId: storyId,
      sessionId,
    });
  } catch (error) {
    if (error instanceof WorkflowTransitionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  // Branch metadata is separate from the guarded status transition.
  db.update(epics)
    .set({ branchName, updatedAt: now })
    .where(eq(epics.id, epic.id))
    .run();

  const row = {
    id: sessionId,
    projectId,
    epicId: epic.id,
    userStoryId: storyId,
    mode: "code" as const,
    provider: resolvedAgent.provider,
    prompt: enrichedPrompt,
    estimatedPromptTokens: assembled.tokens.total,
    estimatedPromptBreakdown: JSON.stringify(assembled.tokens.breakdown),
    logsPath,
    branchName,
    worktreePath,
    cliSessionId,
    namedAgentId: resolvedAgent.namedAgentId ?? null,
    compositeAgentId: resolvedAgent.compositeAgentId ?? null,
    agentType: "ticket_build",
    namedAgentName: resolvedAgent.name || null,
    model: resolvedAgent.model || null,
    createdAt: now,
  };

  // Batch-style launch via the per-project scheduler: the session stays
  // 'queued' until a slot frees, then the closure spawns the agent, waits
  // for completion, updates the DB, and posts the agent comment. It returns
  // the {success, outcome, error} triple so the pipeline's settle wrapper
  // can observe the terminal result.
  const dispatched = dispatchBuildSession({ row, resolvedAgent, resumeSession,
    onTerminal: async ({ result, outcome, completedAt }) => {
    const terminal = finalizeBuildTerminalOutcome({
      projectId,
      epicId: epic.id,
      scope: "story",
      userStoryId: storyId,
      sessionId,
      success: !!result?.success,
      outcome,
      error: result?.error,
    });

    // Post agent output as comment
    const output = resolveSessionOutput(result, sessionId);

    db.insert(ticketComments)
      .values({
        id: createId(),
        userStoryId: storyId,
        author: "agent",
        content: output,
        agentSessionId: sessionId,
        createdAt: completedAt,
      })
      .run();

    return resolveBuildSessionResult(terminal, {
      success: !!result?.success,
      outcome,
      error: result?.error ?? null,
    });
  }});

  // Autonomous pipeline: when active, wrap the launch closure with the
  // settle pattern (copied from the batch route's launchEpic) so the run's
  // engine can await this build's terminal state, then start the run.
  const pipelineActive = pipelineParam ?? resolvePipelineEnabled(projectId);

  let pipeline: { runId: string } | null = null;
  if (pipelineActive) {
    pipeline = startPipelineRun({
      projectId,
      scope: "story",
      epicId: epic.id,
      userStoryId: storyId,
      buildSessionId: sessionId,
      buildProvider: resolvedAgent.provider,
      buildNamedAgentId: namedAgentId,
      buildSettled: dispatched.settled,
    });
  }

  return NextResponse.json({
    data: { sessionId, branchName, worktreePath, pipeline },
  });
});
