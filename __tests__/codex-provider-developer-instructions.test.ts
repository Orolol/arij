import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSpawnCodex } = vi.hoisted(() => ({
  mockSpawnCodex: vi.fn(),
}));

vi.mock("@/lib/codex/spawn", () => ({
  spawnCodex: mockSpawnCodex,
}));

vi.mock("child_process", () => {
  const execSync = vi.fn();
  return {
    execSync,
    default: { execSync },
  };
});

import { CodexProvider } from "@/lib/providers/codex";
import { CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS } from "@/lib/codex/constants";

describe("CodexProvider.spawn", () => {
  beforeEach(() => {
    mockSpawnCodex.mockClear();
    mockSpawnCodex.mockReturnValue({
      promise: Promise.resolve({ success: true, result: "", duration: 100 }),
      kill: vi.fn(),
      command: "codex exec ...",
    });
  });

  it("passes CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS to spawnCodex", () => {
    const provider = new CodexProvider();
    provider.spawn({
      sessionId: "test-session",
      prompt: "implement feature",
      cwd: "/tmp/test",
      mode: "code",
    });

    expect(mockSpawnCodex).toHaveBeenCalledOnce();
    const opts = mockSpawnCodex.mock.calls[0][0];
    expect(opts.developerInstructions).toBe(CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS);
  });

  it("still passes all other options through", () => {
    const provider = new CodexProvider();
    provider.spawn({
      sessionId: "test-session",
      prompt: "implement feature",
      cwd: "/tmp/test",
      mode: "code",
      model: "gpt-5.3-codex",
      logIdentifier: "test-log",
    });

    expect(mockSpawnCodex).toHaveBeenCalledOnce();
    const opts = mockSpawnCodex.mock.calls[0][0];
    expect(opts.prompt).toBe("implement feature");
    expect(opts.mode).toBe("code");
    expect(opts.model).toBe("gpt-5.3-codex");
    expect(opts.logIdentifier).toBe("test-log");
    expect(opts.developerInstructions).toBe(CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS);
  });
});
