import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gradingReports } from "@/lib/db/schema";
import { dispatchGradingSession } from "@/lib/grading/dispatch";
import { parseGradingEntries } from "@/lib/grading/report";
import type { PipelineGradingAssessment, PipelineStageHandle } from "./runner";
import type { PipelineStageDriverInit } from "./stage-driver-init";

/**
 * Grading stage of the pipeline (opt-in acceptance grading): the dispatch
 * adapter over the reusable grader, and the read-back of the exact report
 * the grader filed.
 */

/** Adapts the reusable grader dispatcher to the pipeline stage contract. */
export async function dispatchPipelineGradingStage(
  init: PipelineStageDriverInit,
): Promise<PipelineStageHandle> {
  const result = await dispatchGradingSession({
    projectId: init.projectId,
    epicId: init.epicId,
    userStoryId: init.scope === "story" ? init.userStoryId : null,
    batchRunId: init.batchRunId ?? null,
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
      escalatedToProvider: null,
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
    escalatedToProvider: null,
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
