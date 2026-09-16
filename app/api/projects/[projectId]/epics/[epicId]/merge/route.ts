import {
  createAgentAlreadyRunningPayload,
  getRunningSessionForTarget,
} from "@/lib/agents/concurrency";
import {
  getEpicOr404,
  getProjectOr404,
  isErrorResponse,
} from "@/lib/api/route-helpers";
import { autoModeRegistry } from "@/lib/auto-mode/registry";
import { db } from "@/lib/db";
import { agentSessions, epics, ticketComments } from "@/lib/db/schema";
import { mergeWorktree, type MergeWorktreeResult } from "@/lib/git/manager";
import { tryExportArjiJson } from "@/lib/sync/export";
import type { KanbanStatus } from "@/lib/types/kanban";
import { createId } from "@/lib/utils/nanoid";
import { logTransition } from "@/lib/workflow/log";
import { resolveOpenReviewComments } from "@/lib/workflow/merge-approval";
import { buildMergeBlockedReason, buildMergeConflictMarkersBlockedReason } from "@/lib/workflow/merge-failure";
import { applyTransition } from "@/lib/workflow/transition-service";
import { and, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; epicId: string }> }
) {
  const { projectId, epicId } = await params;



  const foundProject = getProjectOr404(projectId, { requireGitRepo: true });
  if (isErrorResponse(foundProject)) return foundProject;
  const { project } = foundProject;

  const foundEpic = getEpicOr404(projectId, epicId);
  if (isErrorResponse(foundEpic)) return foundEpic;
  const { epic } = foundEpic;

  if (!epic.branchName) {
    return NextResponse.json({ error: "Epic has no branch to merge" }, { status: 400 });
  }

  // Workflow guards run before git, so only a ticket at the merge boundary
  // (to_merge) can land on main.
  const preflight = applyTransition({
    projectId,
    epicId,
    fromStatus: (epic.status ?? "to_merge") as KanbanStatus,
    toStatus: "done",
    actor: "user",
    source: "merge",
    reason: "Manual merge preflight",
    validateOnly: true,
  });
  if (!preflight.valid) {
    return NextResponse.json({ error: preflight.error }, { status: 400 });
  }

  // Concurrency guard BEFORE any git work — this is now the ONLY merge entry
  // for the board and the ticket detail, so it carries the guards the retired
  // approve route had: `mergeWorktree` runs `git worktree remove --force`,
  // and landing that on top of a queued session drops it into a directory
  // that no longer exists the moment it starts.
  const activeSession = getRunningSessionForTarget({
    scope: "epic",
    projectId,
    epicId,
  });
  if (activeSession) {
    return NextResponse.json(
      createAgentAlreadyRunningPayload(
        { scope: "epic", projectId, epicId },
        activeSession,
        "Another agent is already running for this epic."
      ),
      { status: 409 }
    );
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

  // Per-epic and per-project merge serialization, same as resolve-merge and
  // Full Auto: git is not transactional and two merges on one repository
  // race on index.lock and on each other's rollback checkpoints.
  if (!autoModeRegistry.beginMergeWork(projectId, epicId)) {
    return NextResponse.json(
      { error: "A merge is already in flight for this epic — retry in a moment." },
      { status: 409 }
    );
  }
  let result: MergeWorktreeResult;
  try {
    if (!autoModeRegistry.tryLockProjectMerge(projectId)) {
      return NextResponse.json(
        {
          error:
            "Another merge is in progress in this repository — retry in a moment.",
        },
        { status: 409 }
      );
    }
    try {
      result = await mergeWorktree(
        project.gitRepoPath,
        epic.branchName,
        worktreePath,
        { defaultBranch: project.defaultBranch }
      );
    } catch (e) {
      // A throw (repository gone, git binary failure) must flow into the
      // ordinary failure path below — with its ticket trail — not out of the
      // handler as a bare 500.
      result = {
        merged: false,
        error: e instanceof Error ? e.message : "Merge failed",
        reason: "error",
      };
    } finally {
      autoModeRegistry.unlockProjectMerge(projectId);
    }
  } finally {
    autoModeRegistry.endMergeWork(projectId, epicId);
  }

  if (result.merged) {
    const prevStatus = (epic.status ?? "to_merge") as KanbanStatus;

    // Re-check and apply after git: guards may have changed during the merge.
    const validation = applyTransition({
      projectId,
      epicId,
      fromStatus: prevStatus,
      toStatus: "done",
      actor: "user",
      source: "merge",
      reason: "Branch merged successfully",
    });
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // The status is already guarded/applied; branch cleanup is metadata only.
    db.update(epics)
      .set({ branchName: null, updatedAt: new Date().toISOString() })
      .where(eq(epics.id, epicId))
      .run();

    // Only now that the epic is Done: the merge is the approval, so whatever
    // review comments stayed open — minor findings, notes from earlier cycles
    // — are accepted with it. AFTER the transition, never before; see
    // lib/workflow/merge-approval.ts.
    resolveOpenReviewComments(epicId);

    tryExportArjiJson(projectId);

    return NextResponse.json({
      data: {
        merged: true,
        commitHash: result.commitHash,
        ...(validation.skippedStories?.length
          ? { skippedStories: validation.skippedStories }
          : {}),
      },
    });
  }


  const mergeError = result.error || "Merge failed";
  const isConflict = result.reason === "conflict";
  const isConflictMarkers = result.reason === "conflict-markers";
  const now = new Date().toISOString();

  try {
    db.insert(ticketComments)
      .values({
        id: createId(),
        epicId,
        author: "agent",
        content: isConflict
          ? `**Merge failed.** ${mergeError}\n\nThe ticket stays in ${epic.status}. Use Resolve with Agent, then merge again.`
          : isConflictMarkers
          ? `**Merge failed — unresolved conflict markers.** ${mergeError}\n\nThe ticket stays in ${epic.status}. Clean the conflict markers in the branch, then merge again.`
          : `**Merge failed.** ${mergeError}\n\nThe ticket stays in ${epic.status}.`,
        createdAt: now,
      })
      .run();


    logTransition({
      projectId,
      epicId,
      fromStatus: (epic.status ?? "review") as KanbanStatus,
      toStatus: (epic.status ?? "review") as KanbanStatus,
      actor: "system",
      reason: isConflict
        ? buildMergeBlockedReason({
            branchName: epic.branchName,
            error: mergeError,
          })
        : isConflictMarkers
        ? buildMergeConflictMarkersBlockedReason({
            branchName: epic.branchName,
            error: mergeError,
          })
        : `Merge blocked: merge failed (${result.reason ?? "unknown"}) on ${epic.branchName} — ${mergeError}`,
    });
  } catch (trailError) {
    console.error(
      "[merge] Failed to record the merge-failure trail:",
      trailError
    );
  }

  if (isConflict) {
    return NextResponse.json(
      {
        error: `Merge failed: ${mergeError}. The ticket stays in ${epic.status} — resolve the conflict (Resolve with Agent) and merge again.`,
        reason: "conflict",
        code: "MERGE_CONFLICT",
        conflictFiles: result.conflictFiles,
        mergeFailed: true,
      },
      { status: 409 }
    );
  }

  if (isConflictMarkers) {
    return NextResponse.json(
      {
        error: `Merge failed: ${mergeError}. Unresolved conflict markers in branch — clean the markers and merge again.`,
        reason: "conflict-markers",
        mergeFailed: false,
      },
      { status: 409 }
    );
  }

  return NextResponse.json(
    {
      error: result.error || "Merge failed",
      reason: result.reason ?? "error",
      code: result.reason === "conflict" ? "MERGE_CONFLICT" : "MERGE_FAILED",
    },
    { status: 500 }
  );
}
