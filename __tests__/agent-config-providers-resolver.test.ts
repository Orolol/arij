import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({
  getQueue: [] as unknown[],
  allQueue: [] as unknown[],
}));

vi.mock("@/lib/db", () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    get: vi.fn(() => mockDb.getQueue.shift() ?? null),
    all: vi.fn(() => mockDb.allQueue.shift() ?? []),
  };
  return { db: chain };
});

vi.mock("@/lib/db/schema", () => ({
  agentProviderDefaults: {
    agentType: "agentType",
    provider: "provider",
    scope: "scope",
  },
}));

describe("Agent provider resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.getQueue = [];
    mockDb.allQueue = [];
  });

  it("resolveAgentProvider uses project override first", async () => {
    const { resolveAgentProvider } = await import("@/lib/agent-config/providers");
    mockDb.getQueue = [{ provider: "codex" }];

    const provider = await resolveAgentProvider("build", "proj-1");
    expect(provider).toBe("codex");
  });

  it("resolveAgentProvider falls back to global", async () => {
    const { resolveAgentProvider } = await import("@/lib/agent-config/providers");
    mockDb.getQueue = [null, { provider: "codex" }];

    const provider = await resolveAgentProvider("chat", "proj-1");
    expect(provider).toBe("codex");
  });

  it("resolveAgentProvider falls back to claude-code", async () => {
    const { resolveAgentProvider } = await import("@/lib/agent-config/providers");
    mockDb.getQueue = [null, null];

    const provider = await resolveAgentProvider("ticket_build", "proj-1");
    expect(provider).toBe("claude-code");
  });

  it("listMergedProjectAgentProviders merges project > global > fallback", async () => {
    const { listMergedProjectAgentProviders } = await import(
      "@/lib/agent-config/providers"
    );
    mockDb.allQueue = [
      [{ agentType: "chat", provider: "codex", scope: "global" }],
      [{ agentType: "build", provider: "codex", scope: "proj-1" }],
    ];

    const merged = await listMergedProjectAgentProviders("proj-1");
    const build = merged.find((x) => x.agentType === "build");
    const chat = merged.find((x) => x.agentType === "chat");
    const ticketBuild = merged.find((x) => x.agentType === "ticket_build");

    expect(build?.provider).toBe("codex");
    expect(build?.source).toBe("project");
    expect(chat?.provider).toBe("codex");
    expect(chat?.source).toBe("global");
    expect(ticketBuild?.provider).toBe("claude-code");
    expect(ticketBuild?.source).toBe("builtin");
  });
});
