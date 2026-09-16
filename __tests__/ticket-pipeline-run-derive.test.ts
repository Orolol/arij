/**
 * The PIPELINE card reads the registry (audit 2026-09-10, lot 05, #72).
 *
 * Pure half: which run belongs to the open ticket, what the card says about
 * it, and where the chain's live marker sits while a run is active. Without a
 * run, the chain keeps its column derivation — pinned by
 * `ticket-overlay-derive.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { pipelineRunLine, pipelineRunStage, pipelineSteps } from "@/components/ticket/derive";
import { latestTicketRun } from "@/hooks/usePipelineRuns";
import type { PipelineRunSnapshot } from "@/lib/pipeline/constants";

function run(overrides: Partial<PipelineRunSnapshot> = {}): PipelineRunSnapshot {
  return {
    runId: "run-1",
    projectId: "proj-1",
    epicId: "epic-1",
    userStoryId: null,
    state: "running_review",
    stage: "review",
    stageAttempt: 2,
    fixCycles: 1,
    stageMaxAttempts: 3,
    maxFixCycles: 2,
    sessionIds: ["s-build", "s-review"],
    startedAt: "2026-09-16T10:00:00.000Z",
    endedAt: null,
    reason: null,
    ...overrides,
  };
}

describe("latestTicketRun", () => {
  it("picks the ticket's first listed run (active before recent, newest first)", () => {
    const runs = [
      run({ runId: "other", epicId: "epic-2" }),
      run({ runId: "active" }),
      run({ runId: "old", state: "failed" }),
    ];
    expect(latestTicketRun(runs, "epic-1")?.runId).toBe("active");
  });

  // A story build (stories/[storyId]/build) registers under its parent's
  // epicId. It must not pass for the ticket's own run.
  it("prefers the ticket's own active run over a story run of the same ticket", () => {
    const runs = [
      run({ runId: "story", userStoryId: "story-1", stage: "build", state: "running_build" }),
      run({ runId: "ticket" }),
    ];
    expect(latestTicketRun(runs, "epic-1")?.runId).toBe("ticket");
  });

  it("prefers the ticket's own finished run over a finished story run", () => {
    const runs = [
      run({ runId: "story-failed", userStoryId: "story-1", state: "failed" }),
      run({ runId: "ticket-done", state: "succeeded" }),
    ];
    expect(latestTicketRun(runs, "epic-1")?.runId).toBe("ticket-done");
  });

  it("still shows a live story run over a finished ticket run", () => {
    const runs = [
      run({ runId: "story-live", userStoryId: "story-1", state: "running_build", stage: "build" }),
      run({ runId: "ticket-old", state: "failed" }),
    ];
    expect(latestTicketRun(runs, "epic-1")?.runId).toBe("story-live");
  });

  it("is null without a run for the ticket, or without a ticket", () => {
    expect(latestTicketRun([run({ epicId: "epic-2" })], "epic-1")).toBeNull();
    expect(latestTicketRun([run()], null)).toBeNull();
    expect(latestTicketRun(null, "epic-1")).toBeNull();
  });
});

describe("pipelineRunLine", () => {
  it("describes an active run: stage, attempt n/max, fix cycle n/max", () => {
    expect(pipelineRunLine(run())).toEqual({
      state: "running",
      stage: "review",
      attempt: { count: 2, max: 3 },
      fixCycles: { count: 1, max: 2 },
      reason: null,
      story: null,
      endedAt: null,
    });
  });

  it("names the story a story run builds, by title, falling back to its id", () => {
    const storyRun = run({ userStoryId: "story-abcdef123", stage: "build", state: "running_build" });
    expect(
      pipelineRunLine(storyRun, [{ id: "story-abcdef123", title: "Export CSV" }]).story,
    ).toBe("Export CSV");
    expect(pipelineRunLine(storyRun, []).story).toBe("def123");
  });

  it("prints the counters alone when the snapshot carries no caps", () => {
    const line = pipelineRunLine(
      run({ stageMaxAttempts: undefined, maxFixCycles: undefined }),
    );
    expect(line.attempt).toEqual({ count: 2, max: null });
    expect(line.fixCycles).toEqual({ count: 1, max: null });
  });

  it("drops the fix-cycle count of a report-only run that spent none", () => {
    expect(pipelineRunLine(run({ fixCycles: 0, maxFixCycles: 0 })).fixCycles).toBeNull();
  });

  it("has no attempt ladder while the forensic diagnostic runs", () => {
    const line = pipelineRunLine(
      run({ state: "running_forensic", stage: "forensic", stageAttempt: 1 }),
    );
    expect(line.state).toBe("running");
    expect(line.attempt).toBeNull();
  });

  it("gives a failed run its reason and no attempt", () => {
    const line = pipelineRunLine(
      run({
        state: "failed",
        reason: "blocking findings remain after 2 fix cycles",
        fixCycles: 2,
        endedAt: "2026-09-16T11:00:00.000Z",
      }),
    );
    expect(line).toEqual({
      state: "failed",
      stage: "review",
      attempt: null,
      fixCycles: { count: 2, max: 2 },
      reason: "blocking findings remain after 2 fix cycles",
      story: null,
      endedAt: "2026-09-16T11:00:00.000Z",
    });
  });

  it("gives a paused run its reason", () => {
    const line = pipelineRunLine(
      run({ state: "paused_question", reason: "agent asked a question (review)" }),
    );
    expect(line.state).toBe("paused_question");
    expect(line.reason).toBe("agent asked a question (review)");
  });

  it("keeps no reason on success", () => {
    const line = pipelineRunLine(run({ state: "succeeded", reason: "ignored", fixCycles: 0 }));
    expect(line.state).toBe("succeeded");
    expect(line.reason).toBeNull();
    expect(line.fixCycles).toBeNull();
  });
});

describe("pipelineRunStage", () => {
  it("is the stage of the ticket's own active run", () => {
    expect(pipelineRunStage(run())).toBe("review");
  });

  it("is null for a finished run", () => {
    expect(pipelineRunStage(run({ state: "failed" }))).toBeNull();
  });

  // A story build under a parent sitting in to_merge must not repaint the
  // parent's chain as BUILD live.
  it("is null for a story run: the story does not move the ticket's chain", () => {
    expect(
      pipelineRunStage(run({ userStoryId: "story-1", stage: "build", state: "running_build" })),
    ).toBeNull();
    expect(pipelineSteps("to_merge", false, null).map((s) => s.state)).toEqual([
      "done",
      "done",
      "done",
      "pending",
    ]);
  });
});

describe("pipelineSteps with a live run", () => {
  it("puts the live marker on the run's stage, not on the column", () => {
    // Column still says review, the registry says a fix is being built.
    expect(pipelineSteps("review", false, "fix").map((s) => s.state)).toEqual([
      "done",
      "live",
      "pending",
      "pending",
    ]);
    expect(pipelineSteps("in_progress", false, "grading").map((s) => s.state)).toEqual([
      "done",
      "done",
      "live",
      "pending",
    ]);
  });

  it("falls back to the column while a forensic diagnostic runs", () => {
    expect(pipelineSteps("in_progress", true, "forensic")).toEqual(
      pipelineSteps("in_progress", false),
    );
  });
});
