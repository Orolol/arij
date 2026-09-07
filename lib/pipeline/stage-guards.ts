import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { epics, userStories } from "@/lib/db/schema";
import { getRunningSessionForTarget } from "@/lib/agents/concurrency";
import type { PipelineGuardCheck } from "./runner";
import type { PipelineStageDriverInit } from "./stage-driver-init";

/**
 * Guard probe run before every stage dispatch:
 *   (b) an active session on the run's target that this run did not create
 *       means another agent took the ticket;
 *   (c) the review-target status (epic for epic runs, story for story runs —
 *       mirroring the respective review routes' guards) must still be
 *       review|done for a review stage.
 */
export function checkPipelineGuards(
  init: PipelineStageDriverInit,
  ownSessionIds: string[]
): PipelineGuardCheck {
  const conflict = getRunningSessionForTarget(
    init.scope === "epic"
      ? { scope: "epic", projectId: init.projectId, epicId: init.epicId }
      : {
          scope: "story",
          projectId: init.projectId,
          storyId: init.userStoryId ?? "",
          epicId: init.epicId,
        }
  );
  const own = new Set(ownSessionIds);
  const conflictSessionId =
    conflict && !own.has(conflict.id) ? conflict.id : null;

  const reviewTargetStatus =
    init.scope === "story" && init.userStoryId
      ? db
          .select({ status: userStories.status })
          .from(userStories)
          .where(eq(userStories.id, init.userStoryId))
          .get()?.status ?? null
      : db
          .select({ status: epics.status })
          .from(epics)
          .where(eq(epics.id, init.epicId))
          .get()?.status ?? null;

  return { conflictSessionId, reviewTargetStatus };
}
