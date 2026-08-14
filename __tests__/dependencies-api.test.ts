import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockJsonRequest,
  mockNextRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

const mockIdState = vi.hoisted(() => ({ value: 1 }));

// Real drizzle-orm + real @/lib/db/schema: both are side-effect-free pure
// builders, and the chain mock ignores their output. No fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => {
    const id = `dep-${mockIdState.value}`;
    mockIdState.value += 1;
    return id;
  }),
}));

// Mock validation module for API tests — we test validation separately
const mockCreateDependencies = vi.hoisted(() => vi.fn());
const mockGetProjectDependencies = vi.hoisted(() => vi.fn());

vi.mock("@/lib/dependencies/crud", () => ({
  createDependencies: mockCreateDependencies,
  getProjectDependencies: mockGetProjectDependencies,
}));

vi.mock("@/lib/dependencies/validation", () => ({
  CycleError: class CycleError extends Error {
    cycle: string[];
    constructor(cycle: string[]) {
      super(`Dependency cycle detected: ${cycle.join(" → ")}`);
      this.name = "CycleError";
      this.cycle = cycle;
    }
  },
  CrossProjectError: class CrossProjectError extends Error {
    constructor(ticketId: string, dependsOnId: string) {
      super(`Cross-project dependency not allowed: ticket "${ticketId}" and "${dependsOnId}" belong to different projects`);
      this.name = "CrossProjectError";
    }
  },
}));

describe("GET /api/projects/[projectId]/dependencies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("returns all dependencies for a project", async () => {
    const deps = [
      { id: "d1", ticketId: "A", dependsOnTicketId: "B", projectId: "proj1" },
      { id: "d2", ticketId: "C", dependsOnTicketId: "B", projectId: "proj1" },
    ];
    mockGetProjectDependencies.mockReturnValue(deps);

    const { GET } = await import(
      "@/app/api/projects/[projectId]/dependencies/route"
    );
    const response = await GET(
      mockNextRequest(),
      mockRouteContext({ projectId: "proj1" })
    );

    const json = await response.json();
    expect(json.data).toHaveLength(2);
    expect(mockGetProjectDependencies).toHaveBeenCalledWith("proj1");
  });
});

describe("POST /api/projects/[projectId]/dependencies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
    mockIdState.value = 1;
  });

  it("returns 400 when edges array is missing", async () => {
    const { POST } = await import(
      "@/app/api/projects/[projectId]/dependencies/route"
    );
    const response = await POST(
      mockJsonRequest({}),
      mockRouteContext({ projectId: "proj1" })
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("edges array is required");
  });

  it("returns 400 when edges array is empty", async () => {
    const { POST } = await import(
      "@/app/api/projects/[projectId]/dependencies/route"
    );
    const response = await POST(
      mockJsonRequest({ edges: [] }),
      mockRouteContext({ projectId: "proj1" })
    );

    expect(response.status).toBe(400);
  });

  it("returns 400 for self-referencing dependency", async () => {
    const { POST } = await import(
      "@/app/api/projects/[projectId]/dependencies/route"
    );
    const response = await POST(
      mockJsonRequest({ edges: [{ ticketId: "A", dependsOnTicketId: "A" }] }),
      mockRouteContext({ projectId: "proj1" })
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("cannot depend on itself");
  });

  it("creates dependencies and returns 201", async () => {
    const created = [
      { id: "dep-1", ticketId: "A", dependsOnTicketId: "B", projectId: "proj1" },
    ];
    mockCreateDependencies.mockReturnValue(created);

    const { POST } = await import(
      "@/app/api/projects/[projectId]/dependencies/route"
    );
    const response = await POST(
      mockJsonRequest({ edges: [{ ticketId: "A", dependsOnTicketId: "B" }] }),
      mockRouteContext({ projectId: "proj1" })
    );

    expect(response.status).toBe(201);
    const json = await response.json();
    expect(json.data).toHaveLength(1);
    expect(mockCreateDependencies).toHaveBeenCalledWith("proj1", [
      { ticketId: "A", dependsOnTicketId: "B" },
    ]);
  });

  it("returns 422 when a cycle is detected", async () => {
    const { CycleError } = await import("@/lib/dependencies/validation");
    mockCreateDependencies.mockImplementation(() => {
      throw new CycleError(["A", "B", "A"]);
    });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/dependencies/route"
    );
    const response = await POST(
      mockJsonRequest({ edges: [{ ticketId: "A", dependsOnTicketId: "B" }] }),
      mockRouteContext({ projectId: "proj1" })
    );

    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.code).toBe("CYCLE_DETECTED");
    expect(json.cycle).toEqual(["A", "B", "A"]);
  });

  it("returns 422 for cross-project dependency", async () => {
    const { CrossProjectError } = await import("@/lib/dependencies/validation");
    mockCreateDependencies.mockImplementation(() => {
      throw new CrossProjectError("A", "X");
    });

    const { POST } = await import(
      "@/app/api/projects/[projectId]/dependencies/route"
    );
    const response = await POST(
      mockJsonRequest({ edges: [{ ticketId: "A", dependsOnTicketId: "X" }] }),
      mockRouteContext({ projectId: "proj1" })
    );

    expect(response.status).toBe(422);
    const json = await response.json();
    expect(json.code).toBe("CROSS_PROJECT_DEPENDENCY");
  });
});
