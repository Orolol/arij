/**
 * Workflow Rule Engine — State machine for epic/ticket transitions.
 *
 * Enforces valid transitions for both manual (UI drag-and-drop, API)
 * and programmatic (agent-triggered) status changes.
 */

import type { KanbanStatus } from "@/lib/types/kanban";

// ---------------------------------------------------------------------------
// Transition definitions
// ---------------------------------------------------------------------------

/**
 * Allowed status transitions for epics.
 * Key = current status, Value = set of statuses it can move to.
 */
const EPIC_TRANSITIONS: Record<KanbanStatus, readonly KanbanStatus[]> = {
  backlog: ["todo", "in_progress"],
  todo: ["backlog", "in_progress"],
  in_progress: ["todo", "review", "backlog"],
  review: ["in_progress", "done"],
  done: ["review", "in_progress"],
};

/**
 * Conditions that must be met for specific transitions.
 * Returns null if valid, or an error message string if invalid.
 */
type TransitionGuard = (ctx: TransitionContext) => string | null;

export interface TransitionContext {
  epicId: string;
  fromStatus: KanbanStatus;
  toStatus: KanbanStatus;
  /** Whether all open review comments have been resolved */
  hasOpenReviewComments: boolean;
  /** Whether the epic has a completed review (at least one review session completed) */
  hasCompletedReview: boolean;
  /** Whether there's a running agent session on this epic */
  hasRunningSession: boolean;
  /** The actor initiating the transition */
  actor: "user" | "agent" | "system";
}

const TRANSITION_GUARDS: TransitionGuard[] = [
  // Cannot move to Done without completed review
  (ctx) => {
    if (ctx.toStatus === "done" && !ctx.hasCompletedReview) {
      return "Cannot move to Done: no completed review found. A review must be completed before marking as Done.";
    }
    return null;
  },
  // Cannot move to Done with open review comments
  (ctx) => {
    if (ctx.toStatus === "done" && ctx.hasOpenReviewComments) {
      return "Cannot move to Done: there are unresolved review comments. Resolve all review comments first.";
    }
    return null;
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TransitionValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Check whether a status transition is structurally allowed
 * (i.e. the edge exists in the state machine graph).
 */
export function isAllowedTransition(
  from: KanbanStatus,
  to: KanbanStatus
): boolean {
  if (from === to) return true; // same-column reorder is always valid
  const allowed = EPIC_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Full validation: checks both structural validity and guard conditions.
 */
export function validateTransition(
  ctx: TransitionContext
): TransitionValidationResult {
  // Same status is always valid (reorder within column)
  if (ctx.fromStatus === ctx.toStatus) {
    return { valid: true };
  }

  // Check structural validity
  if (!isAllowedTransition(ctx.fromStatus, ctx.toStatus)) {
    return {
      valid: false,
      error: `Invalid transition: cannot move from "${ctx.fromStatus}" to "${ctx.toStatus}". Allowed targets: ${EPIC_TRANSITIONS[ctx.fromStatus]?.join(", ") || "none"}.`,
    };
  }

  // Run guard conditions
  for (const guard of TRANSITION_GUARDS) {
    const error = guard(ctx);
    if (error) {
      return { valid: false, error };
    }
  }

  return { valid: true };
}

/**
 * Get the list of statuses an epic can transition to from a given status.
 */
export function getAllowedTargets(from: KanbanStatus): readonly KanbanStatus[] {
  return EPIC_TRANSITIONS[from] ?? [];
}
