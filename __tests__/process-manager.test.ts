import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDbState = vi.hoisted(() => ({
  updateSetCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/db", () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        mockDbState.updateSetCalls.push(payload);
        return {
          where: vi.fn(() => ({
            run: vi.fn(),
          })),
        };
      }),
    })),
  },
}));

vi.mock("@/lib/claude/spawn", () => ({
  spawnClaude: vi.fn(() => ({
    promise: Promise.resolve({
      success: true,
      result: "CC output",
      duration: 500,
      cliSessionId: "cc-cli-1",
    }),
    kill: vi.fn(),
  })),
}));

// claude-code reaches the mocked spawnClaude through the same provider
// registry as every other CLI — there is no claude branch in the manager.
vi.mock("@/lib/providers", async () => {
  const { spawnClaude } = await import("@/lib/claude/spawn");
  const { mockProviderRegistry } = await import(
    "@/__tests__/helpers/provider-mock"
  );
  const createSession = (label: string) => ({
    handle: `${label}-test`,
    kill: vi.fn(),
    promise: Promise.resolve({
      success: true,
      result: `${label} output`,
      duration: 300,
      cliSessionId: `${label}-cli-1`,
    }),
  });
  return mockProviderRegistry(spawnClaude, (provider: string) => ({
    type: provider,
    spawn: vi.fn(() => createSession(provider)),
    cancel: vi.fn(() => true),
    isAvailable: vi.fn().mockResolvedValue(true),
  }));
});

// We need a fresh processManager for each test
let processManager: typeof import("@/lib/claude/process-manager").processManager;

