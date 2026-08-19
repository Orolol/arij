import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  epics,
  userStories,
  ticketComments,
} from "@/lib/db/schema";
import { eq, and, notInArray } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { createWorktree, isGitRepo } from "@/lib/git/manager";
import { processManager } from "@/lib/claude/process-manager";
import {
  buildEpicReviewPrompt,
  type ReviewType,
} from "@/lib/claude/prompt-builder";
import {
  classifySessionOutcome,
  extractSessionUsage,
  resolveSessionOutput,
} from "@/lib/claude/resolve-session-output";
import {
  getEpicOr404,
  getProjectOr404,
  isErrorResponse,
} from "@/lib/api/route-helpers";
import fs from "fs";
import path from "path";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import { REVIEW_TYPE_TO_AGENT_TYPE } from "@/lib/agent-config/constants";
import { resolveAgentForDispatch } from "@/lib/agent-config/agent-resolution";
import {
  createAgentAlreadyRunningPayload,
  getRunningSessionForTarget,
} from "@/lib/agents/concurrency";
import { agentScheduler } from "@/lib/agents/scheduler";
import {
  createQueuedSession,
  isSessionLifecycleConflictError,
  markSessionRunning,
  markSessionTerminal,
} from "@/lib/agent-sessions/lifecycle";
import {
  MentionResolutionError,
  enrichPromptWithDocumentMentions,
} from "@/lib/documents/mentions";
import { validateResumeSession } from "@/lib/agent-sessions/validate-resume";
import { waitForProcessCompletion } from "@/lib/agent-sessions/wait-for-completion";
import { logTransition } from "@/lib/workflow/log";
import { handleAskedQuestionOutcome } from "@/lib/workflow/agent-question";
import {
  emitSessionStarted,
  emitSessionCompleted,
  emitSessionFailed,
  emitTicketMoved,
} from "@/lib/events/emit";

type Params = { params: Promise<{ projectId: string; epicId: string }> };

const VALID_REVIEW_TYPES: ReviewType[] = [
  "security",
  "code_review",
  "compliance",
  "feature_review",
];

const REVIEW_LABELS: Record<ReviewType, string> = {
  security: "Security Review",
  code_review: "Code Review",
  compliance: "Compliance & Accessibility Review",
  feature_review: "Feature Review",
};

