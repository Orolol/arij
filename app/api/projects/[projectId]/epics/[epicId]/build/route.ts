import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  epics,
  userStories,
  ticketComments,
  reviewComments,
} from "@/lib/db/schema";
import { eq, and, notInArray } from "drizzle-orm";
import {
  getEpicOr404,
  getProjectOr404,
  isErrorResponse,
} from "@/lib/api/route-helpers";
import { createId } from "@/lib/utils/nanoid";
import { createWorktree, isGitRepo } from "@/lib/git/manager";
import { processManager } from "@/lib/claude/process-manager";
import { buildBuildPrompt } from "@/lib/claude/prompt-builder";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import {
  classifySessionOutcome,
  extractSessionUsage,
  resolveSessionOutput,
} from "@/lib/claude/resolve-session-output";
import { resolveAgentByNamedId } from "@/lib/agent-config/agent-resolution";
import {
  createAgentAlreadyRunningPayload,
  getRunningSessionForTarget,
} from "@/lib/agents/concurrency";
import { agentScheduler } from "@/lib/agents/scheduler";
import fs from "fs";
import path from "path";
import {
  createQueuedSession,
  isSessionLifecycleConflictError,
  markSessionRunning,
  markSessionTerminal,
} from "@/lib/agent-sessions/lifecycle";
import {
  MentionResolutionError,
  enrichPromptWithDocumentMentions,
  validateMentionsExist,
} from "@/lib/documents/mentions";
import { validateResumeSession } from "@/lib/agent-sessions/validate-resume";
import { waitForProcessCompletion } from "@/lib/agent-sessions/wait-for-completion";
import {
  emitSessionStarted,
  emitSessionCompleted,
  emitSessionFailed,
  emitTicketMoved,
} from "@/lib/events/emit";
import { logTransition } from "@/lib/workflow/log";
import { handleAskedQuestionOutcome } from "@/lib/workflow/agent-question";

