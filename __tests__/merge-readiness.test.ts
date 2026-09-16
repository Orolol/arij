/**
 * The shared "ready to merge" predicate (lib/kanban/merge-readiness.ts).
 *
 * Pure by design, so these tests are the specification: they pin the blocker
 * precedence the To Merge cards render, the timestamp normalisation that makes
 * ISO and SQLite stamps comparable, and the To Merge ordering the board
 * relies on to keep its two sections contiguous.
 */
import { describe, it, expect } from "vitest";
import {
  describeMergeBlocker,
  evaluateMergeReadiness,
  hasCurrentConflictMarkers,
  hasCurrentMergeConflict,
  hasFreshCleanReview,
  type MergeReadinessFacts,
} from "@/lib/kanban/merge-readiness";

const READY: MergeReadinessFacts = {
  status: "to_merge",
  branchName: "feature/epic-1",
  openFindings: 0,
  lastCleanReviewAt: "2026-08-20T12:00:00.000Z",
  lastTerminalCodeAt: "2026-08-20T11:00:00.000Z",
};

describe("evaluateMergeReadiness", () => {
  it("clears a To Merge epic with a branch and no live conflict", () => {
    expect(evaluateMergeReadiness(READY)).toEqual({
      ready: true,
      blocker: null,
      openFindings: 0,
    });
  });

  it("refuses anything outside the To Merge column", () => {
    for (const status of [
      "backlog",
      "todo",
      "in_progress",
      "review",
      "done",
      "released",
    ]) {
      expect(evaluateMergeReadiness({ ...READY, status })).toMatchObject({
        ready: false,
        blocker: "not_to_merge",
      });
    }
  });

  it("echoes open findings as information, never as a blocker", () => {
    // The merge IS the approval: whatever stayed open is resolved by the
    // merge itself, so the count rides along for the card to show.
    expect(evaluateMergeReadiness({ ...READY, openFindings: 2 })).toEqual({
      ready: true,
      blocker: null,
      openFindings: 2,
    });
  });

  it("ignores review freshness — the to_merge status carries the verdict", () => {
    // A review that predates the last code change used to be a blocker;
    // now the review agent's promotion to `to_merge` is the approval, and a
    // later code session earns a re-review upstream, not a blocked card.
    expect(
      evaluateMergeReadiness({
        ...READY,
        lastCleanReviewAt: "2026-08-20T11:00:00.000Z",
        lastTerminalCodeAt: "2026-08-20T12:00:00.000Z",
      })
    ).toMatchObject({ ready: true, blocker: null });
    expect(
      evaluateMergeReadiness({ ...READY, lastCleanReviewAt: null })
    ).toMatchObject({ ready: true, blocker: null });
  });

  it("refuses an epic with nothing to land", () => {
    expect(
      evaluateMergeReadiness({ ...READY, branchName: null })
    ).toMatchObject({ ready: false, blocker: "no_branch" });
  });

  it("ranks a merge conflict above every other blocker — git is the wall", () => {
    expect(
      evaluateMergeReadiness({
        ...READY,
        openFindings: 3,
        branchName: null,
        lastMergeConflictAt: "2026-08-20T13:00:00.000Z",
      })
    ).toMatchObject({ blocker: "merge_conflict", openFindings: 3 });
  });

  it("reports committed conflict markers when conflict-markers trace is present", () => {
    expect(
      evaluateMergeReadiness({
        ...READY,
        openFindings: 0,
        lastConflictMarkersAt: "2026-08-20T13:00:00.000Z",
      })
    ).toMatchObject({ ready: false, blocker: "conflict_markers" });
  });

  it("reports the NEWER trace when a conflict and markers are both current", () => {
    expect(
      evaluateMergeReadiness({
        ...READY,
        lastMergeConflictAt: "2026-08-20T13:00:00.000Z",
        lastConflictMarkersAt: "2026-08-20T14:00:00.000Z",
      })
    ).toMatchObject({ blocker: "conflict_markers" });
    expect(
      evaluateMergeReadiness({
        ...READY,
        lastMergeConflictAt: "2026-08-20T14:00:00.000Z",
        lastConflictMarkersAt: "2026-08-20T13:00:00.000Z",
      })
    ).toMatchObject({ blocker: "merge_conflict" });
  });

  it("compares SQLite timestamps against ISO ones correctly", () => {
    // Same instant, two spellings: the review is one hour AFTER the code.
    expect(
      hasFreshCleanReview({
        lastCleanReviewAt: "2026-08-20 12:00:00",
        lastTerminalCodeAt: "2026-08-20T11:00:00.000Z",
      })
    ).toBe(true);
    // Without normalisation "2026-08-20 11:00:00" > "2026-08-20T12:..." would
    // be false anyway — this is the direction that actually flips.
    expect(
      hasFreshCleanReview({
        lastCleanReviewAt: "2026-08-20T11:00:00.000Z",
        lastTerminalCodeAt: "2026-08-20 12:00:00",
      })
    ).toBe(false);
  });

  it("survives a garbage finding count rather than reporting NaN", () => {
    expect(
      evaluateMergeReadiness({
        ...READY,
        openFindings: Number.NaN as unknown as number,
      })
    ).toEqual({ ready: true, blocker: null, openFindings: 0 });
  });
});

