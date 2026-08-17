/**
 * Tests for the in-process DAG batch registry and its read endpoint
 * (GET /api/projects/[projectId]/build/waves).
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  DagBatchRegistry,
  dagBatchRegistry,
} from "@/lib/agents/dag-batch-registry";
import { GET } from "@/app/api/projects/[projectId]/build/waves/route";
import { mockNextRequest, mockRouteContext } from "@/__tests__/helpers/db-mock";

describe("DagBatchRegistry", () => {
  it("tracks a batch through start -> setWave/setCounts -> finish", () => {
    const registry = new DagBatchRegistry();

    const snapshot = registry.start({
      batchId: "batch-1",
      projectId: "proj-1",
      failurePolicy: "halt",
      totalWaves: 3,
      totalEpics: 5,
    });

    expect(snapshot.currentWave).toBe(0);
    expect(snapshot.counts.pending).toBe(5);
    expect(registry.get("batch-1")?.totalWaves).toBe(3);

    registry.setWave("batch-1", 2);
    registry.setCounts("batch-1", {
      pending: 2,
      running: 1,
      done: 2,
      asked: 0,
      failed: 0,
      skipped: 0,
    });

    const updated = registry.get("batch-1")!;
    expect(updated.currentWave).toBe(2);
    expect(updated.counts.done).toBe(2);

    registry.finish("batch-1");
    expect(registry.get("batch-1")).toBeNull();
  });

  it("lists only the requested project's batches", () => {
    const registry = new DagBatchRegistry();
    registry.start({
      batchId: "b1",
      projectId: "proj-1",
      failurePolicy: "halt",
      totalWaves: 2,
      totalEpics: 2,
    });
    registry.start({
      batchId: "b2",
      projectId: "proj-2",
      failurePolicy: "stop",
      totalWaves: 1,
      totalEpics: 1,
    });

    expect(registry.listByProject("proj-1").map((b) => b.batchId)).toEqual([
      "b1",
    ]);
    expect(registry.listByProject("proj-3")).toEqual([]);
  });

  it("updates on unknown batch ids are no-ops", () => {
    const registry = new DagBatchRegistry();
    expect(() => {
      registry.setWave("nope", 2);
      registry.setCounts("nope", {
        pending: 0,
        running: 0,
        done: 0,
        asked: 0,
        failed: 0,
        skipped: 0,
      });
      registry.finish("nope");
    }).not.toThrow();
  });
});

describe("GET /api/projects/[projectId]/build/waves", () => {
  afterEach(() => {
    // The route reads the singleton — clean up whatever a test registered.
    for (const batch of dagBatchRegistry.listByProject("proj-waves")) {
      dagBatchRegistry.finish(batch.batchId);
    }
  });

  it("returns the singleton registry's snapshots for the project", async () => {
    dagBatchRegistry.start({
      batchId: "batch-live",
      projectId: "proj-waves",
      failurePolicy: "halt",
      totalWaves: 4,
      totalEpics: 6,
    });
    dagBatchRegistry.setWave("batch-live", 2);

    const res = await GET(
      mockNextRequest(),
      mockRouteContext({ projectId: "proj-waves" })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0]).toMatchObject({
      batchId: "batch-live",
      currentWave: 2,
      totalWaves: 4,
    });
  });

  it("returns an empty list when no batch is running", async () => {
    const res = await GET(
      mockNextRequest(),
      mockRouteContext({ projectId: "proj-waves" })
    );
    const json = await res.json();
    expect(json.data).toEqual([]);
  });
});
