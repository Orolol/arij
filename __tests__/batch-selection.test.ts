import { describe, expect, it, vi, beforeEach } from "vitest";

// Test the transitive dependency resolution API
const mockGetTransitiveDependencies = vi.hoisted(() => vi.fn());

vi.mock("@/lib/dependencies/validation", () => ({
  getTransitiveDependencies: mockGetTransitiveDependencies,
}));

function mockRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
  } as unknown as import("next/server").NextRequest;
}

describe("POST /api/projects/[projectId]/dependencies/transitive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when ticketIds is missing", async () => {
    const { POST } = await import(
      "@/app/api/projects/[projectId]/dependencies/transitive/route"
    );
    const res = await POST(
      mockRequest({}),
      { params: Promise.resolve({ projectId: "proj1" }) }
    );
    expect(res.status).toBe(400);
  });

  it("returns all and autoIncluded IDs", async () => {
    // User selects A; A depends on B; B depends on C
    mockGetTransitiveDependencies.mockReturnValue(
      new Set(["A", "B", "C"])
    );

    const { POST } = await import(
      "@/app/api/projects/[projectId]/dependencies/transitive/route"
    );
    const res = await POST(
      mockRequest({ ticketIds: ["A"] }),
      { params: Promise.resolve({ projectId: "proj1" }) }
    );

    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.all).toEqual(expect.arrayContaining(["A", "B", "C"]));
    expect(json.data.autoIncluded).toEqual(
      expect.arrayContaining(["B", "C"])
    );
    expect(json.data.autoIncluded).not.toContain("A");
  });

  it("returns empty autoIncluded when no dependencies", async () => {
    mockGetTransitiveDependencies.mockReturnValue(new Set(["X"]));

    const { POST } = await import(
      "@/app/api/projects/[projectId]/dependencies/transitive/route"
    );
    const res = await POST(
      mockRequest({ ticketIds: ["X"] }),
      { params: Promise.resolve({ projectId: "proj1" }) }
    );

    const json = await res.json();
    expect(json.data.all).toEqual(["X"]);
    expect(json.data.autoIncluded).toEqual([]);
  });

  it("handles multiple user-selected tickets with shared dependencies", async () => {
    // A depends on C, B depends on C — user selects [A, B]
    mockGetTransitiveDependencies.mockReturnValue(
      new Set(["A", "B", "C"])
    );

    const { POST } = await import(
      "@/app/api/projects/[projectId]/dependencies/transitive/route"
    );
    const res = await POST(
      mockRequest({ ticketIds: ["A", "B"] }),
      { params: Promise.resolve({ projectId: "proj1" }) }
    );

    const json = await res.json();
    expect(json.data.all).toEqual(expect.arrayContaining(["A", "B", "C"]));
    expect(json.data.autoIncluded).toEqual(["C"]);
  });
});
