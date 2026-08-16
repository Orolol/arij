import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { epics, agentSessions, ticketComments } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  getEpicOr404,
  getProjectOr404,
  isErrorResponse,
} from "@/lib/api/route-helpers";
import { mergeWorktree } from "@/lib/git/manager";
import { tryExportArjiJson } from "@/lib/sync/export";
import { createId } from "@/lib/utils/nanoid";
import { processManager } from "@/lib/claude/process-manager";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import {
  classifySessionOutcome,
  resolveSessionOutput,
} from "@/lib/claude/resolve-session-output";
import {
  createQueuedSession,
  markSessionRunning,
  markSessionTerminal,
  isSessionLifecycleConflictError,
} from "@/lib/agent-sessions/lifecycle";
import {
  getRunningSessionForTarget,
} from "@/lib/agents/concurrency";
import { agentScheduler } from "@/lib/agents/scheduler";
import { waitForProcessCompletion } from "@/lib/agent-sessions/wait-for-completion";
import { applyTransition } from "@/lib/workflow/transition-service";
import { emitTicketMoved } from "@/lib/events/emit";
import { logTransition } from "@/lib/workflow/log";
import type { KanbanStatus } from "@/lib/types/kanban";
import fs from "fs";
import path from "path";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; epicId: string }> }
) {
  const { projectId, epicId } = await params;

  let autoAgent = false;
  try {
    const body = await request.json();
    autoAgent = body?.autoAgent === true;
  } catch {
    // No body or invalid JSON — defaults to false
  }

  const foundProject = getProjectOr404(projectId, { requireGitRepo: true });
  if (isErrorResponse(foundProject)) return foundProject;
  const { project } = foundProject;

  const foundEpic = getEpicOr404(projectId, epicId);
  if (isErrorResponse(foundEpic)) return foundEpic;
  const { epic } = foundEpic;

  if (!epic.branchName) {
    return NextResponse.json({ error: "Epic has no branch to merge" }, { status: 400 });
  }

  // Find the worktree path from the most recent session for this epic
  const session = db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.epicId, epicId), eq(agentSessions.projectId, projectId)))
    .orderBy(agentSessions.createdAt)
    .all()
    .pop();

  const worktreePath = session?.worktreePath || undefined;

  const result = await mergeWorktree(project.gitRepoPath, epic.branchName, worktreePath);

  if (result.merged) {
    const prevStatus = (epic.status ?? "review") as KanbanStatus;

    // Validate + emit + log via transition service (skip DB update — we handle branchName too)
    const validation = applyTransition({
      projectId,
      epicId,
      fromStatus: prevStatus,
      toStatus: "done",
      actor: "user",
      source: "merge",
      reason: "Branch merged successfully",
      skipDbUpdate: true,
    });
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Move epic to done + clear branch name
    const now = new Date().toISOString();
    db.update(epics)
      .set({ status: "done", branchName: null, updatedAt: now })
      .where(eq(epics.id, epicId))
      .run();

    tryExportArjiJson(projectId);

    return NextResponse.json({
      data: {
        merged: true,
        commitHash: result.commitHash,
      },
    });
  }

  // Merge failed — if autoAgent is enabled, launch a merge-fix agent
  if (autoAgent && worktreePath) {
    // Check concurrency guard
    const conflict = getRunningSessionForTarget({
      scope: "epic",
      projectId,
      epicId,
    });
    if (conflict) {
      return NextResponse.json(
        {
          error: `${result.error || "Merge failed"} — an agent is already running for this epic, so no merge-fix agent was launched.`,
        },
        { status: 500 }
      );
    }

    const mergeSystemPrompt = await resolveAgentPrompt("merge", projectId);
    const prompt = [
      mergeSystemPrompt,
      `The branch "${epic.branchName}" failed to merge into main.`,
      `Error: ${result.error || "Unknown merge conflict"}`,
      "",
      "Resolve the merge conflicts and complete the merge. Steps:",
      `1. In the worktree at ${worktreePath}, run: git merge main`,
      "2. Resolve all conflicts in the affected files",
      "3. Stage and commit the resolution",
      "4. Verify the build still passes",
    ].filter(Boolean).join("\n");

    const sessionId = createId();
    const now = new Date().toISOString();
    const logsDir = path.join(process.cwd(), "data", "sessions", sessionId);
    fs.mkdirSync(logsDir, { recursive: true });
    const logsPath = path.join(logsDir, "logs.json");

    const cliSessionId = crypto.randomUUID();

    createQueuedSession({
      id: sessionId,
      projectId,
      epicId,
      mode: "code",
      orchestrationMode: "solo",
      provider: "claude-code",
      prompt,
      logsPath,
      branchName: epic.branchName,
      worktreePath,
      cliSessionId,
      agentType: "merge",
      namedAgentName: null,
      model: null,
      createdAt: now,
    });

    // Scheduled merge-fix launch: spawn when a slot frees, wait for
    // completion, then attempt the merge again (no retry cap).
    agentScheduler.submit(projectId, sessionId, async () => {
      markSessionRunning(sessionId);
      processManager.start(sessionId, {
        mode: "code",
        prompt,
        cwd: worktreePath,
        allowedTools: ["Edit", "Write", "Bash", "Read", "Glob", "Grep"],
        cliSessionId,
      });

      const info = await waitForProcessCompletion(sessionId);

      const completedAt = new Date().toISOString();
      const agentResult = info?.result;

      try {
        fs.writeFileSync(logsPath, JSON.stringify(agentResult, null, 2));
      } catch {
        // ignore
      }

      try {
        markSessionTerminal(
          sessionId,
          {
            success: !!agentResult?.success,
            error: agentResult?.error || null,
            outcome: classifySessionOutcome(agentResult, sessionId),
          },
          completedAt
        );
      } catch (error) {
        if (!isSessionLifecycleConflictError(error)) {
          console.error("[merge/auto-agent] Failed to finalize session", error);
        }
      }

      // If agent succeeded, attempt merge again
      if (agentResult?.success) {
        const retryResult = await mergeWorktree(
          project.gitRepoPath!,
          epic.branchName!,
          worktreePath
        );
        if (retryResult.merged) {
          const mergedAt = new Date().toISOString();
          db.update(epics)
            .set({ status: "done", branchName: null, updatedAt: mergedAt })
            .where(eq(epics.id, epicId))
            .run();
          emitTicketMoved(projectId, epicId, epic.status ?? "review", "done");
          logTransition({
            projectId,
            epicId,
            fromStatus: epic.status ?? "review",
            toStatus: "done",
            actor: "agent",
            reason: "Merge-fix agent resolved conflicts and merged",
            sessionId,
          });
          tryExportArjiJson(projectId);
        }
      }

      // Post output as epic comment
      const mergeOutput = resolveSessionOutput(agentResult, sessionId);

      db.insert(ticketComments)
        .values({
          id: createId(),
          epicId,
          author: "agent",
          content: mergeOutput,
          agentSessionId: sessionId,
          createdAt: completedAt,
        })
        .run();
    });

    return NextResponse.json({
      data: {
        merged: false,
        autoAgent: true,
        sessionId,
        error: result.error || "Merge failed — agent launched to resolve",
      },
    });
  }

  return NextResponse.json(
    { error: result.error || "Merge failed" },
    { status: 500 }
  );
}
