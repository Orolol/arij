import { withAgentResolutionErrors } from "@/lib/api/agent-resolution-response";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { qaReports } from "@/lib/db/schema";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { createId } from "@/lib/utils/nanoid";
import { resolveSessionOutput } from "@/lib/claude/resolve-session-output";
import {
  buildTechCheckPrompt,
  buildE2eTestPrompt,
  buildFailureDigestPrompt,
} from "@/lib/claude/prompt-builder";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import { resolveAgentByNamedId } from "@/lib/agent-config/agent-resolution";
import { dispatchBackgroundSession } from "@/lib/agent-sessions/dispatch-background-session";
import type { AgentType } from "@/lib/agent-config/constants";
import { collectFailureDigestEvidence } from "@/lib/telescope/collect";
import {
  failQaReportLaunch,
  QA_REPORT_SUMMARY_MAX_CHARS,
} from "@/lib/qa/report-lifecycle";
import {
  TELESCOPE_MAX_WINDOW_DAYS,
  TELESCOPE_WINDOW_DAYS,
} from "@/lib/telescope/constants";

type Params = { params: Promise<{ projectId: string }> };

type CheckType = "tech_check" | "e2e_test" | "failure_digest";

const CHECK_TYPE_TO_AGENT_TYPE: Record<CheckType, AgentType> = {
  tech_check: "tech_check",
  e2e_test: "e2e_test",
  failure_digest: "failure_digest",
};

const CHECK_TYPE_LABELS: Record<CheckType, string> = {
  tech_check: "Tech check",
  e2e_test: "E2E test",
  failure_digest: "Failure digest",
};

const POLL_INTERVAL_MS = 2000;

function toNullableTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseCheckType(value: unknown): CheckType {
  if (value === "e2e_test") return "e2e_test";
  if (value === "failure_digest") return "failure_digest";
  return "tech_check";
}

function parseWindowDays(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(
    TELESCOPE_MAX_WINDOW_DAYS,
    Math.max(1, Math.floor(parsed))
  );
}

function emptyDigestReport(input: {
  sinceIso: string;
  untilIso: string;
  windowDays: number;
}): string {
  return `# Recurring Failure Digest

No eligible recurring failure evidence was found between ${input.sinceIso} and ${input.untilIso} (${input.windowDays}-day window). No analysis session was launched.`;
}

function extractSummary(content: string, checkType: CheckType): string {
  const normalized = content.trim();
  if (!normalized) {
    return `${CHECK_TYPE_LABELS[checkType]} completed without output.`;
  }

  const paragraphs = normalized
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0 && !paragraph.startsWith("#"));

  if (paragraphs.length > 0) {
    return paragraphs[0].slice(0, QA_REPORT_SUMMARY_MAX_CHARS);
  }

  return normalized.slice(0, QA_REPORT_SUMMARY_MAX_CHARS);
}

