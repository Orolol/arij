import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({
  getQueue: [] as unknown[],
  allQueue: [] as unknown[],
  insertedValues: [] as unknown[],
  updatedValues: [] as unknown[],
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
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
    insert: vi.fn().mockReturnValue({
      values: vi.fn((payload: unknown) => {
        mockDb.insertedValues.push(payload);
        return { run: vi.fn() };
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn((payload: unknown) => {
        mockDb.updatedValues.push(payload);
        return {
          where: vi.fn(() => ({ run: vi.fn() })),
        };
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn(() => ({ run: vi.fn() })),
    }),
  };

  return { db: chain };
});

vi.mock("@/lib/db/schema", () => ({
  qaPrompts: {
    id: "id",
    name: "name",
    prompt: "prompt",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
}));

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "qa-prompt-1"),
}));

function mockRequest(body: Record<string, unknown>) {
  return {
    json: () => Promise.resolve(body),
  } as unknown as import("next/server").NextRequest;
}

describe("QA prompt routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.getQueue = [];
    mockDb.allQueue = [];
    mockDb.insertedValues = [];
    mockDb.updatedValues = [];
  });

  it("GET /api/qa/prompts returns prompt list", async () => {
    mockDb.allQueue = [
      [{ id: "qp-1", name: "Security", prompt: "Check auth." }],
    ];

    const { GET } = await import("@/app/api/qa/prompts/route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].name).toBe("Security");
  });

  it("POST /api/qa/prompts validates required fields", async () => {
    const { POST } = await import("@/app/api/qa/prompts/route");
    const res = await POST(mockRequest({ name: " ", prompt: "" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain("required");
  });

  it("POST /api/qa/prompts creates a prompt", async () => {
    const { POST } = await import("@/app/api/qa/prompts/route");
    const res = await POST(
      mockRequest({ name: "Backend Audit", prompt: "Check N+1 queries." }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.id).toBe("qa-prompt-1");
    expect(mockDb.insertedValues).toHaveLength(1);
  });

  it("PATCH /api/qa/prompts/[promptId] returns 404 when prompt is missing", async () => {
    mockDb.getQueue = [null];

    const { PATCH } = await import("@/app/api/qa/prompts/[promptId]/route");
    const res = await PATCH(mockRequest({ name: "Updated" }), {
      params: Promise.resolve({ promptId: "missing" }),
    });
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toContain("not found");
  });

  it("PATCH /api/qa/prompts/[promptId] updates an existing prompt", async () => {
    mockDb.getQueue = [{ id: "qp-1", name: "Old", prompt: "Old prompt" }];

    const { PATCH } = await import("@/app/api/qa/prompts/[promptId]/route");
    const res = await PATCH(mockRequest({ name: "New Name" }), {
      params: Promise.resolve({ promptId: "qp-1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.id).toBe("qp-1");
    expect(mockDb.updatedValues).toHaveLength(1);
  });

  it("DELETE /api/qa/prompts/[promptId] deletes a prompt", async () => {
    const { DELETE } = await import("@/app/api/qa/prompts/[promptId]/route");
    const res = await DELETE({} as never, {
      params: Promise.resolve({ promptId: "qp-1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.deleted).toBe(true);
  });
});