describe("hasCurrentMergeConflict and hasCurrentConflictMarkers", () => {
  it("holds while nothing has touched the branch since the conflict", () => {
    expect(
      hasCurrentMergeConflict({
        lastMergeConflictAt: "2026-08-20T13:00:00.000Z",
        lastTerminalCodeAt: "2026-08-20T11:00:00.000Z",
      })
    ).toBe(true);
    expect(
      hasCurrentConflictMarkers({
        lastConflictMarkersAt: "2026-08-20T13:00:00.000Z",
        lastTerminalCodeAt: "2026-08-20T11:00:00.000Z",
      })
    ).toBe(true);
  });

  it("clears once a code session (e.g. the merge-fix agent) ran after it", () => {
    expect(
      hasCurrentMergeConflict({
        lastMergeConflictAt: "2026-08-20T11:00:00.000Z",
        lastTerminalCodeAt: "2026-08-20T13:00:00.000Z",
      })
    ).toBe(false);
    expect(
      hasCurrentConflictMarkers({
        lastConflictMarkersAt: "2026-08-20T11:00:00.000Z",
        lastTerminalCodeAt: "2026-08-20T13:00:00.000Z",
      })
    ).toBe(false);
  });

  it("is false when no conflict or markers ever occurred", () => {
    expect(hasCurrentMergeConflict({ lastTerminalCodeAt: null })).toBe(false);
    expect(hasCurrentConflictMarkers({ lastTerminalCodeAt: null })).toBe(false);
  });

  it("a repaired conflict makes the epic ready again", () => {
    expect(
      evaluateMergeReadiness({
        ...READY,
        lastMergeConflictAt: "2026-08-20T11:30:00.000Z",
        // The merge-fix agent rewrote the branch after the failed merge:
        // the conflict is no longer the branch's current state.
        lastTerminalCodeAt: "2026-08-20T13:00:00.000Z",
      })
    ).toMatchObject({ ready: true, blocker: null });
  });
});

describe("describeMergeBlocker", () => {
  it("says nothing for a ready epic or one outside To Merge", () => {
    expect(describeMergeBlocker({ ready: true, blocker: null, openFindings: 0 })).toBeNull();
    expect(
      describeMergeBlocker({ ready: false, blocker: "not_to_merge", openFindings: 0 })
    ).toBeNull();
    expect(describeMergeBlocker(undefined)).toBeNull();
  });

  it("says nothing about open findings — they are information, not a blocker", () => {
    expect(
      describeMergeBlocker({ ready: true, blocker: null, openFindings: 4 })
    ).toBeNull();
  });

  it("names the cause for each remaining blocker", () => {
    expect(
      describeMergeBlocker({ ready: false, blocker: "merge_conflict", openFindings: 0 })
    ).toMatch(/conflict/i);
    expect(
      describeMergeBlocker({ ready: false, blocker: "conflict_markers", openFindings: 0 })
    ).toBe("Branch contains unresolved conflict markers");
    expect(
      describeMergeBlocker({ ready: false, blocker: "no_branch", openFindings: 0 })
    ).toMatch(/branch/i);
  });
});



describe("merge gate timestamp precision", () => {
  it("clears a conflict after a fix within the same second", () => {
    expect(hasCurrentMergeConflict({
      lastMergeConflictAt: "2026-08-20T10:00:00Z",
      lastTerminalCodeAt: "2026-08-20T10:00:00.100Z",
    })).toBe(false);
  });

  it("does not treat an equal instant in another format as a newer clean review", () => {
    expect(hasFreshCleanReview({
      lastCleanReviewAt: "2026-08-20T12:00:00+02:00",
      lastTerminalCodeAt: "2026-08-20 10:00:00",
    })).toBe(false);
  });

  it("clears a rejection when a subsequently reviewed fix follows it by milliseconds", () => {
    expect(evaluateMergeReadiness({
      ...READY,
      lastNegativeVerdictReviewAt: "2026-08-20T10:00:00Z",
      supersessionAt: "2026-08-20T10:00:00.100Z",
    })).toMatchObject({ ready: true });
  });
});


it("keeps undatable negative signals blocking instead of erasing them", () => {
  expect(evaluateMergeReadiness({ ...READY, lastNegativeVerdictReviewAt: "invalid" }).blocker).toBe("changes_requested");
  expect(evaluateMergeReadiness({ ...READY, lastMergeConflictAt: "invalid" }).blocker).toBe("merge_conflict");
  expect(hasFreshCleanReview({ lastCleanReviewAt: READY.lastCleanReviewAt, lastTerminalCodeAt: "invalid" })).toBe(false);
});
