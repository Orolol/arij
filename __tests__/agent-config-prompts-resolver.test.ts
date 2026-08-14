import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbMockState, resetDbMockState } from "@/__tests__/helpers/db-mock";

// Real drizzle-orm + real @/lib/db/schema: both are side-effect-free pure
// builders, and the chain mock ignores their output. No fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

describe("Agent prompt resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("resolveAgentPrompt prioritizes project override over global", async () => {
    const { resolveAgentPrompt } = await import("@/lib/agent-config/prompts");
    dbMockState.getQueue = [{ systemPrompt: "Project prompt" }];

    const prompt = await resolveAgentPrompt("build", "proj-1");
    expect(prompt).toBe("Project prompt");
  });

  it("resolveAgentPrompt falls back to global prompt", async () => {
    const { resolveAgentPrompt } = await import("@/lib/agent-config/prompts");
    dbMockState.getQueue = [null, { systemPrompt: "Global prompt" }];

    const prompt = await resolveAgentPrompt("build", "proj-1");
    expect(prompt).toBe("Global prompt");
  });

  it("resolveAgentPrompt falls back to built-in default", async () => {
    const { resolveAgentPrompt } = await import("@/lib/agent-config/prompts");
    dbMockState.getQueue = [null, null];

    const prompt = await resolveAgentPrompt("build", "proj-1");
    expect(prompt).toBe("");
  });

  it("listMergedProjectAgentPrompts returns project > global > built-in sources", async () => {
    const { listMergedProjectAgentPrompts } = await import(
      "@/lib/agent-config/prompts"
    );
    dbMockState.allQueue = [
      [{ agentType: "chat", systemPrompt: "Global chat", scope: "global" }],
      [{ agentType: "build", systemPrompt: "Project build", scope: "proj-1" }],
    ];

    const merged = await listMergedProjectAgentPrompts("proj-1");

    const build = merged.find((x) => x.agentType === "build");
    const chat = merged.find((x) => x.agentType === "chat");
    const review = merged.find((x) => x.agentType === "review_code");

    expect(build?.source).toBe("project");
    expect(build?.systemPrompt).toBe("Project build");
    expect(chat?.source).toBe("global");
    expect(chat?.systemPrompt).toBe("Global chat");
    expect(review?.source).toBe("builtin");
  });
});
