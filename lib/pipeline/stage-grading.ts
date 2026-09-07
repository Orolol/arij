import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gradingReports } from "@/lib/db/schema";
import { dispatchGradingSession } from "@/lib/grading/dispatch";
import { parseGradingEntries } from "@/lib/grading/report";
import type { ResolvedAgent } from "@/lib/agent-config/agent-resolution";
import type {
  PipelineGradingAssessment,
  PipelineStageHandle,
  PipelineStageKind,
  PipelineStageRequest,
} from "./runner";
import { resolveStageAgent, type ResolvedStageAgent } from "./stage-agent";
import type { PipelineStageDriverInit } from "./stage-driver-init";

/**
 * Grading stage of the pipeline (opt-in acceptance grading): the dispatch
 * adapter over the reusable grader, and the read-back of the exact report
 * the grader filed.
 */

/** Adapts the reusable grader dispatcher to the pipeline stage contract. */
export async function dispatchPipelineGradingStage(
  init: PipelineStageDriverInit,
  request: PipelineStageRequest,
  /** The driver's per-stage-entry resolution — see `resolveConfiguredStageAgent`. */
  configuredAgent: (stage: PipelineStageKind) => Promise<ResolvedAgent>,
): Promise<PipelineStageHandle> {
  let compositeDescent: ResolvedStageAgent["compositeDescent"] = null;
  const result = await dispatchGradingSession({
    projectId: init.projectId,
    epicId: init.epicId,
    userStoryId: init.scope === "story" ? init.userStoryId : null,
    batchRunId: init.batchRunId ?? null,
    // Deferred on purpose: a rubric-free epic skips before this ever runs,
    // so it never pays for a resolution it will not spend.
    resolveAgent: async () => {
      const selected = resolveStageAgent(
        request,
        await configuredAgent("grading"),
      );
      compositeDescent = selected.compositeDescent;
      return selected.resolved;
    },
  });

  if (result.skipped) {
    return {
      sessionId: null,
      settled: Promise.resolve({
        sessionId: "",
        success: true,
        outcome: "answered",
        error: null,
        gradingReportId: null,
        gradingSkipped: true,
      }),
      compositeDescent: null,
    };
  }

  return {
    sessionId: result.sessionId,
    settled: result.settled.then((terminal) => ({
      sessionId: terminal.sessionId,
      success: terminal.success,
      outcome: terminal.outcome,
      error: terminal.error,
      gradingReportId: terminal.reportId,
      gradingSkipped: false,
    })),
    compositeDescent,
  };
}

/** Reads and validates the exact report filed by a successful grader. */
export async function assessPipelineGrading(
  init: PipelineStageDriverInit,
  input: { sessionId: string; reportId: string }
): Promise<PipelineGradingAssessment> {
  const { sessionId, reportId } = input;
  const report = db
    .select()
    .from(gradingReports)
    .where(
      and(
        eq(gradingReports.id, reportId),
        eq(gradingReports.epicId, init.epicId),
        eq(gradingReports.agentSessionId, sessionId),
      ),
    )
    .get();
  const gradings = parseGradingEntries(report?.gradings);
  if (!report || !gradings) {
    throw new Error("Grading report is missing or malformed");
  }
  return {
    reportId: report.id,
    summary: report.summary,
    gradings,
    missed: gradings.filter((entry) => entry.status === "missed"),
  };
}