describe("Process Manager", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbState.updateSetCalls = [];
    // Force reimport to get a fresh singleton
    vi.resetModules();
    const mod = await import("@/lib/claude/process-manager");
    processManager = mod.processManager;
  });

  describe("start()", () => {
    it("starts a Claude Code session by default", () => {
      const info = processManager.start("s1", {
        mode: "code",
        prompt: "test",
      });
      expect(info.sessionId).toBe("s1");
      expect(info.status).toBe("running");
      expect(info.provider).toBe("claude-code");
    });

    it("starts a Codex session when provider is codex", () => {
      const info = processManager.start(
        "s2",
        { mode: "code", prompt: "test" },
        "codex",
      );
      expect(info.sessionId).toBe("s2");
      expect(info.status).toBe("running");
      expect(info.provider).toBe("codex");
    });

    it("starts an omp session when provider is oh-my-pi", () => {
      const info = processManager.start(
        "s2-omp",
        { mode: "code", prompt: "test" },
        "oh-my-pi",
      );
      expect(info.sessionId).toBe("s2-omp");
      expect(info.status).toBe("running");
      expect(info.provider).toBe("oh-my-pi");
    });

    it("throws if session is already running", () => {
      processManager.start("s3", { mode: "code", prompt: "test" });
      expect(() =>
        processManager.start("s3", { mode: "code", prompt: "test" }),
      ).toThrow("already running");
    });
  });

  describe("cancel()", () => {
    it("cancels a running CC session", () => {
      processManager.start("s4", { mode: "code", prompt: "test" });
      const result = processManager.cancel("s4");
      expect(result).toBe(true);
      const info = processManager.getStatus("s4");
      expect(info?.status).toBe("cancelled");
    });

    it("cancels a running Codex session", () => {
      processManager.start("s5", { mode: "code", prompt: "test" }, "codex");
      const result = processManager.cancel("s5");
      expect(result).toBe(true);
      const info = processManager.getStatus("s5");
      expect(info?.status).toBe("cancelled");
    });

    it("returns false for unknown session", () => {
      expect(processManager.cancel("unknown")).toBe(false);
    });

    it("returns false for already completed session", () => {
      processManager.start("s6", { mode: "code", prompt: "test" });
      processManager.cancel("s6");
      // Try to cancel again
      expect(processManager.cancel("s6")).toBe(false);
    });
  });

  describe("getStatus()", () => {
    it("returns null for unknown session", () => {
      expect(processManager.getStatus("unknown")).toBeNull();
    });

    it("returns session info with provider field", () => {
      processManager.start("s7", { mode: "code", prompt: "test" });
      const info = processManager.getStatus("s7");
      expect(info).not.toBeNull();
      expect(info!.provider).toBe("claude-code");
      expect(info!.startedAt).toBeInstanceOf(Date);
    });

    it("persists cliSessionId on completion", async () => {
      processManager.start("s7-cli", { mode: "code", prompt: "test" });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockDbState.updateSetCalls).toContainEqual({
        cliSessionId: "cc-cli-1",
      });
    });
  });

  describe("listActive()", () => {
    it("lists all running sessions", () => {
      processManager.start("cc1", { mode: "code", prompt: "test" });
      processManager.start("codex1", { mode: "code", prompt: "test" }, "codex");
      const active = processManager.listActive();
      expect(active.length).toBe(2);
      const providers = active.map((a) => a.provider);
      expect(providers).toContain("claude-code");
      expect(providers).toContain("codex");
    });

    it("excludes cancelled sessions", () => {
      processManager.start("cc2", { mode: "code", prompt: "test" });
      processManager.cancel("cc2");
      expect(processManager.listActive().length).toBe(0);
    });
  });

  describe("listAll()", () => {
    it("includes both running and cancelled sessions", () => {
      processManager.start("a1", { mode: "code", prompt: "test" });
      processManager.start("a2", { mode: "code", prompt: "test" }, "codex");
      processManager.cancel("a1");
      const all = processManager.listAll();
      expect(all.length).toBe(2);
    });
  });

  describe("remove()", () => {
    it("removes a cancelled session", () => {
      processManager.start("r1", { mode: "code", prompt: "test" });
      processManager.cancel("r1");
      expect(processManager.remove("r1")).toBe(true);
      expect(processManager.getStatus("r1")).toBeNull();
    });

    it("cannot remove a running session", () => {
      processManager.start("r2", { mode: "code", prompt: "test" });
      expect(processManager.remove("r2")).toBe(false);
    });
  });

  describe("activeCount", () => {
    it("counts running sessions across providers", () => {
      processManager.start("c1", { mode: "code", prompt: "test" });
      processManager.start("c2", { mode: "code", prompt: "test" }, "codex");
      expect(processManager.activeCount).toBe(2);
      processManager.cancel("c1");
      expect(processManager.activeCount).toBe(1);
    });
  });

  describe("provider registry", () => {
    it("spawns claude-code through getProvider, like every other provider", async () => {
      const { getProvider } = await import("@/lib/providers");
      const { spawnClaude } = await import("@/lib/claude/spawn");
      processManager.start("g1", { mode: "code", prompt: "test" });
      processManager.start("g2", { mode: "code", prompt: "test" }, "codex");
      expect(getProvider).toHaveBeenCalledWith("claude-code");
      expect(getProvider).toHaveBeenCalledWith("codex");
      // The registry's claude-code entry is what wraps spawnClaude.
      expect(spawnClaude).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The map used to keep every session for the life of the server — prompt
   * and result included — with remove() called by nothing but tests.
   */
  describe("eviction of terminal sessions", () => {
    const flush = () => new Promise((r) => setImmediate(r));

    it("forgets a completed session after the retention period, keeping it until then", async () => {
      // Timers only: promises and setImmediate stay real so the spawn
      // promise settles and `flush()` returns.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const { TERMINAL_SESSION_RETENTION_MS } = await import(
          "@/lib/claude/process-manager"
        );
        processManager.start("e1", { mode: "code", prompt: "a long prompt" });
        await flush();
        expect(processManager.getStatus("e1")?.status).toBe("completed");
        expect(processManager.isProcessClosed("e1")).toBe(true);

        // Still readable by anything polling right after the close.
        vi.advanceTimersByTime(TERMINAL_SESSION_RETENTION_MS - 1);
        expect(processManager.getStatus("e1")?.status).toBe("completed");

        vi.advanceTimersByTime(2);
        expect(processManager.getStatus("e1")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not evict a session re-dispatched under the same id", async () => {
      // Timers only: promises and setImmediate stay real so the spawn
      // promise settles and `flush()` returns.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const { TERMINAL_SESSION_RETENTION_MS } = await import(
          "@/lib/claude/process-manager"
        );
        processManager.start("e2", { mode: "code", prompt: "first" });
        await flush();
        expect(processManager.getStatus("e2")?.status).toBe("completed");

        // A retry ladder re-dispatches under the same session id; the
        // previous run's timer must not take the new run down with it.
        const { getProvider } = await import("@/lib/providers");
        vi.mocked(getProvider).mockReturnValueOnce({
          type: "claude-code",
          spawn: vi.fn(() => ({
            handle: "cc-e2",
            kill: vi.fn(),
            promise: new Promise(() => {}),
          })),
          cancel: vi.fn(() => true),
          isAvailable: vi.fn().mockResolvedValue(true),
        } as never);
        processManager.start("e2", { mode: "code", prompt: "second" });
        expect(processManager.getStatus("e2")?.status).toBe("running");

        vi.advanceTimersByTime(TERMINAL_SESSION_RETENTION_MS + 1);
        expect(processManager.getStatus("e2")?.status).toBe("running");
      } finally {
        vi.useRealTimers();
      }
    });

    it("gives a completed retry its own full retention period", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const { TERMINAL_SESSION_RETENTION_MS } = await import("@/lib/claude/process-manager");
        processManager.start("retained-retry", { mode: "code", prompt: "first" });
        await flush();
        vi.advanceTimersByTime(1000);
        processManager.start("retained-retry", { mode: "code", prompt: "retry" });
        await flush();
        vi.advanceTimersByTime(TERMINAL_SESSION_RETENTION_MS - 1000);
        expect(processManager.getStatus("retained-retry")?.status).toBe("completed");
        vi.advanceTimersByTime(1000);
        expect(processManager.getStatus("retained-retry")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps the count of tracked sessions bounded across many runs", async () => {
      // Timers only: promises and setImmediate stay real so the spawn
      // promise settles and `flush()` returns.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        const { TERMINAL_SESSION_RETENTION_MS } = await import(
          "@/lib/claude/process-manager"
        );
        for (let i = 0; i < 25; i++) {
          processManager.start(`b${i}`, { mode: "code", prompt: `p${i}` });
        }
        await flush();
        expect(processManager.listAll()).toHaveLength(25);
        vi.advanceTimersByTime(TERMINAL_SESSION_RETENTION_MS + 1);
        expect(processManager.listAll()).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
