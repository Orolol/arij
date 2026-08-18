import { and, eq } from "drizzle-orm";
import { db as defaultDb, type ArijDatabase } from "@/lib/db";
import { reviewComments } from "@/lib/db/schema";

/**
 * Blocking-findings assessment for the pipeline's review stage.
 *
 * Structured signal first: the MCP `submit_findings` tool files each finding
 * as a reviewComments row whose body is prefixed `[<severity>] ` with the
 * severity vocabulary critical|major|minor|info (see
 * app/api/mcp/submit-findings/route.ts). A finding BLOCKS when its row is
 *   - author 'agent',
 *   - status 'open',
 *   - created during the review-stage window (createdAt >= sinceIso), and
 *   - prefixed `[critical]` or `[major]`.
 * minor/info-only reviews pass.
 *
 * Prose fallback second: ONLY when the stage filed ZERO agent rows in the
 * window, the session output is scanned for the negative-verdict substrings
 * the review routes already use ('changes requested' | 'not complete' |
 * 'partially complete', lowercased). Non-negative prose + no rows = pass.
 *
 * Timestamps are compared via Date.parse on BOTH sides so explicit ISO
 * strings (what submit_findings writes) and SQLite CURRENT_TIMESTAMP
 * defaults coexist. reviewComments is epic-keyed only, so the same queries
 * serve story-scoped runs.
 *
 * The pipeline never mutates reviewComments — no auto-resolve. A second
 * cycle's verdict is computed from the second stage's window; humans
 * bulk-resolve open rows at approve time.
 */

export interface BlockingFinding {
  id: string;
  filePath: string;
  lineNumber: number;
  body: string;
  severity: "critical" | "major";
}

/** Body prefixes (as written by submit-findings) that block the pipeline. */
const BLOCKING_PREFIXES: ReadonlyArray<{
  prefix: string;
  severity: BlockingFinding["severity"];
}> = [
  { prefix: "[critical]", severity: "critical" },
  { prefix: "[major]", severity: "major" },
];

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

interface AgentReviewCommentRow {
  id: string;
  filePath: string;
  lineNumber: number;
  body: string;
  status: string;
  createdAt: string | null;
}

/**
 * All agent-authored reviewComments rows for the epic created at or after
 * `sinceIso` (any status). Rows whose createdAt cannot be parsed are treated
 * as outside the window — a finding we cannot date cannot be attributed to
 * the stage.
 */
function listAgentReviewCommentsSince(
  epicId: string,
  sinceIso: string,
  database: ArijDatabase
): AgentReviewCommentRow[] {
  const sinceMs = parseTimestamp(sinceIso);
  if (sinceMs === null) return [];

  return database
    .select({
      id: reviewComments.id,
      filePath: reviewComments.filePath,
      lineNumber: reviewComments.lineNumber,
      body: reviewComments.body,
      status: reviewComments.status,
      createdAt: reviewComments.createdAt,
    })
    .from(reviewComments)
    .where(
      and(eq(reviewComments.epicId, epicId), eq(reviewComments.author, "agent"))
    )
    .all()
    .filter((row) => {
      const createdMs = parseTimestamp(row.createdAt);
      return createdMs !== null && createdMs >= sinceMs;
    });
}

/**
 * Number of agent reviewComments rows filed in the stage window (any
 * status/severity). Zero enables the prose fallback.
 */
export function countAgentReviewCommentsSince(
  epicId: string,
  sinceIso: string,
  database: ArijDatabase = defaultDb
): number {
  return listAgentReviewCommentsSince(epicId, sinceIso, database).length;
}

/**
 * Open agent-authored [critical]/[major] findings created in the stage
 * window — the rows that block the pipeline's review verdict.
 */
export function collectBlockingFindings(
  epicId: string,
  sinceIso: string,
  database: ArijDatabase = defaultDb
): BlockingFinding[] {
  const findings: BlockingFinding[] = [];
  for (const row of listAgentReviewCommentsSince(epicId, sinceIso, database)) {
    if (row.status !== "open") continue;
    const match = BLOCKING_PREFIXES.find(({ prefix }) =>
      row.body.startsWith(prefix)
    );
    if (!match) continue;
    findings.push({
      id: row.id,
      filePath: row.filePath,
      lineNumber: row.lineNumber,
      body: row.body,
      severity: match.severity,
    });
  }
  return findings;
}

/**
 * Byte-compatible with the review routes' verdict scan: the lowercased whole
 * output is checked for these substrings.
 */
export const NEGATIVE_VERDICT_SUBSTRINGS = [
  "changes requested",
  "not complete",
  "partially complete",
] as const;

export function isNegativeProseVerdict(output: string): boolean {
  const lower = output.toLowerCase();
  return NEGATIVE_VERDICT_SUBSTRINGS.some((substring) =>
    lower.includes(substring)
  );
}

export interface ReviewAssessment {
  /** True when the review outcome blocks the run (findings or prose). */
  blocking: boolean;
  blockingFindings: BlockingFinding[];
  /** Agent rows filed in the window, any status/severity. */
  agentCommentCount: number;
  /** True when zero rows were filed and prose decided the verdict. */
  usedProseFallback: boolean;
  /** Result of the prose scan (informational when rows exist). */
  proseNegative: boolean;
}

/**
 * Full review-stage verdict: structured findings when the reviewer filed
 * any rows, prose fallback only on a row-less review.
 */
export function assessReviewOutcome(input: {
  epicId: string;
  sinceIso: string;
  sessionOutput: string;
  database?: ArijDatabase;
}): ReviewAssessment {
  const database = input.database ?? defaultDb;
  const agentCommentCount = countAgentReviewCommentsSince(
    input.epicId,
    input.sinceIso,
    database
  );
  const blockingFindings = collectBlockingFindings(
    input.epicId,
    input.sinceIso,
    database
  );
  const proseNegative = isNegativeProseVerdict(input.sessionOutput);
  const usedProseFallback = agentCommentCount === 0;
  const blocking = usedProseFallback
    ? proseNegative
    : blockingFindings.length > 0;

  return {
    blocking,
    blockingFindings,
    agentCommentCount,
    usedProseFallback,
    proseNegative,
  };
}
