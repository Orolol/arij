import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock("child_process", () => {
  const execSync = vi.fn();
  return {
    spawn: mockSpawn,
    execSync,
    default: { spawn: mockSpawn, execSync },
  };
});

// Mock fs to avoid touching the codex -o temp file
vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn(() => {
      throw new Error("ENOENT");
    }),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

import { CodexProvider } from "@/lib/providers/codex";
import { CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS } from "@/lib/codex/constants";
import type { ProviderSpawnOptions } from "@/lib/providers/types";
import { createFakeChild, type FakeChild } from "./helpers/fake-child";

/** Fake child process whose stdout/stderr/exit events tests can drive. */
function baseOptions(overrides: Partial<ProviderSpawnOptions> = {}): ProviderSpawnOptions {
  return {
    sessionId: "test-session",
    prompt: "implement feature",
    cwd: "/tmp/test",
    mode: "code",
    ...overrides,
  };
}

let fakeChild: FakeChild;

beforeEach(() => {
  vi.clearAllMocks();
  fakeChild = createFakeChild();
  mockSpawn.mockImplementation(() => fakeChild);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CodexProvider.spawn", () => {
  it("passes CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS to the codex CLI", () => {
    const provider = new CodexProvider();
    provider.spawn(baseOptions());

    expect(mockSpawn).toHaveBeenCalledOnce();
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args).toContain(
      `developer_instructions=${JSON.stringify(CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS)}`
    );
    expect(args[args.indexOf("-c") + 1]).toContain("developer_instructions=");
  });

  it("ignores resumeSession — codex is excluded from every resume path", () => {
    const provider = new CodexProvider();
    provider.spawn(
      baseOptions({
        prompt: "continue working",
        cliSessionId: "cli-abc-123",
        resumeSession: true,
      })
    );

    expect(mockSpawn).toHaveBeenCalledOnce();
    expect(mockSpawn.mock.calls[0][0]).toBe("codex");
    const args = mockSpawn.mock.calls[0][1] as string[];
    // The `exec resume <ID>` branch is gone: codex never reports its thread
    // id, so `isResumableProvider` excludes it and this argv cannot be built
    // from any dispatch path. A plain exec is what comes out.
    expect(args[0]).toBe("exec");
    expect(args).not.toContain("resume");
    expect(args).not.toContain("cli-abc-123");
    expect(args[args.length - 1]).toBe("continue working");
  });

  it("uses a fresh exec with -C/-o/--color when resume params are not provided", () => {
    const provider = new CodexProvider();
    provider.spawn(baseOptions({ prompt: "fresh start" }));

    expect(mockSpawn).toHaveBeenCalledOnce();
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args[0]).toBe("exec");
    expect(args[1]).not.toBe("resume");
    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(args[args.indexOf("-C") + 1]).toBe("/tmp/test");
    expect(args).toContain("--skip-git-repo-check");
    expect(args[args.indexOf("-o") + 1]).toMatch(/codex-out-.*\.txt$/);
    expect(args[args.indexOf("--color") + 1]).toBe("never");
    expect(args[args.length - 1]).toBe("fresh start");
  });

  it("still passes all other options through", () => {
    const provider = new CodexProvider();
    provider.spawn(
      baseOptions({ model: "gpt-5.3-codex" })
    );

    expect(mockSpawn).toHaveBeenCalledOnce();
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args[args.indexOf("-m") + 1]).toBe("gpt-5.3-codex");
    expect(args[args.length - 1]).toBe("implement feature");
    // Spawn cwd comes from options
    expect(mockSpawn.mock.calls[0][2]).toMatchObject({ cwd: "/tmp/test" });
  });

  it("returns a session with codex-<sessionId> handle and redacted command", () => {
    const provider = new CodexProvider();
    const longPrompt = "x".repeat(60);
    const session = provider.spawn(baseOptions({ prompt: longPrompt }));

    expect(session.handle).toBe("codex-test-session");
    expect(session.command).toContain("codex exec");
    expect(session.command).toContain("<prompt>");
    expect(session.command).not.toContain(longPrompt);
  });
});

describe("CodexProvider exit handling", () => {
  it("maps stream-disconnect output to an actionable error", async () => {
    const provider = new CodexProvider();
    const session = provider.spawn(baseOptions());

    fakeChild.emitStderr("Reconnecting... 2/5");
    fakeChild.emitClose(1);

    const result = await session.promise;
    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Codex API connection failed (stream disconnected). " +
        "Check your network and ChatGPT subscription, or try again later."
    );
  });

  it("maps not-logged-in output to an auth error", async () => {
    const provider = new CodexProvider();
    const session = provider.spawn(baseOptions());

    fakeChild.emitStderr("Error: not logged in");
    fakeChild.emitClose(1);

    const result = await session.promise;
    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Codex CLI is not authenticated. Run `codex login` in your terminal."
    );
  });

  it("falls back to stderr, then to the exit-code message", async () => {
    const provider = new CodexProvider();
    const first = provider.spawn(baseOptions());
    fakeChild.emitStderr("something broke");
    fakeChild.emitClose(2);
    expect((await first.promise).error).toBe("something broke");

    fakeChild = createFakeChild();
    const second = provider.spawn(baseOptions());
    fakeChild.emitClose(2);
    expect((await second.promise).error).toBe("Codex CLI exited with code 2");
  });

  it("maps ENOENT to the codex install hint", async () => {
    const provider = new CodexProvider();
    const session = provider.spawn(baseOptions());

    fakeChild.emitError(new Error("spawn codex ENOENT"));

    const result = await session.promise;
    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Codex CLI not found. Install it with: npm i -g @openai/codex"
    );
  });

  it("resolves success with stdout output and no cliSessionId", async () => {
    const provider = new CodexProvider();
    const session = provider.spawn(baseOptions());

    fakeChild.emitStdout("Codex output");
    fakeChild.emitClose(0);

    const result = await session.promise;
    expect(result.success).toBe(true);
    expect(result.result).toBe("Codex output");
    expect(result.cliSessionId).toBeUndefined();
    expect(result.endedWithQuestion).toBe(false);
  });

  it("reports cancellation when killed before close", async () => {
    // Fake setTimeout so the 5s SIGKILL escalation timer never lingers
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    // Never signal a real process group from a test: the fake child's pid is
    // made up. The liveness probe answers "alive", the group signal answers
    // ESRCH, so the cancel falls back to the child handle.
    vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      const alive = fakeChild.exitCode === null && fakeChild.signalCode === null;
      if (signal === 0 && alive) return true;
      const error = new Error("ESRCH") as NodeJS.ErrnoException;
      error.code = "ESRCH";
      throw error;
    });
    try {
      const provider = new CodexProvider();
      const session = provider.spawn(baseOptions());

      session.kill();
      expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");

      // The child dies on SIGTERM: the close handler's teardown wait sees a
      // signalled handle and a gone group, and resolves at once.
      fakeChild.signalCode = "SIGTERM";
      fakeChild.emitClose(null);
      const result = await session.promise;
      expect(result.success).toBe(false);
      expect(result.error).toBe("Process was cancelled.");
    } finally {
      vi.useRealTimers();
    }
  });
});
