/**
 * GET /api/projects/:projectId/pipeline/runs?epicId=… (audit 2026-09-10,
 * lot 05, #72): the ticket overlay reads ONE ticket's runs, so the route
 * narrows the project list instead of shipping every run to every overlay.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockNextRequest, mockRouteContext } from "@/__tests__/helpers/db-mock";

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

import { dbMockState, resetDbMockState } from "@/__tests__/helpers/db-mock";
import { pipelineRegistry } from "@/lib/pipeline/registry";
import { GET } from "@/app/api/projects/[projectId]/pipeline/runs/route";

function register(projectId: string, runId: string, epicId: string) {
  pipelineRegistry.register({
    runId,
    projectId,
    epicId,
    userStoryId: null,
    state: "running_build",
    stage: "build",
    stageAttempt: 1,
    fixCycles: 0,
    sessionIds: [`s-${runId}`],
    startedAt: "2026-09-16T10:00:00.000Z",
    endedAt: null,
    reason: null,
  });
}

beforeEach(() => {
  resetDbMockState();
});

describe("GET pipeline/runs epic filter", () => {
  it("returns only the named ticket's runs when epicId is given", async () => {
    const projectId = "proj-epic-filter";
    dbMockState.getQueue.push({ id: projectId, name: "P" });
    register(projectId, "run-a", "epic-a");
    register(projectId, "run-b", "epic-b");

    const res = await GET(
      mockNextRequest({ searchParams: { epicId: "epic-b" } }),
      mockRouteContext({ projectId }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.map((run: { runId: string }) => run.runId)).toEqual(["run-b"]);
  });

  it("keeps the whole project list without the parameter", async () => {
    const projectId = "proj-epic-filter-all";
    dbMockState.getQueue.push({ id: projectId, name: "P" });
    register(projectId, "run-c", "epic-c");
    register(projectId, "run-d", "epic-d");

    const res = await GET(mockNextRequest(), mockRouteContext({ projectId }));
    const json = await res.json();

    expect(json.data).toHaveLength(2);
  });
});