export const POST = withAgentResolutionErrors(async function POST(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const namedAgentId = toNullableTrimmedString(body.namedAgentId);
  const customPrompt = toNullableTrimmedString(body.customPrompt);
  const customPromptId = toNullableTrimmedString(body.customPromptId);
  const checkType = parseCheckType(body.checkType);
  const agentType = CHECK_TYPE_TO_AGENT_TYPE[checkType];

  const found = getProjectOr404(projectId, { requireGitRepo: true });
  if (isErrorResponse(found)) return found;
  const { project } = found;

  const collection =
    checkType === "failure_digest"
      ? collectFailureDigestEvidence(projectId, {
          windowDays: parseWindowDays(body.windowDays),
        })
      : null;

  // A report row is the durable journal for this successful no-op. It makes
  // "nothing happened" visible in the same QA history as real digests while
  // avoiding a provider call, an agent session row, and scheduler work.
  if (collection && collection.evidenceCount === 0) {
    const reportId = createId();
    const now = new Date().toISOString();
    const reportContent = emptyDigestReport(collection);
    const summary = `No recurring failure evidence in the last ${collection.windowDays} days; no agent session launched.`;

    db.insert(qaReports)
      .values({
        id: reportId,
        projectId,
        status: "completed",
        agentSessionId: null,
        namedAgentId: null,
        promptUsed: null,
        customPromptId: null,
        reportContent,
        summary,
        checkType,
        createdAt: now,
        completedAt: now,
      })
      .run();

    console.info(
      `[failure-digest] skipped for project ${projectId}: empty ${collection.windowDays}-day window`,
    );
    return NextResponse.json({
      data: {
        reportId,
        sessionId: null,
        noOp: true,
        evidenceCount: 0,
        windowDays: collection.windowDays,
      },
    });
  }

  const systemPrompt = await resolveAgentPrompt(agentType, projectId);
  const resolvedAgent = resolveAgentByNamedId(agentType, projectId, namedAgentId);

  const prompt =
    checkType === "failure_digest"
      ? buildFailureDigestPrompt(project, collection!, customPrompt, systemPrompt)
      : checkType === "e2e_test"
      ? buildE2eTestPrompt(project, customPrompt, systemPrompt)
      : buildTechCheckPrompt(project, customPrompt, systemPrompt);
  const mode = checkType === "failure_digest" ? "plan" : "code";

  // Assigned in `onQueued`, which fires synchronously inside the dispatch
  // once the session row exists — so the report id is minted after the
  // session id, and both `onLaunchFailure` and the response can read it.
  let reportId!: string;

  const { sessionId } = dispatchBackgroundSession({
    agentType,
    projectId,
    // No epicId: a QA check is project-level. It must not occupy an epic's
    // concurrency slot, and its MCP token has no ticket to default to.
    prompt,
    resolvedAgent,
    mode,
    cwd: project.gitRepoPath,
    pollIntervalMs: POLL_INTERVAL_MS,
    logPrefix: "[qa-check]",
    // The report row is the durable journal of this check, written while the
    // session is still queued so it exists before anything can spawn.
    onQueued: ({ sessionId, createdAt }) => {
      reportId = createId();
      db.insert(qaReports)
        .values({
          id: reportId,
          projectId,
          status: "running",
          agentSessionId: sessionId,
          namedAgentId,
          promptUsed: prompt,
          customPromptId,
          checkType,
          createdAt,
        })
        .run();
    },
    // The scheduler's safety net (`handleLaunchFailure`) finalizes the
    // SESSION when a launch rejects and knows nothing about `qa_reports` —
    // without this the row would sit on `running` until the next boot sweep,
    // which on a long-lived dev server can be days away. The report write
    // lives here rather than in the scheduler so the generic queue never has
    // to know what a QA report is.
    //
    // For a spawn that throws, the dispatch fires this in the launch
    // closure's own synchronous tick, so the report is already terminal when
    // this request returns. A rejection after the spawn (the process manager
    // settling abnormally, the finalizing statements throwing) reaches it a
    // microtask later, which is the best available and still ends the same
    // way: no boot sweep needed.
    onLaunchFailure: (error) => failQaReportLaunch(reportId, error),
    onTerminal: ({ sessionId, result, status, completedAt }) => {
      const fallbackLabel = CHECK_TYPE_LABELS[checkType];
      const output = resolveSessionOutput(
        result,
        sessionId,
        `${fallbackLabel} completed without output.`,
      );

      const reportStatus =
        status === "cancelled"
          ? "cancelled"
          : result?.success
            ? "completed"
            : "failed";

      db.update(qaReports)
        .set({
          status: reportStatus,
          reportContent: output,
          summary: extractSummary(output, checkType),
          completedAt,
        })
        .where(eq(qaReports.id, reportId))
        .run();
    },
  });

  return NextResponse.json({
    data: {
      reportId,
      sessionId,
      noOp: false,
      evidenceCount: collection?.evidenceCount ?? null,
      windowDays: collection?.windowDays ?? TELESCOPE_WINDOW_DAYS,
    },
  });
});
