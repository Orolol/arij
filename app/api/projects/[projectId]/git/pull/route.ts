import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, projects } from "@/lib/db/schema";
import {
  getCurrentGitBranch,
  getConflictFileDiffs,
  pullGitBranchWithConflictSupport,
} from "@/lib/git/remote";
import { writeGitSyncLog } from "@/lib/github/sync-log";
import { resolveAgentByNamedId } from "@/lib/agent-config/providers";
import { createId } from "@/lib/utils/nanoid";
import {
  createQueuedSession,
  isSessionLifecycleConflictError,
  markSessionRunning,
  markSessionTerminal,
} from "@/lib/agent-sessions/lifecycle";
import { processManager } from "@/lib/claude/process-manager";
import { isResumableProvider } from "@/lib/agent-sessions/validate-resume";
import fs from "fs";
import path from "path";

type Params = { params: Promise<{ projectId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  if (!project.gitRepoPath) {
    writeGitSyncLog({
      projectId,
      operation: "pull",
      status: "failed",
      branch: null,
      detail: { reason: "missing_git_repo_path" },
    });

    return NextResponse.json(
      { error: "Project has no git repository path configured." },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const remote = typeof body?.remote === "string" ? body.remote : "origin";
  const autoResolve =
    typeof body?.autoResolveConflicts === "boolean"
      ? body.autoResolveConflicts
      : true;
  const namedAgentId =
    typeof body?.namedAgentId === "string" ? body.namedAgentId : null;
  const resumeSessionId =
    typeof body?.resumeSessionId === "string" ? body.resumeSessionId : null;
  const requestedBranch = typeof body?.branch === "string" ? body.branch : "";
  const branch = requestedBranch.trim() || (await getCurrentGitBranch(project.gitRepoPath));
  const resolved = resolveAgentByNamedId("merge", projectId, namedAgentId);
  const provider = resolved.provider;
  const model = resolved.model;

  try {
    const result = await pullGitBranchWithConflictSupport(project.gitRepoPath, branch, remote);

    if (result.conflicted) {
      if (!autoResolve) {
        const conflictDiffs = await getConflictFileDiffs(
          project.gitRepoPath,
          result.conflictedFiles
        );
        writeGitSyncLog({
          projectId,
          operation: "pull",
          status: "failed",
          branch,
          detail: {
            remote,
            code: "merge_conflicts",
            conflictedFiles: result.conflictedFiles,
          },
        });
        return NextResponse.json(
          {
            error: "Pull resulted in merge conflicts.",
            data: {
              action: "pull",
              projectId,
              remote,
              branch,
              conflicted: true,
              conflictedFiles: result.conflictedFiles,
              conflictDiffs,
              autoResolve: false,
            },
          },
          { status: 409 }
        );
      }

      try {
        const sessionId = createId();
        const now = new Date().toISOString();
        const logsDir = path.join(process.cwd(), "data", "sessions", sessionId);
        fs.mkdirSync(logsDir, { recursive: true });
        const logsPath = path.join(logsDir, "logs.json");

        let cliSessionId: string | undefined;
        let resumeSession = false;
        if (isResumableProvider(provider)) {
          if (resumeSessionId) {
            const previous = db
              .select({
                id: agentSessions.id,
                projectId: agentSessions.projectId,
                provider: agentSessions.provider,
                cliSessionId: agentSessions.cliSessionId,
                claudeSessionId: agentSessions.claudeSessionId,
              })
              .from(agentSessions)
              .where(eq(agentSessions.id, resumeSessionId))
              .get();
            if (
              previous &&
              previous.projectId === projectId &&
              previous.provider === provider &&
              (previous.cliSessionId || previous.claudeSessionId)
            ) {
              cliSessionId = previous.cliSessionId ?? previous.claudeSessionId ?? undefined;
              resumeSession = true;
            }
          }
          if (!cliSessionId) {
            cliSessionId = crypto.randomUUID();
          }
        }

        const prompt = [
          "Resolve git merge conflicts from a pull operation.",
          `Repository: ${project.gitRepoPath}`,
          `Branch: ${branch}`,
          `Remote: ${remote}`,
          "",
          "Conflicted files:",
          ...result.conflictedFiles.map((file) => `- ${file}`),
          "",
          "Instructions:",
          "1. Open each conflicted file and resolve conflict markers.",
          "2. Keep behavior safe and minimal; do not invent unrelated refactors.",
          "3. Stage all resolved files and commit with a descriptive message.",
          "4. Confirm no conflicts remain (`git status`).",
          "5. In your final response, summarize the resolution decisions.",
        ].join("\n");

        createQueuedSession({
          id: sessionId,
          projectId,
          mode: "code",
          provider,
          prompt,
          logsPath,
          branchName: branch,
          worktreePath: project.gitRepoPath,
          claudeSessionId: cliSessionId,
          cliSessionId,
          namedAgentId: resolved.namedAgentId ?? null,
          agentType: "merge",
          namedAgentName: resolved.name || null,
          model: model || null,
          createdAt: now,
        });

        markSessionRunning(sessionId, now);
        processManager.start(
          sessionId,
          {
            mode: "code",
            prompt,
            cwd: project.gitRepoPath,
            model,
            allowedTools: ["Edit", "Write", "Bash", "Read", "Glob", "Grep"],
            cliSessionId,
            resumeSession,
          },
          provider
        );

        (async () => {
          let info = processManager.getStatus(sessionId);
          while (info && info.status === "running") {
            await new Promise((r) => setTimeout(r, 2000));
            info = processManager.getStatus(sessionId);
          }
          const completedAt = new Date().toISOString();
          const agentResult = info?.result;
          try {
            fs.writeFileSync(logsPath, JSON.stringify(agentResult, null, 2));
          } catch {
            // best effort
          }
          try {
            markSessionTerminal(
              sessionId,
              {
                success: !!agentResult?.success,
                error: agentResult?.error || null,
              },
              completedAt
            );
          } catch (error) {
            if (!isSessionLifecycleConflictError(error)) {
              console.error("[git/pull] Failed to finalize conflict session", error);
            }
          }
        })();

        writeGitSyncLog({
          projectId,
          operation: "pull",
          status: "failed",
          branch,
          detail: {
            remote,
            code: "merge_conflicts_auto_resolve_started",
            conflictedFiles: result.conflictedFiles,
            sessionId,
          },
        });

        return NextResponse.json(
          {
            data: {
              action: "pull",
              projectId,
              remote,
              branch,
              conflicted: true,
              autoResolve: true,
              sessionId,
              conflictedFiles: result.conflictedFiles,
            },
          },
          { status: 202 }
        );
      } catch (autoResolveError) {
        const conflictDiffs = await getConflictFileDiffs(
          project.gitRepoPath,
          result.conflictedFiles
        );
        return NextResponse.json(
          {
            error: `Auto-resolve failed: ${
              autoResolveError instanceof Error
                ? autoResolveError.message
                : "unknown error"
            }`,
            data: {
              action: "pull",
              projectId,
              remote,
              branch,
              conflicted: true,
              conflictedFiles: result.conflictedFiles,
              conflictDiffs,
              autoResolve: false,
            },
          },
          { status: 409 }
        );
      }
    }

    writeGitSyncLog({
      projectId,
      operation: "pull",
      status: "success",
      branch,
      detail: {
        remote,
        ffOnly: false,
        summary: result.summary,
      },
    });

    return NextResponse.json({
      data: {
        action: "pull",
        projectId,
        remote,
        branch,
        ffOnly: false,
        summary: result.summary,
      },
    });
  } catch (error) {
    writeGitSyncLog({
      projectId,
      operation: "pull",
      status: "failed",
      branch,
      detail: {
        remote,
        ffOnly: false,
        error: error instanceof Error ? error.message : "unknown_error",
      },
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to pull branch.",
        data: { action: "pull", projectId, remote, branch, ffOnly: false },
      },
      { status: 500 }
    );
  }
}
