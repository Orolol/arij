/**
 * Builds TransitionContext from database state for workflow validation.
 */

import { db } from "@/lib/db";
import { agentSessions, reviewComments } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import type { KanbanStatus } from "@/lib/types/kanban";
import type { TransitionContext } from "./engine";

export function buildTransitionContext(opts: {
  epicId: string;
  fromStatus: KanbanStatus;
  toStatus: KanbanStatus;
  actor: "user" | "agent" | "system";
}): TransitionContext {
  const { epicId, fromStatus, toStatus, actor } = opts;

  // Check for open review comments
  const openComments = db
    .select()
    .from(reviewComments)
    .where(
      and(
        eq(reviewComments.epicId, epicId),
        eq(reviewComments.status, "open")
      )
    )
    .all();

  // Check for completed review sessions
  const completedReviewSessions = db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.epicId, epicId),
        eq(agentSessions.status, "completed")
      )
    )
    .all()
    .filter((s) => {
      const agentType = s.agentType ?? "";
      return (
        agentType.includes("review") ||
        agentType === "security_reviewer" ||
        agentType === "code_reviewer" ||
        agentType === "compliance_reviewer" ||
        agentType === "feature_reviewer"
      );
    });

  // Check for running agent sessions
  const runningSessions = db
    .select()
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.epicId, epicId),
        eq(agentSessions.status, "running")
      )
    )
    .all();

  return {
    epicId,
    fromStatus,
    toStatus,
    hasOpenReviewComments: openComments.length > 0,
    hasCompletedReview: completedReviewSessions.length > 0,
    hasRunningSession: runningSessions.length > 0,
    actor,
  };
}
