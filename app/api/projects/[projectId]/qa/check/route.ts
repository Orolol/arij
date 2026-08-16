import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { qaReports } from "@/lib/db/schema";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { createId } from "@/lib/utils/nanoid";
import { processManager } from "@/lib/claude/process-manager";
import { waitForProcessCompletion } from "@/lib/agent-sessions/wait-for-completion";
import {
  classifySessionOutcome,
  resolveSessionOutput,
} from "@/lib/claude/resolve-session-output";
import { buildTechCheckPrompt, buildE2eTestPrompt } from "@/lib/claude/prompt-builder";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import { resolveAgentByNamedId } from "@/lib/agent-config/agent-resolution";
import type { AgentType } from "@/lib/agent-config/constants";
import {
  createQueuedSession,
  isSessionLifecycleConflictError,
  markSessionRunning,
  markSessionTerminal,
} from "@/lib/agent-sessions/lifecycle";
import { agentScheduler } from "@/lib/agents/scheduler";

type Params = { params: Promise<{ projectId: string }> };

type CheckType = "tech_check" | "e2e_test";

const CHECK_TYPE_TO_AGENT_TYPE: Record<CheckType, AgentType> = {
  tech_check: "tech_check",
  e2e_test: "e2e_test",
};

const CHECK_TYPE_LABELS: Record<CheckType, string> = {
  tech_check: "Tech check",
  e2e_test: "E2E test",
};

const POLL_INTERVAL_MS = 2000;

function toNullableTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseCheckType(value: unknown): CheckType {
  if (value === "e2e_test") return "e2e_test";
  return "tech_check";
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
    return paragraphs[0].slice(0, 500);
  }

  return normalized.slice(0, 500);
}

export async function POST(request: NextRequest, { params }: Params) {
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

  const systemPrompt = await resolveAgentPrompt(agentType, projectId);
  const resolvedAgent = resolveAgentByNamedId(agentType, projectId, namedAgentId);

  const prompt =
    checkType === "e2e_test"
      ? buildE2eTestPrompt(project, customPrompt, systemPrompt)
      : buildTechCheckPrompt(project, customPrompt, systemPrompt);

  const sessionId = createId();
  const reportId = createId();
  const now = new Date().toISOString();
  const logsDir = path.join(process.cwd(), "data", "sessions", sessionId);
  fs.mkdirSync(logsDir, { recursive: true });
  const logsPath = path.join(logsDir, "logs.json");
  const cliSessionId = crypto.randomUUID();

  createQueuedSession({
    id: sessionId,
    projectId,
    mode: "code",
    provider: resolvedAgent.provider,
    prompt,
    logsPath,
    cliSessionId,
    agentType,
    createdAt: now,
  });

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
      createdAt: now,
    })
    .run();

  // Scheduled QA launch via the per-project scheduler: the closure spawns
  // the agent, waits for completion, and finalizes the report.
  agentScheduler.submit(projectId, sessionId, async () => {
    markSessionRunning(sessionId);

    processManager.start(
      sessionId,
      {
        mode: "code",
        prompt,
        cwd: project.gitRepoPath,
        model: resolvedAgent.model,
        cliSessionId,
      },
      resolvedAgent.provider,
    );

    const info = await waitForProcessCompletion(sessionId, POLL_INTERVAL_MS);

    const completedAt = new Date().toISOString();
    const result = info?.result;

    try {
      fs.writeFileSync(logsPath, JSON.stringify(result, null, 2));
    } catch {
      // Ignore best-effort log writes.
    }

    try {
      markSessionTerminal(
        sessionId,
        {
          success: !!result?.success,
          error: result?.error ?? null,
          outcome: classifySessionOutcome(result, sessionId),
        },
        completedAt,
      );
    } catch (error) {
      if (!isSessionLifecycleConflictError(error)) {
        console.error("[qa-check] Failed to finalize session", error);
      }
    }

    const fallbackLabel = CHECK_TYPE_LABELS[checkType];
    const output = resolveSessionOutput(result, sessionId, `${fallbackLabel} completed without output.`);

    const reportStatus =
      info?.status === "cancelled"
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
  });

  return NextResponse.json({
    data: { reportId, sessionId },
  });
}
