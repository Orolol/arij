import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbMockState, resetDbMockState } from "@/__tests__/helpers/db-mock";

// Real drizzle-orm + real @/lib/db/schema: both are side-effect-free pure
// builders, and the chain mock ignores their output. No fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

describe("Agent provider resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("resolveAgent uses project override first", async () => {
    const { resolveAgent } = await import("@/lib/agent-config/agent-resolution");
    dbMockState.getQueue = [{ provider: "codex" }];

    const resolved = await resolveAgent("build", "proj-1");
    expect(resolved.provider).toBe("codex");
  });

  it("resolveAgent falls back to global", async () => {
    const { resolveAgent } = await import("@/lib/agent-config/agent-resolution");
    dbMockState.getQueue = [null, { provider: "codex" }];

    const resolved = await resolveAgent("chat", "proj-1");
    expect(resolved.provider).toBe("codex");
  });

  it("resolveAgent falls back to claude-code", async () => {
    const { resolveAgent } = await import("@/lib/agent-config/agent-resolution");
    dbMockState.getQueue = [null, null];

    const resolved = await resolveAgent("ticket_build", "proj-1");
    expect(resolved.provider).toBe("claude-code");
  });

  it("listMergedProjectAgentProviders merges project > global > fallback", async () => {
    const { listMergedProjectAgentProviders } = await import(
      "@/lib/agent-config/agent-resolution"
    );
    dbMockState.allQueue = [
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

  it("resolveAgent returns provider + model from named agent assignment", async () => {
    const { resolveAgent } = await import("@/lib/agent-config/agent-resolution");
    // resolveAgent first queries agentProviderDefaults for project scope (get),
    // which returns a row with namedAgentId. Then it calls resolveFromRow which
    // does a select().from(namedAgents).where(...).get() to look up the named agent.
    dbMockState.getQueue = [
      {
        // First get: project-scoped agentProviderDefaults row
        provider: "claude-code",
        namedAgentId: "na-1",
      },
      {
        // Second get: named agent lookup by id
        id: "na-1",
        name: "Gemini Fast",
        provider: "gemini-cli",
        model: "gemini-2.0-flash",
      },
    ];

    const resolved = await resolveAgent("build", "proj-1");
    expect(resolved.provider).toBe("gemini-cli");
    expect(resolved.model).toBe("gemini-2.0-flash");
    expect(resolved.namedAgentId).toBe("na-1");
  });
});
