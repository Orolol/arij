import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({
  getQueue: [] as unknown[],
  allQueue: [] as unknown[],
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  desc: vi.fn((value: unknown) => value),
}));

vi.mock("@/lib/db", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    get: vi.fn(() => mockDb.getQueue.shift() ?? null),
    all: vi.fn(() => mockDb.allQueue.shift() ?? []),
  };
  return { db: chain };
});

vi.mock("@/lib/db/schema", () => ({
  projects: {
    id: "id",
  },
  qaReports: {
    id: "id",
    projectId: "projectId",
    createdAt: "createdAt",
  },
}));

describe("QA report list/detail routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.getQueue = [];
    mockDb.allQueue = [];
  });

  it("GET /api/projects/[projectId]/qa/reports returns 404 for unknown project", async () => {
    mockDb.getQueue = [null];

    const { GET } = await import(
      "@/app/api/projects/[projectId]/qa/reports/route"
    );
    const res = await GET({} as never, {
      params: Promise.resolve({ projectId: "missing" }),
    });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("Project not found");
  });

  it("GET /api/projects/[projectId]/qa/reports returns report history", async () => {
    mockDb.getQueue = [{ id: "proj-1" }];
    mockDb.allQueue = [[{ id: "qr-1", status: "completed" }]];

    const { GET } = await import(
      "@/app/api/projects/[projectId]/qa/reports/route"
    );
    const res = await GET({} as never, {
      params: Promise.resolve({ projectId: "proj-1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe("qr-1");
  });

  it("GET /api/projects/[projectId]/qa/reports/[reportId] returns 404 when missing", async () => {
    mockDb.getQueue = [{ id: "proj-1" }, null];

    const { GET } = await import(
      "@/app/api/projects/[projectId]/qa/reports/[reportId]/route"
    );
    const res = await GET({} as never, {
      params: Promise.resolve({ projectId: "proj-1", reportId: "missing" }),
    });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("Report not found");
  });

  it("GET /api/projects/[projectId]/qa/reports/[reportId] returns report detail", async () => {
    mockDb.getQueue = [{ id: "proj-1" }, { id: "qr-1", status: "completed" }];

    const { GET } = await import(
      "@/app/api/projects/[projectId]/qa/reports/[reportId]/route"
    );
    const res = await GET({} as never, {
      params: Promise.resolve({ projectId: "proj-1", reportId: "qr-1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe("qr-1");
  });
});
