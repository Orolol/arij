import { describe, it, expect } from "vitest";
import {
  isAllowedTransition,
  validateTransition,
  getAllowedTargets,
  type TransitionContext,
} from "@/lib/workflow/engine";
import type { KanbanStatus } from "@/lib/types/kanban";

// ---------------------------------------------------------------------------
// Helper to create a minimal TransitionContext
// ---------------------------------------------------------------------------

function ctx(
  from: KanbanStatus,
  to: KanbanStatus,
  overrides: Partial<TransitionContext> = {}
): TransitionContext {
  return {
    epicId: "epic-1",
    fromStatus: from,
    toStatus: to,
    hasOpenReviewComments: false,
    hasCompletedReview: false,
    hasRunningSession: false,
    actor: "user",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Structural transitions (isAllowedTransition)
// ---------------------------------------------------------------------------

describe("isAllowedTransition", () => {
  it("allows backlog -> todo", () => {
    expect(isAllowedTransition("backlog", "todo")).toBe(true);
  });

  it("allows backlog -> in_progress", () => {
    expect(isAllowedTransition("backlog", "in_progress")).toBe(true);
  });

  it("allows todo -> in_progress", () => {
    expect(isAllowedTransition("todo", "in_progress")).toBe(true);
  });

  it("allows in_progress -> review", () => {
    expect(isAllowedTransition("in_progress", "review")).toBe(true);
  });

  it("allows review -> done", () => {
    expect(isAllowedTransition("review", "done")).toBe(true);
  });

  it("allows review -> in_progress (send back)", () => {
    expect(isAllowedTransition("review", "in_progress")).toBe(true);
  });

  it("allows done -> review (reopen)", () => {
    expect(isAllowedTransition("done", "review")).toBe(true);
  });

  it("allows done -> in_progress (reopen)", () => {
    expect(isAllowedTransition("done", "in_progress")).toBe(true);
  });

  it("rejects backlog -> done (skip)", () => {
    expect(isAllowedTransition("backlog", "done")).toBe(false);
  });

  it("rejects backlog -> review (skip)", () => {
    expect(isAllowedTransition("backlog", "review")).toBe(false);
  });

  it("rejects todo -> done (skip)", () => {
    expect(isAllowedTransition("todo", "done")).toBe(false);
  });

  it("rejects todo -> review (skip)", () => {
    expect(isAllowedTransition("todo", "review")).toBe(false);
  });

  it("rejects in_progress -> done (skip review)", () => {
    expect(isAllowedTransition("in_progress", "done")).toBe(false);
  });

  it("same status is always valid", () => {
    expect(isAllowedTransition("backlog", "backlog")).toBe(true);
    expect(isAllowedTransition("done", "done")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Guard: cannot move to Done without completed review
// ---------------------------------------------------------------------------

describe("validateTransition — Done requires completed review", () => {
  it("rejects review -> done without completed review", () => {
    const result = validateTransition(
      ctx("review", "done", { hasCompletedReview: false })
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("no completed review");
  });

  it("allows review -> done with completed review, no open comments, via approve", () => {
    const result = validateTransition(
      ctx("review", "done", { hasCompletedReview: true, source: "approve" })
    );
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Guard: cannot move to Done with unresolved review comments
// ---------------------------------------------------------------------------

describe("validateTransition — Done requires resolved comments", () => {
  it("rejects review -> done with open review comments", () => {
    const result = validateTransition(
      ctx("review", "done", {
        hasCompletedReview: true,
        hasOpenReviewComments: true,
      })
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("unresolved review comments");
  });

  it("allows review -> done when all comments resolved via approve", () => {
    const result = validateTransition(
      ctx("review", "done", {
        hasCompletedReview: true,
        hasOpenReviewComments: false,
        source: "approve",
      })
    );
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Guard: review → done requires approve or merge source
// ---------------------------------------------------------------------------

describe("validateTransition — review to done requires approval", () => {
  it("rejects review -> done via drag (no approval)", () => {
    const result = validateTransition(
      ctx("review", "done", {
        hasCompletedReview: true,
        source: "drag",
      })
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("manual approval is required");
  });

  it("rejects review -> done via API (no approval)", () => {
    const result = validateTransition(
      ctx("review", "done", {
        hasCompletedReview: true,
        source: "api",
      })
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("manual approval is required");
  });

  it("rejects review -> done without source (no approval)", () => {
    const result = validateTransition(
      ctx("review", "done", {
        hasCompletedReview: true,
      })
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("manual approval is required");
  });

  it("allows review -> done via approve source", () => {
    const result = validateTransition(
      ctx("review", "done", {
        hasCompletedReview: true,
        source: "approve",
      })
    );
    expect(result.valid).toBe(true);
  });

  it("allows review -> done via merge source", () => {
    const result = validateTransition(
      ctx("review", "done", {
        hasCompletedReview: true,
        source: "merge",
      })
    );
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Same-column reorder is always valid
// ---------------------------------------------------------------------------

describe("validateTransition — same status reorder", () => {
  it("allows reorder within the same column", () => {
    const result = validateTransition(ctx("in_progress", "in_progress"));
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Invalid structural transitions produce clear error
// ---------------------------------------------------------------------------

describe("validateTransition — invalid structure", () => {
  it("rejects backlog -> done with descriptive error", () => {
    const result = validateTransition(ctx("backlog", "done"));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid transition");
    expect(result.error).toContain("backlog");
    expect(result.error).toContain("done");
  });

  it("rejects in_progress -> done with descriptive error", () => {
    const result = validateTransition(ctx("in_progress", "done"));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid transition");
  });
});

// ---------------------------------------------------------------------------
// Both UI and API transitions use the same validation
// ---------------------------------------------------------------------------

describe("validateTransition — actor types", () => {
  it("applies same rules for user actor", () => {
    const result = validateTransition(
      ctx("review", "done", { actor: "user", hasCompletedReview: false })
    );
    expect(result.valid).toBe(false);
  });

  it("applies same rules for agent actor", () => {
    const result = validateTransition(
      ctx("review", "done", { actor: "agent", hasCompletedReview: false })
    );
    expect(result.valid).toBe(false);
  });

  it("applies same rules for system actor", () => {
    const result = validateTransition(
      ctx("review", "done", { actor: "system", hasCompletedReview: false })
    );
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAllowedTargets
// ---------------------------------------------------------------------------

describe("getAllowedTargets", () => {
  it("returns valid targets for backlog", () => {
    expect(getAllowedTargets("backlog")).toEqual(["todo", "in_progress"]);
  });

  it("returns valid targets for review", () => {
    expect(getAllowedTargets("review")).toEqual(["in_progress", "done"]);
  });

  it("returns valid targets for done", () => {
    expect(getAllowedTargets("done")).toEqual(["review", "in_progress"]);
  });
});
