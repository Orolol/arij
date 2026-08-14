import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockJsonRequest,
} from "@/__tests__/helpers/db-mock";

// Real drizzle-orm + real @/lib/db/schema: both are side-effect-free pure
// builders, and the chain mock ignores their output. No fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "qa-prompt-1"),
}));

describe("QA prompt routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("GET /api/qa/prompts returns prompt list", async () => {
    dbMockState.allQueue = [
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
    const res = await POST(mockJsonRequest({ name: " ", prompt: "" }));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation failed");
    expect(json.details.name[0]).toContain("required");
    expect(json.details.prompt[0]).toContain("required");
  });

  it("POST /api/qa/prompts creates a prompt", async () => {
    const { POST } = await import("@/app/api/qa/prompts/route");
    const res = await POST(
      mockJsonRequest({ name: "Backend Audit", prompt: "Check N+1 queries." }),
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.data.id).toBe("qa-prompt-1");
    expect(dbMockState.insertCalls).toHaveLength(1);
  });
});
