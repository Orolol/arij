/**
 * generate-spec used to route only codex and gemini-cli through
 * getProvider(); everything else fell through to spawnClaude(). A
 * spec_generation default of Pi therefore recorded "pi" in the activity
 * registry while Claude Code did the work. Any non-claude-code provider must
 * be spawned through its own provider.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockJsonRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

const mocks = vi.hoisted(() => ({
  spawnClaude: vi.fn(),
  getProvider: vi.fn(),
  providerSpawn: vi.fn(),
  resolveAgentByNamedId: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/claude/spawn", () => ({ spawnClaude: mocks.spawnClaude }));
vi.mock("@/lib/providers", () => ({ getProvider: mocks.getProvider }));

vi.mock("@/lib/agent-config/agent-resolution", () => ({
  resolveAgentByNamedId: mocks.resolveAgentByNamedId,
}));

vi.mock("@/lib/agent-config/prompts", () => ({
  resolveAgentPrompt: vi.fn(async () => "system prompt"),
}));

vi.mock("@/lib/claude/prompt-builder", () => ({
  buildSpecGenerationPrompt: vi.fn(() => "spec prompt"),
}));

vi.mock("@/lib/sync/export", () => ({ tryExportArjiJson: vi.fn() }));

vi.mock("@/lib/activity-registry", () => ({
  activityRegistry: { register: vi.fn(), unregister: vi.fn(), complete: vi.fn() },
}));

vi.mock("@/lib/documents/mentions", () => ({
  enrichPromptWithDocumentMentions: vi.fn(({ prompt }: { prompt: string }) => ({
    prompt,
    missing: [],
  })),
  userAuthoredTexts: vi.fn(
    (entries: Array<{ role?: string | null; content?: string | null }>) =>
      entries.filter((e) => e.role !== "assistant").map((e) => e.content)
  ),
  MentionResolutionError: class extends Error {},
}));

/** A finished agent run whose output is a plain spec string. */
const SPEC_RESULT = {
  success: true,
  result: "Generated specification body.",
  duration: 10,
};

async function postGenerateSpec() {
  const { POST } = await import(
    "@/app/api/projects/[projectId]/generate-spec/route"
  );
  return POST(
    mockJsonRequest({}),
    mockRouteContext({ projectId: "proj-1" }),
  );
}

describe("generate-spec provider dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
    // project lookup
    dbMockState.getQueue = [{ id: "proj-1", gitRepoPath: "/tmp/repo" }];
    dbMockState.allRows = [];

    mocks.providerSpawn.mockReturnValue({
      handle: "pi-1",
      kill: vi.fn(),
      promise: Promise.resolve(SPEC_RESULT),
    });
    mocks.getProvider.mockReturnValue({ spawn: mocks.providerSpawn });
    mocks.spawnClaude.mockReturnValue({
      promise: Promise.resolve(SPEC_RESULT),
      kill: vi.fn(),
    });
  });

  it("spawns Pi through its own provider, not spawnClaude", async () => {
    mocks.resolveAgentByNamedId.mockReturnValue({
      provider: "pi",
      model: undefined,
      name: "Pi",
      namedAgentId: null,
    });

    await postGenerateSpec();

    expect(mocks.getProvider).toHaveBeenCalledWith("pi");
    expect(mocks.providerSpawn).toHaveBeenCalledTimes(1);
    expect(mocks.spawnClaude).not.toHaveBeenCalled();
  });

  it("spawns Oh My Pi through its own provider", async () => {
    mocks.resolveAgentByNamedId.mockReturnValue({
      provider: "oh-my-pi",
      model: undefined,
      name: "Oh My Pi",
      namedAgentId: null,
    });

    await postGenerateSpec();

    expect(mocks.getProvider).toHaveBeenCalledWith("oh-my-pi");
    expect(mocks.spawnClaude).not.toHaveBeenCalled();
  });

  it("still routes codex through the provider abstraction", async () => {
    mocks.resolveAgentByNamedId.mockReturnValue({
      provider: "codex",
      model: undefined,
      name: "Codex",
      namedAgentId: null,
    });

    await postGenerateSpec();

    expect(mocks.getProvider).toHaveBeenCalledWith("codex");
    expect(mocks.spawnClaude).not.toHaveBeenCalled();
  });

  it("keeps using spawnClaude for claude-code", async () => {
    mocks.resolveAgentByNamedId.mockReturnValue({
      provider: "claude-code",
      model: undefined,
      name: "Claude Code",
      namedAgentId: null,
    });

    await postGenerateSpec();

    expect(mocks.spawnClaude).toHaveBeenCalledTimes(1);
    expect(mocks.getProvider).not.toHaveBeenCalled();
  });
});
