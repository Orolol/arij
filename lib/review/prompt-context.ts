import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { reviewComments, agentSessions } from "@/lib/db/schema";
import { buildPriorFindingsSection } from "./prompt-feedback";
import { ORDINARY_REVIEW_AGENT_TYPES } from "./agent-types";
import { assessEpicVerification } from "@/lib/verify/freshness";
import { buildDeterministicVerificationReviewSection } from "@/lib/claude/prompt-builder";
export function manualReviewEvidence(projectId: string, epicId: string): string {
  const comments = db.select().from(reviewComments).where(and(eq(reviewComments.epicId, epicId), inArray(reviewComments.status, ["open", "dismissed"]))).orderBy(reviewComments.createdAt).all();
  const reviews = db.select({ id: agentSessions.id }).from(agentSessions).where(and(eq(agentSessions.projectId, projectId), eq(agentSessions.epicId, epicId), eq(agentSessions.status, "completed"), inArray(agentSessions.agentType, [...ORDINARY_REVIEW_AGENT_TYPES]))).all();
  const verification = assessEpicVerification(projectId, epicId);
  return [buildPriorFindingsSection(comments, reviews.length + 1), verification.report && verification.problem?.kind !== "stale" ? buildDeterministicVerificationReviewSection(verification.report.commands) : ""].filter(Boolean).join("\n\n");
}
