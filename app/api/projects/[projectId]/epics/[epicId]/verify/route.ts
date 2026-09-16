import { latestVerifyReport } from "@/lib/verify/freshness";
import { planEpicVerification } from "@/lib/verify/plan";
import { NextRequest, NextResponse } from "next/server";
import {
  createAgentAlreadyRunningPayload,
  getRunningSessionForTarget,
} from "@/lib/agents/concurrency";
import {
  errorResponse,
  getEpicOr404,
  getProjectOr404,
  isErrorResponse,
} from "@/lib/api/route-helpers";
import { emitTicketUpdated } from "@/lib/events/emit";
import { logTransition } from "@/lib/workflow/log";
import {
  isVerificationAlreadyRunningError,
  withVerificationWorktreeLock,
} from "@/lib/verify/execution-lock";
import { runVerification } from "@/lib/verify/runner";


type Params = { params: Promise<{ projectId: string; epicId: string }> };

/** Latest persisted deterministic verification report for the ticket overlay. */
export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId, epicId } = await params;

  const found = getEpicOr404(projectId, epicId);
  if (isErrorResponse(found)) return found;

  return NextResponse.json({ data: latestVerifyReport(projectId, epicId) });
}

/** Run human-configured commands synchronously in an existing epic worktree. */
export async function POST(_request: NextRequest, { params }: Params) {
  const { projectId, epicId } = await params;

  const foundProject = getProjectOr404(projectId, { requireGitRepo: true });
  if (isErrorResponse(foundProject)) return foundProject;
  const foundEpic = getEpicOr404(projectId, epicId);
  if (isErrorResponse(foundEpic)) return foundEpic;

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
        "Verification cannot run while an agent is active on this epic."
      ),
      { status: 409 }
    );
  }

  const planned = planEpicVerification(projectId, epicId);
  if (!planned.plan) return NextResponse.json({ error: planned.reason ?? "Verification is not configured for this project. Add at least one verify command in Settings." }, { status: 409 });
  const { worktreePath, commands, timeoutMs, codeSessionId } = planned.plan;

  try {
    const report = await withVerificationWorktreeLock(
      worktreePath,
      () =>
        runVerification({
          projectId,
          epicId,
          agentSessionId: codeSessionId,
          worktreePath,
          commands,
          timeoutMs,
        }),
      { wait: false }
    );

    const epicStatus = foundEpic.epic.status ?? "backlog";
    const failedCommand = report.commands.find(
      (command) => command.exitCode !== 0
    );
    logTransition({
      projectId,
      epicId,
      fromStatus: epicStatus,
      toStatus: epicStatus,
      actor: "system",
      reason: !report.persisted
        ? // The commands ran, but no durable reader will ever see the verdict
          // — the band refetches from the table and the merge gate reads it.
          "Manual verification ran but its report could not be saved"
        : report.status === "pass"
          ? `Manual verification passed (${report.commands.length} command${report.commands.length === 1 ? "" : "s"})`
          : `Manual verification failed${failedCommand ? ` at ${failedCommand.name}` : ""}`,
    });

    // Reuse the board's canonical refresh event rather than introducing a
    // verify-only event that every SSE consumer would have to understand.
    emitTicketUpdated(projectId, epicId, {
      verifyReportId: report.id,
      verifyStatus: report.status,
    });

    return NextResponse.json({ data: report });
  } catch (error) {
    if (isVerificationAlreadyRunningError(error)) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return errorResponse(error, "Failed to run verification");
  }
}
