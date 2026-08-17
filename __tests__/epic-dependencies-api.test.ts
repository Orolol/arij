import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockJsonRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

// Real drizzle-orm + real @/lib/db/schema: both are side-effect-free pure
// builders, and the chain mock ignores their output. No fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

/** The dependency-edge fields the route actually reads back out. */
type DependencyEdgeStub = {
  id: string;
  ticketId: string;
  dependsOnTicketId: string;
};

const mockGetTicketDependencies = vi.hoisted(() =>
  vi.fn((): DependencyEdgeStub[] => [])
);
const mockGetTicketDependents = vi.hoisted(() =>
  vi.fn((): DependencyEdgeStub[] => [])
);
const mockSetTicketDependencies = vi.hoisted(() =>
  vi.fn((): DependencyEdgeStub[] => [])
);

vi.mock("@/lib/dependencies/validation", () => ({
  getTicketDependencies: mockGetTicketDependencies,
  getTicketDependents: mockGetTicketDependents,
  CycleError: class CycleError extends Error {
    cycle: string[];
    constructor(cycle: string[]) {
      super(`Dependency cycle detected: ${cycle.join(" → ")}`);
      this.name = "CycleError";
      this.cycle = cycle;
    }
  },
  CrossProjectError: class CrossProjectError extends Error {
    constructor(a: string, b: string) {
      super(`Cross-project: ${a} and ${b}`);
      this.name = "CrossProjectError";
    }
  },
}));

vi.mock("@/lib/dependencies/crud", () => ({
  setTicketDependencies: mockSetTicketDependencies,
}));

const mockRequest = mockJsonRequest;

const routeParams = mockRouteContext({
  projectId: "proj1",
  epicId: "epic-1",
});

describe("GET /api/projects/[projectId]/epics/[epicId]/dependencies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("returns 404 when epic not found", async () => {
    dbMockState.getQueue = []; // no epic found

    const { GET } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/dependencies/route"
    );
    const res = await GET(mockRequest({}), routeParams);
    expect(res.status).toBe(404);
  });

  it("returns predecessors and successors", async () => {
    dbMockState.getQueue = [{ id: "epic-1", projectId: "proj1" }];
    mockGetTicketDependencies.mockReturnValue([
      { id: "d1", ticketId: "epic-1", dependsOnTicketId: "epic-2" },
    ]);
    mockGetTicketDependents.mockReturnValue([
      { id: "d2", ticketId: "epic-3", dependsOnTicketId: "epic-1" },
    ]);

    const { GET } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/dependencies/route"
    );
    const res = await GET(mockRequest({}), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.predecessors).toHaveLength(1);
    expect(json.data.successors).toHaveLength(1);
  });
});

describe("PUT /api/projects/[projectId]/epics/[epicId]/dependencies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("returns 400 when dependsOnIds is not an array", async () => {
    const { PUT } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/dependencies/route"
    );
    const res = await PUT(mockRequest({}), routeParams);
    expect(res.status).toBe(400);
  });

  it("returns 404 when epic not found", async () => {
    dbMockState.getQueue = []; // no epic

    const { PUT } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/dependencies/route"
    );
    const res = await PUT(
      mockRequest({ dependsOnIds: ["epic-2"] }),
      routeParams
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 for self-dependency", async () => {
    dbMockState.getQueue = [{ id: "epic-1", projectId: "proj1" }];

    const { PUT } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/dependencies/route"
    );
    const res = await PUT(
      mockRequest({ dependsOnIds: ["epic-1"] }),
      routeParams
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("cannot depend on itself");
  });

  it("saves dependencies successfully", async () => {
    dbMockState.getQueue = [{ id: "epic-1", projectId: "proj1" }];
    mockSetTicketDependencies.mockReturnValue([
      { id: "dep-1", ticketId: "epic-1", dependsOnTicketId: "epic-2" },
    ]);

    const { PUT } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/dependencies/route"
    );
    const res = await PUT(
      mockRequest({ dependsOnIds: ["epic-2"] }),
      routeParams
    );

    expect(res.status).toBe(200);
    expect(mockSetTicketDependencies).toHaveBeenCalledWith(
      "proj1",
      "epic-1",
      ["epic-2"]
    );
  });

  it("returns 422 on cycle detection", async () => {
    dbMockState.getQueue = [{ id: "epic-1", projectId: "proj1" }];
    const { CycleError } = await import("@/lib/dependencies/validation");
    mockSetTicketDependencies.mockImplementation(() => {
      throw new CycleError(["epic-1", "epic-2", "epic-1"]);
    });

    const { PUT } = await import(
      "@/app/api/projects/[projectId]/epics/[epicId]/dependencies/route"
    );
    const res = await PUT(
      mockRequest({ dependsOnIds: ["epic-2"] }),
      routeParams
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe("CYCLE_DETECTED");
    expect(json.cycle).toEqual(["epic-1", "epic-2", "epic-1"]);
  });
});
