/**
 * Tests for the pipeline's blocking-findings assessment
 * (lib/pipeline/findings.ts) against the real migrated schema:
 * severity gating ([critical]/[major] block, [minor]/[info] don't), the
 * open-status and author filters, the stage window (explicit ISO and SQLite
 * CURRENT_TIMESTAMP formats), and the prose fallback that only fires when
 * the stage filed zero agent rows.
 */
import { describe, it, expect, beforeEach } from "vitest";

import { createTestDb } from "@/lib/db/test-utils";
import { projects, epics, reviewComments } from "@/lib/db/schema";
import {
  assessReviewOutcome,
  collectBlockingFindings,
  countAgentReviewCommentsSince,
  isNegativeProseVerdict,
  NEGATIVE_VERDICT_SUBSTRINGS,
} from "@/lib/pipeline/findings";

type TestDb = ReturnType<typeof createTestDb>["db"];

let db: TestDb;
let counter = 0;
let epicId: string;

const WINDOW_START = "2026-08-17T10:00:00.000Z";
const IN_WINDOW = "2026-08-17T10:05:00.000Z";
const BEFORE_WINDOW = "2026-08-17T09:00:00.000Z";

function seed() {
  counter += 1;
  const projectId = `proj-findings-${counter}`;
  epicId = `epic-findings-${counter}`;
  db.insert(projects).values({ id: projectId, name: "Findings" }).run();
  db.insert(epics)
    .values({ id: epicId, projectId, title: "Epic", status: "review", position: 0 })
    .run();
}

let rowCounter = 0;
function insertFinding(input: {
  body: string;
  author?: string;
  status?: string;
  createdAt?: string;
  filePath?: string;
  lineNumber?: number;
}) {
  rowCounter += 1;
  const id = `rc-${counter}-${rowCounter}`;
  db.insert(reviewComments)
    .values({
      id,
      epicId,
      filePath: input.filePath ?? "src/index.ts",
      lineNumber: input.lineNumber ?? 10,
      body: input.body,
      author: input.author ?? "agent",
      status: input.status ?? "open",
      createdAt: input.createdAt ?? IN_WINDOW,
      updatedAt: input.createdAt ?? IN_WINDOW,
    })
    .run();
  return id;
}

beforeEach(() => {
  db = createTestDb().db;
  seed();
});

describe("collectBlockingFindings", () => {
  it("collects open agent [critical] and [major] rows in the window with parsed severity", () => {
    const criticalId = insertFinding({
      body: "[critical] SQL injection in login",
    });
    const majorId = insertFinding({
      body: "[major] Missing error handling",
      filePath: "src/auth.ts",
      lineNumber: 42,
    });

    const findings = collectBlockingFindings(epicId, WINDOW_START, db);
    expect(findings).toHaveLength(2);
    expect(findings).toContainEqual({
      id: criticalId,
      filePath: "src/index.ts",
      lineNumber: 10,
      body: "[critical] SQL injection in login",
      severity: "critical",
    });
    expect(findings).toContainEqual(
      expect.objectContaining({ id: majorId, severity: "major" })
    );
  });

  it("ignores [minor] and [info] severities", () => {
    insertFinding({ body: "[minor] Rename this variable" });
    insertFinding({ body: "[info] Consider a comment here" });
    expect(collectBlockingFindings(epicId, WINDOW_START, db)).toEqual([]);
    // ... but they still count as filed rows (no prose fallback).
    expect(countAgentReviewCommentsSince(epicId, WINDOW_START, db)).toBe(2);
  });

  it("ignores resolved rows, user-authored rows, and rows before the window", () => {
    insertFinding({ body: "[critical] Old resolved one", status: "resolved" });
    insertFinding({ body: "[critical] Human note", author: "user" });
    insertFinding({
      body: "[critical] From a previous review",
      createdAt: BEFORE_WINDOW,
    });
    expect(collectBlockingFindings(epicId, WINDOW_START, db)).toEqual([]);
  });

  it("tolerates SQLite CURRENT_TIMESTAMP-style createdAt via Date.parse on both sides", () => {
    // 'YYYY-MM-DD HH:MM:SS' (no T, no zone) — what a DB-defaulted column
    // stores. Window start far in the past keeps the comparison robust
    // across the local-time interpretation of zoneless strings.
    insertFinding({
      body: "[major] Filed with a DB-default timestamp",
      createdAt: "2026-08-17 12:00:00",
    });
    const findings = collectBlockingFindings(epicId, "2020-01-01T00:00:00.000Z", db);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("major");
  });

  it("excludes rows whose createdAt cannot be dated", () => {
    insertFinding({ body: "[critical] Undatable", createdAt: "not-a-date" });
    expect(collectBlockingFindings(epicId, WINDOW_START, db)).toEqual([]);
    expect(countAgentReviewCommentsSince(epicId, WINDOW_START, db)).toBe(0);
  });
});

