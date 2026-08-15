import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockNextRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

// Real drizzle-orm + real @/lib/db/schema; the shared chain mock ignores
// column identity, so no fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

describe("QA report list/detail routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("GET /api/projects/[projectId]/qa/reports returns 404 for unknown project", async () => {
    dbMockState.getQueue = [null];

    const { GET } = await import(
      "@/app/api/projects/[projectId]/qa/reports/route"
    );
    const res = await GET(mockNextRequest(), mockRouteContext({ projectId: "missing" }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("Project not found");
  });

  it("GET /api/projects/[projectId]/qa/reports returns report history", async () => {
    dbMockState.getQueue = [{ id: "proj-1" }];
    dbMockState.allQueue = [[{ id: "qr-1", status: "completed" }]];

    const { GET } = await import(
      "@/app/api/projects/[projectId]/qa/reports/route"
    );
    const res = await GET(mockNextRequest(), mockRouteContext({ projectId: "proj-1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe("qr-1");
  });

  it("GET /api/projects/[projectId]/qa/reports/[reportId] returns 404 when missing", async () => {
    dbMockState.getQueue = [{ id: "proj-1" }, null];

    const { GET } = await import(
      "@/app/api/projects/[projectId]/qa/reports/[reportId]/route"
    );
    const res = await GET(mockNextRequest(), mockRouteContext({ projectId: "proj-1", reportId: "missing" }));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("Report not found");
  });

  it("GET /api/projects/[projectId]/qa/reports/[reportId] returns report detail", async () => {
    dbMockState.getQueue = [{ id: "proj-1" }, { id: "qr-1", status: "completed" }];

    const { GET } = await import(
      "@/app/api/projects/[projectId]/qa/reports/[reportId]/route"
    );
    const res = await GET(mockNextRequest(), mockRouteContext({ projectId: "proj-1", reportId: "qr-1" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe("qr-1");
  });
});
