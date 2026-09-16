import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, verifyReports } from "@/lib/db/schema";
import { parseStoredTimestamp } from "@/lib/utils/timestamps";
import {
  isVerifyCommandResult,
  type VerificationReport,
} from "./verify-constants";

/**
 * Reading the persisted evidence for an epic, in one place.
 *
 * Three call sites need the same question answered — "does a mechanical
 * report vouch for the branch we are about to act on?": Full Auto's merge
 * gate, its review dispatch (which forwards a passing report to the
 * reviewer), and the conflict retry. They must agree, so the query, the
 * freshness rule and the vocabulary for why evidence is unusable live here
 * rather than being reimplemented per caller.
 */

/** Code sessions whose work a report has to be newer than to still apply. */
const CODE_SESSION_TYPES = ["build", "ticket_build", "team_build", "fix", "merge"];

/** Why the newest report cannot vouch for the branch. */
export type VerificationProblemKind = "missing" | "failed" | "stale";

export interface VerificationProblem {
  kind: VerificationProblemKind;
  /** Reader-facing phrase, used verbatim in activity entries. */
  reason: string;
}

export interface VerificationAssessment {
  /** Newest persisted report, or null when there is none / it is corrupt. */
  report: VerificationReport | null;
  /** Newest code session on the epic — what a re-run would verify. */
  lastCodeSessionId: string | null;
  /** Null when the evidence vouches for the branch. */
  problem: VerificationProblem | null;
}

/**
 * All-or-nothing on the command rows, matching the manual route: a report
 * whose entries are half-readable is evidence nobody should act on, and a
 * shorter list would silently drop exactly the failing command.
 */
export function parseVerifyReportRow(
  row: typeof verifyReports.$inferSelect
): VerificationReport | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.commands);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || !parsed.every(isVerifyCommandResult)) {
    return null;
  }
  return {
    id: row.id,
    projectId: row.projectId,
    epicId: row.epicId,
    agentSessionId: row.agentSessionId,
    status: row.status === "pass" ? "pass" : "fail",
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    commands: parsed,
  };
}

/**
 * Compares the epic's newest report against its newest code session.
 *
 * `merge` counts as a code session: the conflict-resolution agent edits and
 * commits into the very worktree about to be merged, so a report older than
 * it describes a tree that no longer exists.
 */
export function assessEpicVerification(
  projectId: string,
  epicId: string
): VerificationAssessment {
  const lastCodeSession = db
    .select({
      id: agentSessions.id,
      createdAt: agentSessions.createdAt,
      endedAt: agentSessions.endedAt,
      completedAt: agentSessions.completedAt,
    })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        eq(agentSessions.epicId, epicId),
        inArray(agentSessions.agentType, CODE_SESSION_TYPES)
      )
    )
    .orderBy(
      // An undated code change cannot be proven older than any report.
      desc(sql`julianday(COALESCE(${agentSessions.endedAt}, ${agentSessions.completedAt}, ${agentSessions.createdAt})) IS NULL`),
      desc(sql`julianday(COALESCE(${agentSessions.endedAt}, ${agentSessions.completedAt}, ${agentSessions.createdAt}))`),
      desc(agentSessions.id),
    )
    .get();
  const lastCodeSessionId = lastCodeSession?.id ?? null;

  const report = latestVerifyReport(projectId, epicId);

  if (!report) {
    return {
      report: null,
      lastCodeSessionId,
      problem: {
        kind: "missing",
        reason: "deterministic verification has never run for this epic",
      },
    };
  }
  if (report.status !== "pass") {
    return {
      report,
      lastCodeSessionId,
      problem: {
        kind: "failed",
        reason: "the latest deterministic verification did not pass",
      },
    };
  }

  const reportFinishedAt = parseStoredTimestamp(report.finishedAt);
  const codeEndedAt = lastCodeSession
    ? (lastCodeSession.endedAt ?? lastCodeSession.completedAt ?? lastCodeSession.createdAt)
    : null;
  const codeInstant = codeEndedAt ? parseStoredTimestamp(codeEndedAt) : null;
  if (reportFinishedAt === null || (lastCodeSession && codeInstant === null)) {
    return {
      report,
      lastCodeSessionId,
      problem: {
        kind: "stale",
        reason: "verification freshness cannot be established from the stored timestamps",
      },
    };
  }
  if (
    codeInstant !== null && reportFinishedAt < codeInstant
  ) {
    return {
      report,
      lastCodeSessionId,
      problem: {
        kind: "stale",
        reason: "the passing verification predates the most recent code session",
      },
    };
  }

  return { report, lastCodeSessionId, problem: null };
}

export function latestVerifyReport(projectId: string, epicId: string): VerificationReport | null {
  const row = db
    .select()
    .from(verifyReports)
    .where(
      and(
        eq(verifyReports.projectId, projectId),
        eq(verifyReports.epicId, epicId)
      )
    )
    .orderBy(desc(sql`julianday(${verifyReports.finishedAt})`), desc(verifyReports.id))
    .get();
  return row ? parseVerifyReportRow(row) : null;

}