describe("isNegativeProseVerdict", () => {
  it("matches the review routes' three substrings, case-insensitively", () => {
    expect(NEGATIVE_VERDICT_SUBSTRINGS).toEqual([
      "changes requested",
      "not complete",
      "partially complete",
    ]);
    expect(
      isNegativeProseVerdict("**Overall Verdict: Changes Requested**")
    ).toBe(true);
    expect(isNegativeProseVerdict("verdict: NOT COMPLETE")).toBe(true);
    expect(isNegativeProseVerdict("Partially Complete, see notes")).toBe(true);
    expect(
      isNegativeProseVerdict("**Overall Verdict: Complete** — ship it")
    ).toBe(false);
    expect(isNegativeProseVerdict("")).toBe(false);
  });
});

describe("assessReviewOutcome", () => {
  it("blocks on structured [critical]/[major] findings", () => {
    insertFinding({ body: "[critical] Broken auth" });
    const assessment = assessReviewOutcome({
      epicId,
      sinceIso: WINDOW_START,
      sessionOutput: "**Overall Verdict: Complete**",
      database: db,
    });
    expect(assessment.blocking).toBe(true);
    expect(assessment.blockingFindings).toHaveLength(1);
    expect(assessment.usedProseFallback).toBe(false);
  });

  it("passes on minor/info-only findings even when the prose sounds negative", () => {
    // Rows were filed → the structured signal is authoritative; the prose
    // fallback must NOT fire.
    insertFinding({ body: "[minor] nit" });
    const assessment = assessReviewOutcome({
      epicId,
      sinceIso: WINDOW_START,
      sessionOutput: "Changes requested for style nits",
      database: db,
    });
    expect(assessment.blocking).toBe(false);
    expect(assessment.usedProseFallback).toBe(false);
    expect(assessment.proseNegative).toBe(true);
  });

  it("falls back to prose ONLY when zero agent rows were filed in the window", () => {
    const negative = assessReviewOutcome({
      epicId,
      sinceIso: WINDOW_START,
      sessionOutput: "**Overall Verdict: Changes Requested**",
      database: db,
    });
    expect(negative).toMatchObject({
      blocking: true,
      usedProseFallback: true,
      agentCommentCount: 0,
    });

    const positive = assessReviewOutcome({
      epicId,
      sinceIso: WINDOW_START,
      sessionOutput: "**Overall Verdict: Complete**",
      database: db,
    });
    expect(positive).toMatchObject({ blocking: false, usedProseFallback: true });
  });

  it("second-cycle verdicts ignore first-cycle rows via the fresh window", () => {
    insertFinding({
      body: "[critical] Cycle-1 finding, still open (never auto-resolved)",
      createdAt: IN_WINDOW,
    });
    const secondWindow = "2026-08-17T11:00:00.000Z";
    const assessment = assessReviewOutcome({
      epicId,
      sinceIso: secondWindow,
      sessionOutput: "**Overall Verdict: Complete**",
      database: db,
    });
    // Zero rows in the SECOND window → prose fallback → pass, even though
    // the cycle-1 row is still open (humans resolve at approve time).
    expect(assessment).toMatchObject({ blocking: false, usedProseFallback: true });
  });
});
