/**
 * Unified transition service — single entry point for all epic status changes.
 *
 * Centralises: context building, validation, DB update, event emission, and
 * activity logging so that every route uses the same pipeline.
 */

import { db } from "@/lib/db";
import { epics } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { KanbanStatus } from "@/lib/types/kanban";
import type { TransitionContext } from "./engine";
import { validateTransition } from "./engine";
import { buildTransitionContext } from "./context";
import { emitTicketMoved } from "@/lib/events/emit";
import { logTransition } from "./log";

export interface ApplyTransitionOpts {
  projectId: string;
  epicId: string;
  fromStatus: KanbanStatus;
  toStatus: KanbanStatus;
  actor: TransitionContext["actor"];
  source: NonNullable<TransitionContext["source"]>;
  reason?: string;
  sessionId?: string;
  /** When true, skip the DB update (caller handles it, e.g. reorder route). */
  skipDbUpdate?: boolean;
  /** When true, only validate — skip DB update, emit, and log. */
  validateOnly?: boolean;
  /**
   * When true, validate as if every open review comment were already
   * resolved. For the approve flow's pre-merge check: approval bulk-resolves
   * comments and closes the ticket in one action, but must validate BEFORE
   * writing anything — the comment resolution included.
   */
  assumeReviewCommentsResolved?: boolean;
}

export interface ApplyTransitionResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate and apply an epic status transition.
 *
 * 1. Builds transition context from DB state.
 * 2. Validates via the workflow engine.
 * 3. Updates the epic row (unless `skipDbUpdate` is set).
 * 4. Emits a `ticket:moved` SSE event.
 * 5. Logs the transition to the activity log.
 */
export function applyTransition(opts: ApplyTransitionOpts): ApplyTransitionResult {
  const {
    projectId,
    epicId,
    fromStatus,
    toStatus,
    actor,
    source,
    reason,
    sessionId,
    skipDbUpdate,
    validateOnly,
    assumeReviewCommentsResolved,
  } = opts;

  // Same-status is a no-op (reorder within column)
  if (fromStatus === toStatus) {
    return { valid: true };
  }

  // 1. Build context & validate
  const ctx = buildTransitionContext({ epicId, fromStatus, toStatus, actor });
  ctx.source = source;
  if (assumeReviewCommentsResolved) {
    ctx.hasOpenReviewComments = false;
  }
  const result = validateTransition(ctx);
  if (!result.valid) {
    return { valid: false, error: result.error };
  }

  // In validate-only mode, stop after validation
  if (validateOnly) {
    return { valid: true };
  }

  // 2. DB update
  if (!skipDbUpdate) {
    db.update(epics)
      .set({ status: toStatus, updatedAt: new Date().toISOString() })
      .where(eq(epics.id, epicId))
      .run();
  }

  // 3. Emit SSE event
  emitTicketMoved(projectId, epicId, fromStatus, toStatus);

  // 4. Log to activity log
  logTransition({
    projectId,
    epicId,
    fromStatus,
    toStatus,
    actor,
    reason,
    sessionId,
  });

  return { valid: true };
}