export async function POST(request: NextRequest, { params }: Params) {
  const { projectId, epicId } = await params;
  const body = await request.json().catch(() => ({}));

  const { reviewTypes, namedAgentId: namedAgentIdParam, resumeSessionId: resumeSessionIdParam } = body as {
    reviewTypes: ReviewType[];
    namedAgentId?: string | null;
    resumeSessionId?: string;
  };
  const namedAgentId: string | null = namedAgentIdParam || null;

  if (!reviewTypes || !Array.isArray(reviewTypes) || reviewTypes.length === 0) {
    return NextResponse.json(
      { error: "reviewTypes array is required with at least one type" },
      { status: 400 }
    );
  }

  for (const rt of reviewTypes) {
    if (!VALID_REVIEW_TYPES.includes(rt)) {
      return NextResponse.json(
        { error: `Invalid review type: ${rt}. Valid types: ${VALID_REVIEW_TYPES.join(", ")}` },
        { status: 400 }
      );
    }
  }

  // Validate epic in review status (project-scoped lookup)
  const foundEpic = getEpicOr404(projectId, epicId);
  if (isErrorResponse(foundEpic)) return foundEpic;
  const { epic } = foundEpic;
  if (epic.status !== "review" && epic.status !== "done") {
    return NextResponse.json(
      { error: "Epic must be in review or done status for agent review" },
      { status: 400 }
    );
  }

  // Concurrency guard — one active agent per epic
  const conflict = getRunningSessionForTarget({
    scope: "epic",
    projectId,
    epicId,
  });
  if (conflict) {
    return NextResponse.json(
      createAgentAlreadyRunningPayload(
        { scope: "epic", projectId, epicId },
        conflict,
        "Another agent is already running for this epic."
      ),
      { status: 409 }
    );
  }

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

  // Load context
  const us = db
    .select()
    .from(userStories)
    .where(eq(userStories.epicId, epicId))
    .orderBy(userStories.position)
    .all();

  // Load epic comments
  const comments = db
    .select()
    .from(ticketComments)
    .where(eq(ticketComments.epicId, epicId))
    .orderBy(ticketComments.createdAt)
    .all();

  const promptComments = comments.map((c) => ({
    author: c.author as "user" | "agent",
    content: c.content,
    createdAt: c.createdAt ?? "",
  }));

  // Ensure worktree exists
  const { worktreePath, branchName } = await createWorktree(
    gitRepoPath,
    epic.id,
    epic.title,
    { defaultBranch: project.defaultBranch }
  );

  // Resume support — scope-guarded
  let resumeCliSessionId: string | undefined;
  if (resumeSessionIdParam) {
    const validated = validateResumeSession({
      resumeSessionId: resumeSessionIdParam,
      epicId: epicId,
    });
    if (validated) {
      resumeCliSessionId = validated.cliSessionId;
    }
  }

  const sessionsCreated: string[] = [];
  const resolutions: Array<{
    sessionId: string;
    reviewType: ReviewType;
    provider: string;
    segregated: boolean;
    builderProvider: string | null;
  }> = [];

  for (const [idx, reviewType] of reviewTypes.entries()) {
    const reviewSystemPrompt = await resolveAgentPrompt(
      REVIEW_TYPE_TO_AGENT_TYPE[reviewType],
      projectId
    );
    const prompt = buildEpicReviewPrompt(
      project,
      [],
      epic,
      us,
      reviewType,
      reviewSystemPrompt,
      promptComments
    );

    let enrichedPrompt = prompt;
    try {
      enrichedPrompt = enrichPromptWithDocumentMentions({
        projectId,
        prompt,
        textSources: promptComments.map((c) => c.content),
      }).prompt;
    } catch (error) {
      if (error instanceof MentionResolutionError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const resolvedAgent = await resolveAgentForDispatch(
      REVIEW_TYPE_TO_AGENT_TYPE[reviewType],
      projectId,
      namedAgentId,
      { purpose: "review", projectId, epicId }
    );

    const sessionId = createId();
    const now = new Date().toISOString();
    const logsDir = path.join(process.cwd(), "data", "sessions", sessionId);
    fs.mkdirSync(logsDir, { recursive: true });
    const logsPath = path.join(logsDir, "logs.json");

    const agentMode = reviewType === "feature_review" ? "code" : "plan";

    const providerSupportsResume =
      resolvedAgent.provider === "claude-code" ||
      resolvedAgent.provider === "gemini-cli" ||
      resolvedAgent.provider === "codex";

    // First review session can resume (when provider supports it); subsequent ones start fresh
    const useResume = idx === 0 && providerSupportsResume && !!resumeCliSessionId;
    const cliSessionId = useResume
      ? resumeCliSessionId
      : providerSupportsResume
        ? crypto.randomUUID()
        : undefined;

    createQueuedSession({
      id: sessionId,
      projectId,
      epicId,
      mode: agentMode,
      provider: resolvedAgent.provider,
      prompt: enrichedPrompt,
      logsPath,
      branchName,
      worktreePath,
      cliSessionId,
      namedAgentId: resolvedAgent.namedAgentId ?? null,
      agentType: REVIEW_TYPE_TO_AGENT_TYPE[reviewType],
      namedAgentName: resolvedAgent.name || null,
      model: resolvedAgent.model || null,
      createdAt: now,
    });

    emitSessionStarted(projectId, epicId, sessionId, REVIEW_TYPE_TO_AGENT_TYPE[reviewType]);

    // Scheduled launch via the per-project scheduler: spawn when a slot
    // frees, wait for completion, post the review as an epic comment.
    const label = REVIEW_LABELS[reviewType];
    ((sid, lbl) => {
      agentScheduler.submit(projectId, sid, async () => {
        markSessionRunning(sid);
        processManager.start(sid, {
          mode: agentMode,
          prompt: enrichedPrompt,
          cwd: worktreePath,
          model: resolvedAgent.model,
          cliSessionId,
          resumeSession: useResume,
        }, resolvedAgent.provider);

        const info = await waitForProcessCompletion(sid);

        const completedAt = new Date().toISOString();
        const result = info?.result;

        try {
          fs.writeFileSync(logsPath, JSON.stringify(result, null, 2));
        } catch {
          // ignore
        }

        const outcome = classifySessionOutcome(result, sid);

        try {
          markSessionTerminal(
            sid,
            {
              success: !!result?.success,
              error: result?.error || null,
              outcome,
              usage: extractSessionUsage(result),
            },
            completedAt
          );
        } catch (error) {
          if (!isSessionLifecycleConflictError(error)) {
            console.error("[epic review] Failed to finalize session", error);
          }
        }

        const output = resolveSessionOutput(result, sid, "Review agent completed without output.");

        db.insert(ticketComments)
          .values({
            id: createId(),
            epicId,
            author: "agent",
            content: `**${lbl}**\n\n${output}`,
            agentSessionId: sid,
            createdAt: completedAt,
          })
          .run();

        // asked_question guard: the reviewer stopped to ask the user
        // something, so its output is not a verdict — hold the ticket where
        // it is, notify, log the decision, and skip verdict handling.
        const askedQuestion = outcome === "asked_question";
        if (askedQuestion) {
          handleAskedQuestionOutcome({
            projectId,
            epicIds: [epicId],
            sessionId: sid,
            ticketStatus: epic.status ?? "review",
          });
        }

        // If the review verdict indicates work is not done, revert
        // epic and user stories back to in_progress
        const lowerOutput = output.toLowerCase();
        const isNegativeVerdict =
          !askedQuestion &&
          (lowerOutput.includes("changes requested") ||
            lowerOutput.includes("not complete") ||
            lowerOutput.includes("partially complete"));

        if (result?.success) {
          emitSessionCompleted(projectId, epicId, sid);
        } else {
          emitSessionFailed(projectId, epicId, sid, result?.error || "Review failed");
        }

        if (isNegativeVerdict) {
          const currentEpic = db
            .select()
            .from(epics)
            .where(eq(epics.id, epicId))
            .get();

          if (currentEpic && (currentEpic.status === "done" || currentEpic.status === "review")) {
            const prevStatus = currentEpic.status;
            db.update(epics)
              .set({ status: "in_progress", updatedAt: completedAt })
              .where(eq(epics.id, epicId))
              .run();

            db.update(userStories)
              .set({ status: "in_progress" })
              .where(
                and(
                  eq(userStories.epicId, epicId),
                  notInArray(userStories.status, ["in_progress"])
                )
              )
              .run();

            emitTicketMoved(projectId, epicId, prevStatus, "in_progress");
            logTransition({
              projectId,
              epicId,
              fromStatus: prevStatus,
              toStatus: "in_progress",
              actor: "agent",
              reason: `Review verdict: changes requested (${lbl})`,
              sessionId: sid,
            });
          }
        }
      });
    })(sessionId, label);

    sessionsCreated.push(sessionId);
    resolutions.push({
      sessionId,
      reviewType,
      provider: resolvedAgent.provider,
      segregated: !!resolvedAgent.segregated,
      builderProvider: resolvedAgent.builderProvider ?? null,
    });
  }

  return NextResponse.json({
    data: {
      sessions: sessionsCreated,
      count: sessionsCreated.length,
      resolutions,
    },
  });
}
