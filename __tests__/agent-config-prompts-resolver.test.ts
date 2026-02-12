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
  agentPrompts: {
    agentType: "agentType",
    systemPrompt: "systemPrompt",
    scope: "scope",
  },
}));

describe("Agent prompt resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.getQueue = [];
    mockDb.allQueue = [];
  });

  it("resolveAgentPrompt prioritizes project override over global", async () => {
    const { resolveAgentPrompt } = await import("@/lib/agent-config/prompts");
    mockDb.getQueue = [{ systemPrompt: "Project prompt" }];

    const prompt = await resolveAgentPrompt("build", "proj-1");
    expect(prompt).toBe("Project prompt");
  });

  it("resolveAgentPrompt falls back to global prompt", async () => {
    const { resolveAgentPrompt } = await import("@/lib/agent-config/prompts");
    mockDb.getQueue = [null, { systemPrompt: "Global prompt" }];

    const prompt = await resolveAgentPrompt("build", "proj-1");
    expect(prompt).toBe("Global prompt");
  });

  it("resolveAgentPrompt falls back to built-in default", async () => {
    const { resolveAgentPrompt } = await import("@/lib/agent-config/prompts");
    mockDb.getQueue = [null, null];

    const prompt = await resolveAgentPrompt("build", "proj-1");
    expect(prompt).toBe("");
  });

  it("listMergedProjectAgentPrompts returns project > global > built-in sources", async () => {
    const { listMergedProjectAgentPrompts } = await import(
      "@/lib/agent-config/prompts"
    );
    mockDb.allQueue = [
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
