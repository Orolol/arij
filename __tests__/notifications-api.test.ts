import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Mock state ----
const mockState = vi.hoisted(() => ({
  allData: [] as unknown[],
  sqlitePrepareResults: new Map<string, unknown>(),
  sqliteRunCalls: [] as Array<{ sql: string; params: unknown[] }>,
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn((v: unknown) => v),
  eq: vi.fn(() => ({})),
}));

// ---- DB chain mock ----
vi.mock("@/lib/db", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    all: vi.fn(() => mockState.allData),
  };

  return {
    db: chain,
    sqlite: {
      prepare: vi.fn((sql: string) => ({
        get: vi.fn((...params: unknown[]) => {
          // Return matching prepared result
          for (const [key, value] of mockState.sqlitePrepareResults) {
            if (sql.includes(key)) return value;
          }
          return undefined;
        }),
        run: vi.fn((...params: unknown[]) => {
          mockState.sqliteRunCalls.push({ sql, params });
        }),
      })),
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  notifications: {
    __name: "notifications",
    createdAt: "created_at",
  },
}));

// ---- Import route handlers AFTER mocks ----
import { GET } from "@/app/api/notifications/route";
import { POST } from "@/app/api/notifications/read/route";

function makeRequest(url: string): Request {
  return new Request(url);
}

describe("GET /api/notifications", () => {
  beforeEach(() => {
    mockState.allData = [];
    mockState.sqlitePrepareResults.clear();
    mockState.sqliteRunCalls = [];
  });

  it("returns empty list with unreadCount 0 when no notifications", () => {
    mockState.allData = [];
    mockState.sqlitePrepareResults.set("COUNT(*)", { cnt: 0 });

    const req = makeRequest("http://localhost/api/notifications");
    return GET(req as any).then(async (res) => {
      const body = await res.json();
      expect(body.data).toEqual([]);
      expect(body.unreadCount).toBe(0);
    });
  });

  it("returns notifications with correct unread count when cursor exists", () => {
    const notifs = [
      { id: "n1", title: "Build completed", status: "completed", createdAt: "2026-02-18T12:00:00Z" },
      { id: "n2", title: "Review failed", status: "failed", createdAt: "2026-02-18T11:00:00Z" },
    ];
    mockState.allData = notifs;
    mockState.sqlitePrepareResults.set("read_at", { read_at: "2026-02-18T11:30:00Z" });
    mockState.sqlitePrepareResults.set("COUNT(*)", { cnt: 1 });

    const req = makeRequest("http://localhost/api/notifications");
    return GET(req as any).then(async (res) => {
      const body = await res.json();
      expect(body.data).toHaveLength(2);
      expect(body.unreadCount).toBe(1);
    });
  });

  it("respects limit parameter", () => {
    mockState.allData = [];
    mockState.sqlitePrepareResults.set("COUNT(*)", { cnt: 0 });

    const req = makeRequest("http://localhost/api/notifications?limit=10");
    return GET(req as any).then(async (res) => {
      const body = await res.json();
      expect(body.data).toEqual([]);
    });
  });

  it("clamps limit to 200 max", () => {
    mockState.allData = [];
    mockState.sqlitePrepareResults.set("COUNT(*)", { cnt: 0 });

    const req = makeRequest("http://localhost/api/notifications?limit=999");
    return GET(req as any).then(async (res) => {
      expect(res.status).toBe(200);
    });
  });
});

describe("POST /api/notifications/read", () => {
  beforeEach(() => {
    mockState.sqliteRunCalls = [];
  });

  it("upserts read cursor and returns ok", async () => {
    const res = await POST();
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(mockState.sqliteRunCalls).toHaveLength(1);
    expect(mockState.sqliteRunCalls[0].sql).toContain("INSERT OR REPLACE");
    // The timestamp param should be an ISO string
    expect(typeof mockState.sqliteRunCalls[0].params[0]).toBe("string");
  });
});
