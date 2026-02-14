/**
 * Tests for named agents CRUD operations (lib/agent-config/named-agents.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({
  getQueue: [] as unknown[],
  allQueue: [] as unknown[],
  runQueue: [] as Array<{ changes: number }>,
  runCalls: [] as Array<Record<string, unknown>>,
  insertValues: [] as unknown[],
}));

vi.mock("@/lib/db", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    get: vi.fn(() => mockDb.getQueue.shift() ?? undefined),
    all: vi.fn(() => mockDb.allQueue.shift() ?? []),
    insert: vi.fn().mockReturnValue({
      values: vi.fn((vals: unknown) => {
        mockDb.insertValues.push(vals);
        return { run: vi.fn(() => mockDb.runQueue.shift() ?? { changes: 1 }) };
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnValue({ run: vi.fn(() => mockDb.runQueue.shift() ?? { changes: 1 }) }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({ run: vi.fn(() => mockDb.runQueue.shift() ?? { changes: 1 }) }),
    }),
  };
  return { db: chain };
});

vi.mock("@/lib/db/schema", () => ({
  namedAgents: {
    id: "id",
    name: "name",
    provider: "provider",
    model: "model",
    createdAt: "createdAt",
  },
  agentProviderDefaults: {
    namedAgentId: "namedAgentId",
  },
}));

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "test-id-123"),
}));

describe("Named Agents CRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.getQueue = [];
    mockDb.allQueue = [];
    mockDb.runQueue = [];
    mockDb.runCalls = [];
    mockDb.insertValues = [];
  });

  describe("listNamedAgents", () => {
    it("returns all named agents ordered by name", async () => {
      const agents = [
        { id: "a1", name: "Agent A", provider: "claude-code", model: "m1", createdAt: "2026-01-01" },
        { id: "a2", name: "Agent B", provider: "codex", model: "m2", createdAt: "2026-01-02" },
      ];
      mockDb.allQueue = [agents];

      const { listNamedAgents } = await import("@/lib/agent-config/named-agents");
      const result = await listNamedAgents();
      expect(result).toEqual(agents);
    });

    it("returns empty array when no agents exist", async () => {
      mockDb.allQueue = [[]];

      const { listNamedAgents } = await import("@/lib/agent-config/named-agents");
      const result = await listNamedAgents();
      expect(result).toEqual([]);
    });
  });

  describe("getNamedAgent", () => {
    it("returns agent when found", async () => {
      const agent = { id: "a1", name: "Test", provider: "claude-code", model: "m1", createdAt: "2026-01-01" };
      mockDb.getQueue = [agent];

      const { getNamedAgent } = await import("@/lib/agent-config/named-agents");
      const result = await getNamedAgent("a1");
      expect(result).toEqual(agent);
    });

    it("returns undefined when not found", async () => {
      mockDb.getQueue = [undefined];

      const { getNamedAgent } = await import("@/lib/agent-config/named-agents");
      const result = await getNamedAgent("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("createNamedAgent", () => {
    it("creates a named agent with valid input", async () => {
      const created = {
        id: "test-id-123",
        name: "CC Opus",
        provider: "claude-code",
        model: "claude-opus-4-6",
        createdAt: expect.any(String),
      };
      // First get: uniqueness check → not found
      // Second get: re-fetch after insert
      mockDb.getQueue = [undefined, created];

      const { createNamedAgent } = await import("@/lib/agent-config/named-agents");
      const result = await createNamedAgent({
        id: "test-id-123",
        name: "CC Opus",
        provider: "claude-code",
        model: "claude-opus-4-6",
      });
      expect(result.data).toEqual(created);
    });

    it("returns error on empty name", async () => {
      const { createNamedAgent } = await import("@/lib/agent-config/named-agents");
      const result = await createNamedAgent({ id: "id", name: "  ", provider: "claude-code", model: "m1" });
      expect(result.error).toContain("Name must not be empty");
    });

    it("returns error on empty model", async () => {
      const { createNamedAgent } = await import("@/lib/agent-config/named-agents");
      const result = await createNamedAgent({ id: "id", name: "Test", provider: "claude-code", model: "  " });
      expect(result.error).toContain("Model must not be empty");
    });

    it("returns error on invalid provider", async () => {
      const { createNamedAgent } = await import("@/lib/agent-config/named-agents");
      const result = await createNamedAgent({
        id: "id",
        name: "Test",
        provider: "invalid" as "claude-code",
        model: "m1",
      });
      expect(result.error).toContain("provider");
    });

    it("returns error on duplicate name", async () => {
      // Uniqueness check: found existing
      mockDb.getQueue = [{ id: "existing-id" }];

      const { createNamedAgent } = await import("@/lib/agent-config/named-agents");
      const result = await createNamedAgent({ id: "id", name: "Existing", provider: "claude-code", model: "m1" });
      expect(result.error).toContain('already exists');
    });

    it("creates agents with gemini-cli provider", async () => {
      const created = {
        id: "test-id-123",
        name: "Gemini Flash",
        provider: "gemini-cli",
        model: "gemini-2.0-flash",
        createdAt: expect.any(String),
      };
      mockDb.getQueue = [undefined, created];

      const { createNamedAgent } = await import("@/lib/agent-config/named-agents");
      const result = await createNamedAgent({
        id: "test-id-123",
        name: "Gemini Flash",
        provider: "gemini-cli",
        model: "gemini-2.0-flash",
      });
      expect(result.data?.provider).toBe("gemini-cli");
      expect(result.data?.model).toBe("gemini-2.0-flash");
    });
  });

  describe("updateNamedAgent", () => {
    it("updates specified fields only", async () => {
      const existing = { id: "a1", name: "Old", provider: "claude-code", model: "old", createdAt: "2026-01-01" };
      const updated = { ...existing, name: "New" };
      // First get: check existence
      // Second get: uniqueness check for name
      // Third get: return updated
      mockDb.getQueue = [existing, undefined, updated];

      const { updateNamedAgent } = await import("@/lib/agent-config/named-agents");
      const result = await updateNamedAgent("a1", { name: "New" });
      expect(result.data?.name).toBe("New");
    });

    it("returns error when agent not found", async () => {
      mockDb.getQueue = [undefined];

      const { updateNamedAgent } = await import("@/lib/agent-config/named-agents");
      const result = await updateNamedAgent("nonexistent", { name: "Test" });
      expect(result.error).toContain("not found");
    });

    it("returns error on duplicate name with different id", async () => {
      const existing = { id: "a1", name: "Original", provider: "claude-code", model: "m1", createdAt: "2026-01-01" };
      // existence check, then name uniqueness check returns different id
      mockDb.getQueue = [existing, { id: "a2" }];

      const { updateNamedAgent } = await import("@/lib/agent-config/named-agents");
      const result = await updateNamedAgent("a1", { name: "Taken" });
      expect(result.error).toContain("already exists");
    });
  });

  describe("deleteNamedAgent", () => {
    it("deletes an existing agent and returns true", async () => {
      mockDb.getQueue = [{ id: "a1", name: "Test", provider: "claude-code", model: "m1" }];

      const { deleteNamedAgent } = await import("@/lib/agent-config/named-agents");
      const result = await deleteNamedAgent("a1");
      expect(result).toBe(true);
    });

    it("returns false when agent not found", async () => {
      mockDb.runQueue = [{ changes: 0 }];

      const { deleteNamedAgent } = await import("@/lib/agent-config/named-agents");
      const result = await deleteNamedAgent("nonexistent");
      expect(result).toBe(false);
    });
  });
});
