/**
 * Tests for GET /api/projects/[projectId]/pipeline/runs: { data } payload
 * from the registry singleton (active + recent ring), project 404.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockNextRequest, mockRouteContext } from "@/__tests__/helpers/db-mock";

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

import { dbMockState, resetDbMockState } from "@/__tests__/helpers/db-mock";
import { pipelineRegistry } from "@/lib/pipeline/registry";
import { GET } from "@/app/api/projects/[projectId]/pipeline/runs/route";

let counter = 0;

function registerRun(projectId: string, runId: string) {
  pipelineRegistry.register({
    runId,
    projectId,
    epicId: "epic-1",
    userStoryId: null,
    state: "running_review",
    stage: "review",
    stageAttempt: 1,
    fixCycles: 0,
    sessionIds: ["s-build", "s-review"],
    startedAt: "2026-08-17T10:00:00.000Z",
    endedAt: null,
    reason: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbMockState();
});

describe("GET /api/projects/[projectId]/pipeline/runs", () => {
  it("returns { data: PipelineRunSnapshot[] } with active and recent runs", async () => {
    counter += 1;
    const projectId = `proj-runs-${counter}`;
    dbMockState.getQueue.push({ id: projectId, name: "P" });

    registerRun(projectId, `run-active-${counter}`);
    registerRun(projectId, `run-done-${counter}`);
    pipelineRegistry.finish(`run-done-${counter}`, "succeeded", null);

    const res = await GET(
      mockNextRequest(),
      mockRouteContext({ projectId })
    );
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.map((r: { runId: string }) => r.runId)).toEqual([
      `run-active-${counter}`,
      `run-done-${counter}`,
    ]);
    expect(json.data[0]).toMatchObject({
      projectId,
      state: "running_review",
      stage: "review",
      sessionIds: ["s-build", "s-review"],
    });
    expect(json.data[1]).toMatchObject({ state: "succeeded" });
  });

  it("404s for an unknown project", async () => {
    // Empty getQueue → project lookup returns null.
    const res = await GET(
      mockNextRequest(),
      mockRouteContext({ projectId: "missing" })
    );
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Project not found");
  });

  it("returns an empty array for a project without runs", async () => {
    counter += 1;
    const projectId = `proj-empty-${counter}`;
    dbMockState.getQueue.push({ id: projectId, name: "P" });

    const res = await GET(
      mockNextRequest(),
      mockRouteContext({ projectId })
    );
    const json = await res.json();
    expect(json.data).toEqual([]);
  });
});
