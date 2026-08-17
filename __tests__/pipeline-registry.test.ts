/**
 * Tests for the in-memory pipeline run registry
 * (lib/pipeline/registry.ts): register/update/recordSession/finish
 * lifecycle, the per-project recent ring (cap 20), listing order, and
 * defensive copying.
 */
import { describe, it, expect } from "vitest";

import {
  PipelineRegistry,
  PIPELINE_RECENT_RUNS_LIMIT,
} from "@/lib/pipeline/registry";
import type { PipelineRunSnapshot } from "@/lib/pipeline/constants";

function makeRun(
  runId: string,
  projectId = "proj-1",
  overrides: Partial<PipelineRunSnapshot> = {}
): PipelineRunSnapshot {
  return {
    runId,
    projectId,
    epicId: "epic-1",
    userStoryId: null,
    state: "running_build",
    stage: "build",
    stageAttempt: 1,
    fixCycles: 0,
    sessionIds: ["s-build"],
    startedAt: "2026-08-17T10:00:00.000Z",
    endedAt: null,
    reason: null,
    ...overrides,
  };
}

describe("PipelineRegistry", () => {
  it("registers, updates, and records sessions on an active run", () => {
    const registry = new PipelineRegistry();
    registry.register(makeRun("run-1"));

    registry.update("run-1", {
      state: "running_review",
      stage: "review",
      stageAttempt: 1,
    });
    registry.recordSession("run-1", "s-review");
    registry.recordSession("run-1", "s-review"); // idempotent

    expect(registry.get("run-1")).toMatchObject({
      state: "running_review",
      stage: "review",
      sessionIds: ["s-build", "s-review"],
      endedAt: null,
    });
    expect(registry.listByProject("proj-1")).toHaveLength(1);
  });

  it("finish moves the run into the project's recent ring with terminal fields", () => {
    const registry = new PipelineRegistry();
    registry.register(makeRun("run-1"));
    registry.finish("run-1", "failed", "session cap reached", "2026-08-17T11:00:00.000Z");

    // Still listed (recent ring), still gettable, but terminal.
    const listed = registry.listByProject("proj-1");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      runId: "run-1",
      state: "failed",
      reason: "session cap reached",
      endedAt: "2026-08-17T11:00:00.000Z",
    });

    // Post-terminal mutations are no-ops.
    registry.update("run-1", { state: "running_fix" });
    registry.recordSession("run-1", "s-late");
    expect(registry.get("run-1")).toMatchObject({
      state: "failed",
      sessionIds: ["s-build"],
    });
  });

  it("lists active runs (newest first) before recent terminal runs", () => {
    const registry = new PipelineRegistry();
    registry.register(makeRun("run-old"));
    registry.finish("run-old", "succeeded", null);
    registry.register(makeRun("run-a"));
    registry.register(makeRun("run-b"));

    expect(registry.listByProject("proj-1").map((r) => r.runId)).toEqual([
      "run-b",
      "run-a",
      "run-old",
    ]);
  });

  it("keeps runs of different projects apart", () => {
    const registry = new PipelineRegistry();
    registry.register(makeRun("run-1", "proj-1"));
    registry.register(makeRun("run-2", "proj-2"));
    registry.finish("run-2", "succeeded", null);

    expect(registry.listByProject("proj-1").map((r) => r.runId)).toEqual([
      "run-1",
    ]);
    expect(registry.listByProject("proj-2").map((r) => r.runId)).toEqual([
      "run-2",
    ]);
  });

  it(`caps the recent ring at ${PIPELINE_RECENT_RUNS_LIMIT} snapshots, newest first`, () => {
    const registry = new PipelineRegistry();
    for (let i = 1; i <= PIPELINE_RECENT_RUNS_LIMIT + 5; i++) {
      registry.register(makeRun(`run-${i}`));
      registry.finish(`run-${i}`, "succeeded", null);
    }

    const listed = registry.listByProject("proj-1");
    expect(listed).toHaveLength(PIPELINE_RECENT_RUNS_LIMIT);
    expect(listed[0].runId).toBe(`run-${PIPELINE_RECENT_RUNS_LIMIT + 5}`);
    // The oldest snapshots fell off the ring.
    expect(listed.map((r) => r.runId)).not.toContain("run-1");
    expect(registry.get("run-1")).toBeNull();
  });

  it("returns defensive copies (callers cannot mutate registry state)", () => {
    const registry = new PipelineRegistry();
    registry.register(makeRun("run-1"));

    const snapshot = registry.get("run-1")!;
    snapshot.state = "failed";
    snapshot.sessionIds.push("s-injected");

    expect(registry.get("run-1")).toMatchObject({
      state: "running_build",
      sessionIds: ["s-build"],
    });

    const listed = registry.listByProject("proj-1");
    listed[0].sessionIds.push("s-other");
    expect(registry.get("run-1")!.sessionIds).toEqual(["s-build"]);
  });

  it("get/finish on unknown runs are safe no-ops", () => {
    const registry = new PipelineRegistry();
    expect(registry.get("nope")).toBeNull();
    registry.finish("nope", "failed", "whatever");
    expect(registry.listByProject("proj-1")).toEqual([]);
  });
});
