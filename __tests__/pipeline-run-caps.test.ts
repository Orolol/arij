/**
 * The registry snapshot carries the run's CAPS, not only its counters
 * (audit 2026-09-10, lot 05, #72).
 *
 * The ticket overlay says "attempt 2/3 · fix cycle 1/2". The counters were
 * already in the snapshot; the denominators were not, and they cannot be
 * re-derived by the reader: a composite agent's attempt budget is its member
 * count, sized by the runner at stage entry, not the `pipeline_max_attempts`
 * setting. So the runner reports the budget it sized, and the registry keeps it.
 */
import { describe, expect, it, vi } from "vitest";

import { PipelineRegistry, stageChangePatch } from "@/lib/pipeline/registry";
import {
  createPipelineRunContext,
  sizeStageBudget,
} from "@/lib/pipeline/runner-context";
import type { RunPipelineOptions } from "@/lib/pipeline/runner";

function options(overrides: Partial<RunPipelineOptions> = {}): RunPipelineOptions {
  return {
    maxAttempts: 2,
    maxFixCycles: 2,
    maxSessions: 12,
    initialBuild: {
      sessionId: "s-build",
      settled: new Promise(() => {}),
    },
    ...overrides,
  } as RunPipelineOptions;
}

describe("sizeStageBudget reports the sized budget", () => {
  it("hands a composite's member count to onStageBudget", async () => {
    const onStageBudget = vi.fn();
    const ctx = createPipelineRunContext(
      options({ attemptBudget: () => 3, callbacks: { onStageBudget } }),
    );

    await sizeStageBudget(ctx, "build");

    expect(ctx.state.stageMaxAttempts).toBe(3);
    expect(onStageBudget).toHaveBeenCalledWith("build", 3);
  });

  it("reports the configured cap when the budget cannot be read", async () => {
    const onStageBudget = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = createPipelineRunContext(
      options({
        attemptBudget: () => {
          throw new Error("composite gone");
        },
        callbacks: { onStageBudget },
      }),
    );

    await sizeStageBudget(ctx, "review");

    expect(onStageBudget).toHaveBeenCalledWith("review", 2);
    warn.mockRestore();
  });

  it("reports the configured cap for a simple agent", async () => {
    const onStageBudget = vi.fn();
    const ctx = createPipelineRunContext(options({ callbacks: { onStageBudget } }));

    await sizeStageBudget(ctx, "fix");

    expect(onStageBudget).toHaveBeenCalledWith("fix", 2);
  });
});

describe("PipelineRegistry caps", () => {
  it("stores the stage budget and fix-cycle cap through update", () => {
    const registry = new PipelineRegistry();
    registry.register({
      runId: "run-1",
      projectId: "proj-1",
      epicId: "epic-1",
      userStoryId: null,
      state: "running_build",
      stage: "build",
      stageAttempt: 1,
      fixCycles: 0,
      stageMaxAttempts: 2,
      maxFixCycles: 2,
      sessionIds: ["s-build"],
      startedAt: "2026-09-16T10:00:00.000Z",
      endedAt: null,
      reason: null,
    });

    registry.update("run-1", { stageMaxAttempts: 4 });

    expect(registry.get("run-1")).toMatchObject({
      stageMaxAttempts: 4,
      maxFixCycles: 2,
    });
  });
});

// The ladder exhausted, the runner enters running_forensic WITHOUT sizing a
// budget: the failed stage's cap would otherwise stay on the snapshot and read
// as "forensic, attempt 1 of <that stage's budget>" to any registry reader.
describe("stageChangePatch", () => {
  it("clears the attempt cap when the run enters the forensic diagnostic", () => {
    const registry = new PipelineRegistry();
    registry.register({
      runId: "run-f",
      projectId: "proj-1",
      epicId: "epic-1",
      userStoryId: null,
      state: "running_build",
      stage: "build",
      stageAttempt: 3,
      fixCycles: 0,
      stageMaxAttempts: 3,
      maxFixCycles: 2,
      sessionIds: ["s-build"],
      startedAt: "2026-09-16T10:00:00.000Z",
      endedAt: null,
      reason: null,
    });

    registry.update("run-f", stageChangePatch("running_forensic", "forensic", 1, 0));

    const run = registry.get("run-f");
    expect(run).toMatchObject({ state: "running_forensic", stage: "forensic", stageAttempt: 1 });
    expect(run?.stageMaxAttempts).toBeUndefined();
    expect(JSON.parse(JSON.stringify(run))).not.toHaveProperty("stageMaxAttempts");
    expect(run?.maxFixCycles).toBe(2);
  });

  it("leaves the cap to onStageBudget for every other stage", () => {
    expect(stageChangePatch("running_review", "review", 2, 1)).toEqual({
      state: "running_review",
      stage: "review",
      stageAttempt: 2,
      fixCycles: 1,
    });
  });
});
