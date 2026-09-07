import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

const { mockSpawn, lastSpawnOptions } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  lastSpawnOptions: { current: null as any },
}));

vi.mock("child_process", () => {
  const execSync = vi.fn();
  return {
    spawn: mockSpawn,
    execSync,
    default: {
      spawn: mockSpawn,
      execSync,
    },
  };
});

// Mock DB for processManager tests
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          get: vi.fn(() => null),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          run: vi.fn(),
        })),
      })),
    })),
  },
  sqlite: {
    transaction: vi.fn((fn: any) => fn),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  agentSessions: { id: "id" },
  settings: { key: "key" },
}));

import { spawnClaude, spawnClaudeStream } from "@/lib/claude/spawn";
import { processManager } from "@/lib/claude/process-manager";
import { waitForProcessCompletion } from "@/lib/agent-sessions/wait-for-completion";
import { signalChild, isChildAlive } from "@/lib/providers/process-signals";

interface FakeChildProcess extends EventEmitter {
  pid: number;
  killed: boolean;
  exitCode: number | null;
  signalCode: string | null;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter & { end: (data?: any) => void };
  kill: (signal?: string) => boolean;
  emitClose: (code?: number, signal?: string | null) => void;
}

function createFakeChild(pid = 4242): FakeChildProcess {
  const emitter = new EventEmitter() as FakeChildProcess;
  emitter.pid = pid;
  emitter.killed = false;
  emitter.exitCode = null;
  emitter.signalCode = null;
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  emitter.stdin = Object.assign(new EventEmitter(), {
    end: vi.fn(),
  });

  emitter.kill = vi.fn(function (this: FakeChildProcess, signal = "SIGTERM") {
    // In Node.js, child.killed becomes true immediately when a signal is delivered
    this.killed = true;
    return true;
  });

  emitter.emitClose = function (code = 0, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("close", code, signal);
  };

  return emitter;
}