type Params = { params: Promise<{ projectId: string; epicId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { projectId, epicId } = await params;
  const body = await request.json().catch(() => ({}));
  const namedAgentId: string | null = body.namedAgentId || null;

  try {
    validateMentionsExist({
      projectId,
      textSources: [body.comment],
    });
  } catch (error) {
    if (error instanceof MentionResolutionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  // Validate epic exists (project-scoped)
  const foundEpic = getEpicOr404(projectId, epicId);
  if (isErrorResponse(foundEpic)) return foundEpic;
  const { epic } = foundEpic;

  // Validate status
  if (!["backlog", "todo", "in_progress", "review"].includes(epic.status ?? "")) {
    return NextResponse.json(
      { error: "Epic must be in backlog, todo, in_progress, or review status to build" },
      { status: 400 }
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

  // Post optional comment as epic comment
  if (body.comment && body.comment.trim()) {
    db.insert(ticketComments)
      .values({
        id: createId(),
        epicId,
        author: "user",
        content: body.comment.trim(),
        createdAt: new Date().toISOString(),
      })
      .run();
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

  // Load open review comments (code review feedback)
  const openReviewComments = db
    .select()
    .from(reviewComments)
    .where(
      and(
        eq(reviewComments.epicId, epicId),
        eq(reviewComments.status, "open")
      )
    )
    .orderBy(reviewComments.createdAt)
    .all();

  // Format review comments as additional prompt context
  let reviewContext = "";
  if (openReviewComments.length > 0) {
    const byFile = new Map<string, typeof openReviewComments>();
    for (const rc of openReviewComments) {
      const existing = byFile.get(rc.filePath) || [];
      existing.push(rc);
      byFile.set(rc.filePath, existing);
    }
    const parts = ["## Code Review Feedback\n\nThe following review comments were left on your previous changes. Address each one:\n"];
    for (const [filePath, fileComments] of byFile) {
      parts.push(`### ${filePath}`);
      for (const rc of fileComments) {
        parts.push(`- **Line ${rc.lineNumber}**: ${rc.body}`);
      }
      parts.push("");
    }
    reviewContext = parts.join("\n");
  }

  const buildSystemPrompt = await resolveAgentPrompt("build", projectId);

  // Create worktree
  const { worktreePath, branchName } = await createWorktree(
    gitRepoPath,
    epic.id,
    epic.title
  );

  // Build prompt — append review context if present
  let prompt = buildBuildPrompt(project, [], epic, us, buildSystemPrompt, promptComments);
  if (reviewContext) {
    prompt = prompt + "\n\n" + reviewContext;
  }

  let enrichedPrompt = prompt;
  try {
    enrichedPrompt = enrichPromptWithDocumentMentions({
      projectId,
      prompt,
      textSources: [body.comment, ...promptComments.map((c) => c.content)],
    }).prompt;
  } catch (error) {
    if (error instanceof MentionResolutionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const resolvedAgent = resolveAgentByNamedId("build", projectId, namedAgentId);

  const providerSupportsResume =
    resolvedAgent.provider === "claude-code" ||
    resolvedAgent.provider === "gemini-cli" ||
    resolvedAgent.provider === "codex";

  // Resume support — scope-guarded
  let cliSessionId: string | undefined;
  let resumeSession = false;
  if (providerSupportsResume && body.resumeSessionId) {
    const validated = validateResumeSession({
      resumeSessionId: body.resumeSessionId,
      epicId: epicId,
    });
    if (validated) {
      cliSessionId = validated.cliSessionId;
      resumeSession = true;
    }
  }
  if (!cliSessionId && providerSupportsResume) {
    cliSessionId = crypto.randomUUID();
  }

  // Create session
  const sessionId = createId();
  const now = new Date().toISOString();
  const logsDir = path.join(process.cwd(), "data", "sessions", sessionId);
  fs.mkdirSync(logsDir, { recursive: true });
  const logsPath = path.join(logsDir, "logs.json");

  // Check concurrency guard
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

  createQueuedSession({
    id: sessionId,
    projectId,
    epicId,
    mode: "code",
    provider: resolvedAgent.provider,
    prompt: enrichedPrompt,
    logsPath,
    branchName,
    worktreePath,
    cliSessionId,
    namedAgentId: resolvedAgent.namedAgentId ?? null,
    agentType: "build",
    namedAgentName: resolvedAgent.name || null,
    model: resolvedAgent.model || null,
    createdAt: now,
  });

  // Status sync: epic -> in_progress, non-done US -> in_progress
  db.update(epics)
    .set({ status: "in_progress", branchName, updatedAt: now })
    .where(eq(epics.id, epicId))
    .run();

  db.update(userStories)
    .set({ status: "in_progress" })
    .where(
      and(
        eq(userStories.epicId, epicId),
        notInArray(userStories.status, ["done"])
      )
    )
    .run();

  emitSessionStarted(projectId, epicId, sessionId, "build");
  emitTicketMoved(projectId, epicId, epic.status ?? "backlog", "in_progress");
  logTransition({
    projectId,
    epicId,
    fromStatus: epic.status ?? "backlog",
    toStatus: "in_progress",
    actor: "agent",
    reason: "Build agent started",
    sessionId,
  });

  // Batch-style launch: goes through the per-project scheduler. The session
  // stays 'queued' until a slot frees; the closure spawns, waits for
  // completion, syncs statuses, and posts the agent comment.
  agentScheduler.submit(projectId, sessionId, async () => {
    markSessionRunning(sessionId);
    processManager.start(sessionId, {
      mode: "code",
      prompt: enrichedPrompt,
      cwd: worktreePath,
      allowedTools: ["Edit", "Write", "Bash", "Read", "Glob", "Grep"],
      model: resolvedAgent.model,
      cliSessionId,
      resumeSession,
    }, resolvedAgent.provider);

    const info = await waitForProcessCompletion(sessionId);

    const completedAt = new Date().toISOString();
    const result = info?.result;

    try {
      fs.writeFileSync(logsPath, JSON.stringify(result, null, 2));
    } catch {
      // ignore
    }

    const outcome = classifySessionOutcome(result, sessionId);

    try {
      markSessionTerminal(
        sessionId,
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
        console.error("[epic build] Failed to finalize session", error);
      }
    }

    // On success: all non-done US -> review, epic -> review.
    // If the agent asked a follow-up question, keep work in progress.
    if (result?.success && outcome !== "asked_question") {
      db.update(userStories)
        .set({ status: "review" })
        .where(
          and(
            eq(userStories.epicId, epicId),
            notInArray(userStories.status, ["done"])
          )
        )
        .run();

      db.update(epics)
        .set({ status: "review", updatedAt: completedAt })
        .where(eq(epics.id, epicId))
        .run();

      emitSessionCompleted(projectId, epicId, sessionId);
      emitTicketMoved(projectId, epicId, "in_progress", "review");
      logTransition({
        projectId,
        epicId,
        fromStatus: "in_progress",
        toStatus: "review",
        actor: "agent",
        reason: "Build completed successfully",
        sessionId,
      });
    } else if (result?.success) {
      // asked_question: hold the ticket in in_progress, notify with a deep
      // link to the epic, and log the decision to the activity feed.
      handleAskedQuestionOutcome({
        projectId,
        epicIds: [epicId],
        sessionId,
        ticketStatus: "in_progress",
      });
      emitSessionCompleted(projectId, epicId, sessionId);
    } else {
      emitSessionFailed(projectId, epicId, sessionId, result?.error || "Build failed");
    }

    // Post output as epic comment
    const output = resolveSessionOutput(result, sessionId);

    db.insert(ticketComments)
      .values({
        id: createId(),
        epicId,
        author: "agent",
        content: output,
        agentSessionId: sessionId,
        createdAt: completedAt,
      })
      .run();
  });

  return NextResponse.json({
    data: { sessionId, branchName, worktreePath },
  });
}