describe("claude-code cancellation escalation and process group signaling", () => {
  let fakeChild: FakeChildProcess;
  let killSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    fakeChild = createFakeChild(4242);
    mockSpawn.mockImplementation((_cmd, _args, options) => {
      lastSpawnOptions.current = options;
      return fakeChild;
    });
    killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as any);
  });

  afterEach(() => {
    killSpy.mockRestore();
    vi.useRealTimers();
  });

  describe("spawnClaude", () => {
    it("spawns with detached: true so cancellation can reach the process group", () => {
      spawnClaude({
        mode: "code",
        prompt: "echo hello",
      });

      expect(mockSpawn).toHaveBeenCalled();
      expect(lastSpawnOptions.current).toHaveProperty("detached", true);
    });

    it("signals the process group with -pid on initial cancellation", () => {
      const session = spawnClaude({
        mode: "code",
        prompt: "echo hello",
      });

      session.kill();

      expect(killSpy).toHaveBeenCalledWith(-4242, "SIGTERM");
    });

    it("escalates to SIGKILL against the process group when SIGTERM leaves the process running", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      const session = spawnClaude({
        mode: "code",
        prompt: "echo hello",
      });

      session.kill();
      expect(killSpy).toHaveBeenCalledWith(-4242, "SIGTERM");

      // In Node.js, child.killed is flipped to true upon signal delivery even though
      // the process has not yet exited (exitCode is still null).
      fakeChild.killed = true;
      expect(fakeChild.exitCode).toBeNull();

      // Advance 5 seconds — escalation MUST fire SIGKILL despite child.killed being true
      vi.advanceTimersByTime(5000);

      expect(killSpy).toHaveBeenCalledWith(-4242, "SIGKILL");
    });

    it("does not escalate to SIGKILL if the process exits before the grace period", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      const session = spawnClaude({
        mode: "code",
        prompt: "echo hello",
      });

      session.kill();
      expect(killSpy).toHaveBeenCalledWith(-4242, "SIGTERM");
      killSpy.mockClear();

      // Process exits on SIGTERM before 5s
      fakeChild.emitClose(143, "SIGTERM");

      vi.advanceTimersByTime(5000);

      expect(killSpy).not.toHaveBeenCalledWith(-4242, "SIGKILL");
    });

    it("handles repeated cancel calls safely without duplicating escalations", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      const session = spawnClaude({
        mode: "code",
        prompt: "echo hello",
      });

      session.kill();
      session.kill();

      expect(killSpy).toHaveBeenCalledWith(-4242, "SIGTERM");
      expect(killSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5000);
      expect(killSpy).toHaveBeenCalledWith(-4242, "SIGKILL");
      expect(killSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("spawnClaudeStream", () => {
    it("spawns with detached: true so cancellation can reach the process group", () => {
      spawnClaudeStream({
        mode: "code",
        prompt: "echo hello",
      });

      expect(mockSpawn).toHaveBeenCalled();
      expect(lastSpawnOptions.current).toHaveProperty("detached", true);
    });

    it("signals the process group with -pid on stream cancellation", () => {
      const { kill } = spawnClaudeStream({
        mode: "code",
        prompt: "echo hello",
      });

      kill();

      expect(killSpy).toHaveBeenCalledWith(-4242, "SIGTERM");
    });

    it("escalates to SIGKILL against the process group when SIGTERM leaves the process running", () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      const { kill } = spawnClaudeStream({
        mode: "code",
        prompt: "echo hello",
      });

      kill();
      expect(killSpy).toHaveBeenCalledWith(-4242, "SIGTERM");

      // Advance 5 seconds — escalation MUST fire SIGKILL despite child.killed being true
      vi.advanceTimersByTime(5000);

      expect(killSpy).toHaveBeenCalledWith(-4242, "SIGKILL");
    });
  });

  describe("closure waiting and worktree slot preservation on cancellation", () => {
    it("waitForProcessCompletion does not return while the cancelled process is still alive", async () => {
      const sessionId = "cancel-ordering-test-1";

      processManager.start(
        sessionId,
        { mode: "code", prompt: "echo hello" },
        "claude-code",
      );

      let completionResolved = false;
      const completionPromise = waitForProcessCompletion(sessionId, 50).then((res) => {
        completionResolved = true;
        return res;
      });

      // Give microtasks a cycle to enter the wait loop
      await new Promise((r) => setTimeout(r, 10));

      // Cancel the session
      const cancelled = processManager.cancel(sessionId);
      expect(cancelled).toBe(true);

      // The status is immediately 'cancelled' in memory
      expect(processManager.getStatus(sessionId)?.status).toBe("cancelled");

      // Give time to exceed the 50ms poll interval
      await new Promise((r) => setTimeout(r, 80));

      // CRITICAL ASSERTION: The closure must NOT return yet!
      // In the unfixed code, waitForProcessCompletion sees status === "cancelled"
      // and returns immediately at the first poll (50ms).
      // With the fix, it waits for the underlying process to close.
      expect(completionResolved).toBe(false);

      // Now the child process exits
      fakeChild.emitClose(0);

      // Now completionPromise should settle
      const info = await completionPromise;
      expect(completionResolved).toBe(true);
      expect(info?.status).toBe("cancelled");
    });
  });

  describe("signalChild orchestrator protection and safety guards", () => {
    it("never signals process group when pid <= 0 (protects orchestrator and PID 1)", () => {
      fakeChild.pid = 0;
      signalChild(fakeChild as any, "SIGTERM");
      expect(killSpy).not.toHaveBeenCalled();

      fakeChild.pid = -1;
      signalChild(fakeChild as any, "SIGTERM");
      expect(killSpy).not.toHaveBeenCalled();

      fakeChild.pid = undefined as any;
      signalChild(fakeChild as any, "SIGTERM");
      expect(killSpy).not.toHaveBeenCalled();
    });

    it("does not signal an already-exited child", () => {
      fakeChild.exitCode = 0;
      signalChild(fakeChild as any, "SIGTERM");
      expect(killSpy).not.toHaveBeenCalled();

      fakeChild.exitCode = null;
      fakeChild.signalCode = "SIGTERM";
      signalChild(fakeChild as any, "SIGTERM");
      expect(killSpy).not.toHaveBeenCalled();
    });

    it("falls back to child.kill if process.kill(-pid) fails with non-ESRCH error", () => {
      killSpy.mockImplementationOnce(() => {
        const err = new Error("EPERM") as any;
        err.code = "EPERM";
        throw err;
      });

      signalChild(fakeChild as any, "SIGTERM");
      expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");
    });
  });
});

