import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { EventEmitter } from "events";
import type { SpawnOptions, ChildProcess } from "child_process";

const { mockSpawn, lastSpawnOptions } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  lastSpawnOptions: { current: null as SpawnOptions | null },
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

// Mock DB for processManager and stage-guards tests
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => []),
            all: vi.fn(() => []),
            get: vi.fn(() => null),
          })),
          get: vi.fn(() => null),
          all: vi.fn(() => []),
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
    transaction: vi.fn(<T>(fn: () => T): T => fn()),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  agentSessions: {
    id: "id",
    projectId: "projectId",
    epicId: "epicId",
    userStoryId: "userStoryId",
    status: "status",
    createdAt: "createdAt",
  },
  settings: { key: "key" },
  epics: { id: "id", status: "status" },
  userStories: { id: "id", status: "status" },
}));

import { spawnClaude, spawnClaudeStream } from "@/lib/claude/spawn";
import { processManager } from "@/lib/claude/process-manager";
import { waitForProcessCompletion } from "@/lib/agent-sessions/wait-for-completion";
import { signalChild, isChildAlive } from "@/lib/providers/process-signals";
import { getRunningSessionForTarget } from "@/lib/agents/concurrency";
import { checkPipelineGuards } from "@/lib/pipeline/stage-guards";

interface FakeChildProcess extends EventEmitter {
  pid: number;
  killed: boolean;
  exitCode: number | null;
  signalCode: string | null;
  groupAlive: boolean;
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: EventEmitter & { end: (data?: unknown) => void };
  kill: (signal?: string) => boolean;
  emitClose: (code?: number, signal?: string | null) => void;
}

function toChildProcess(fake: FakeChildProcess): ChildProcess {
  return fake as unknown as ChildProcess;
}

function createFakeChild(pid = 4242): FakeChildProcess {
  const emitter = new EventEmitter() as FakeChildProcess;
  emitter.pid = pid;
  emitter.killed = false;
  emitter.exitCode = null;
  emitter.signalCode = null;
  emitter.groupAlive = true;
  emitter.stdout = new EventEmitter();
  emitter.stderr = new EventEmitter();
  emitter.stdin = Object.assign(new EventEmitter(), {
    end: vi.fn(),
  });

  emitter.kill = vi.fn(function (this: FakeChildProcess, _signal = "SIGTERM") {
    // In Node.js, child.killed becomes true immediately when a signal is delivered
    this.killed = true;
    return true;
  });

  emitter.emitClose = function (code = 0, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.groupAlive = false;
    this.emit("close", code, signal);
  };

  return emitter;
}

describe("claude-code cancellation escalation and process group signaling", () => {
  let fakeChild: FakeChildProcess;
  let killSpy: MockInstance<typeof process.kill>;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.clearAllMocks();
    fakeChild = createFakeChild(4242);
    mockSpawn.mockImplementation((_cmd, _args, options) => {
      lastSpawnOptions.current = options as SpawnOptions;
      return fakeChild;
    });
    killSpy = vi.spyOn(process, "kill").mockImplementation(((
      targetPid: number,
      signal?: string | number
    ) => {
      if (signal === 0) {
        if (!fakeChild.groupAlive || (targetPid === -fakeChild.pid && fakeChild.exitCode !== null && !fakeChild.groupAlive)) {
          const err = new Error("ESRCH") as NodeJS.ErrnoException;
          err.code = "ESRCH";
          throw err;
        }
        return true;
      }
      if (signal === "SIGKILL") {
        fakeChild.groupAlive = false;
      }
      return true;
    }) as typeof process.kill);
  });

  afterEach(() => {
    // Ensure no pending cancellation timer survives into the real process
    fakeChild.emitClose(0);
    vi.clearAllTimers();
    vi.useRealTimers();
    killSpy.mockRestore();
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

    it("escalates to SIGKILL against the process group when leader exited on SIGTERM but descendants survive", () => {
      const session = spawnClaude({
        mode: "code",
        prompt: "echo hello",
      });

      session.kill();
      expect(killSpy).toHaveBeenCalledWith(-4242, "SIGTERM");
      killSpy.mockClear();

      // Leader exited on SIGTERM, but descendants in the process group are still alive
      fakeChild.exitCode = 0;
      fakeChild.signalCode = "SIGTERM";
      fakeChild.groupAlive = true;

      // Advance 5 seconds — escalation MUST still fire SIGKILL to the process group
      vi.advanceTimersByTime(5000);

      expect(killSpy).toHaveBeenCalledWith(-4242, "SIGKILL");
    });

    it("does not escalate to SIGKILL if the process exits before the grace period", () => {
      const session = spawnClaude({
        mode: "code",
        prompt: "echo hello",
      });

      session.kill();
      expect(killSpy).toHaveBeenCalledWith(-4242, "SIGTERM");
      killSpy.mockClear();

      // Process and its group exit on SIGTERM before 5s
      fakeChild.emitClose(143, "SIGTERM");

      vi.advanceTimersByTime(5000);

      expect(killSpy).not.toHaveBeenCalledWith(-4242, "SIGKILL");
    });

    it("handles repeated cancel calls safely without duplicating escalations", () => {
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

      // Advance fake timers a tick so wait loop begins
      await vi.advanceTimersByTimeAsync(10);

      // Cancel the session
      const cancelled = processManager.cancel(sessionId);
      expect(cancelled).toBe(true);

      // The status is immediately 'cancelled' in memory
      expect(processManager.getStatus(sessionId)?.status).toBe("cancelled");

      // Advance time past poll interval
      await vi.advanceTimersByTimeAsync(80);

      // CRITICAL ASSERTION: The closure must NOT return yet!
      // In the unfixed code, waitForProcessCompletion sees status === "cancelled"
      // and returns immediately at the first poll (50ms).
      // With the fix, it waits for the underlying process to close.
      expect(completionResolved).toBe(false);

      // Now the child process exits
      fakeChild.emitClose(0);

      // Advance microtasks / timer so close promise settles
      await vi.advanceTimersByTimeAsync(10);

      // Now completionPromise should settle
      const info = await completionPromise;
      expect(completionResolved).toBe(true);
      expect(info?.status).toBe("cancelled");
    });
  });

  describe("DELETE-to-Full-Auto redispatch admission guard", () => {
    it("blocks Full Auto redispatch after session cancellation until child process has closed", async () => {
      const sessionId = "delete-to-auto-redispatch-test";
      const projectId = "proj-cancel-guard";
      const epicId = "epic-cancel-guard";

      processManager.start(
        sessionId,
        { mode: "code", prompt: "echo hello", cwd: "/tmp/fake-worktree" },
        "claude-code",
      );

      // Set target metadata on tracked session
      const tracked = (processManager as unknown as { sessions: Map<string, { projectId?: string; epicId?: string }> }).sessions.get(sessionId);
      if (tracked) {
        tracked.projectId = projectId;
        tracked.epicId = epicId;
      }

      // Simulate request-time cancellation: DELETE route calls cancel
      const cancelled = processManager.cancel(sessionId);
      expect(cancelled).toBe(true);
      expect(processManager.getStatus(sessionId)?.status).toBe("cancelled");

      // While process has not completed teardown (processClosed !== true):
      expect(processManager.isProcessClosed(sessionId)).toBe(false);

      // 1. loadAutoModeBoard marks the epic as busy through listOccupyingSessions
      const occupyingList = processManager.listOccupyingSessions(projectId);
      expect(occupyingList.some((s) => s.sessionId === sessionId)).toBe(true);

      // 2. getRunningSessionForTarget refuses admission for the epic
      const targetConflict = getRunningSessionForTarget({
        scope: "epic",
        projectId,
        epicId,
      });
      expect(targetConflict).not.toBeNull();
      expect(targetConflict?.id).toBe(sessionId);

      // 3. checkPipelineGuards reports conflictSessionId
      const guard = checkPipelineGuards(
        {
          projectId,
          scope: "epic",
          epicId,
          userStoryId: null,
          buildNamedAgentId: null,
        },
        []
      );
      expect(guard.conflictSessionId).toBe(sessionId);

      // Now the underlying child process finishes closing and teardown completes
      fakeChild.emitClose(0);
      await vi.advanceTimersByTimeAsync(10);
      expect(processManager.isProcessClosed(sessionId)).toBe(true);

      // After close, the target is no longer occupied and redispatch is permitted
      expect(
        getRunningSessionForTarget({
          scope: "epic",
          projectId,
          epicId,
        })
      ).toBeNull();
      expect(
        processManager.listOccupyingSessions(projectId).some((s) => s.sessionId === sessionId)
      ).toBe(false);

      const guardAfterClose = checkPipelineGuards(
        {
          projectId,
          scope: "epic",
          epicId,
          userStoryId: null,
          buildNamedAgentId: null,
        },
        []
      );
      expect(guardAfterClose.conflictSessionId).toBeNull();
    });
  });

  describe("signalChild orchestrator protection and safety guards", () => {
    it("never signals process group when pid <= 0 (protects orchestrator and PID 1)", () => {
      fakeChild.pid = 0;
      signalChild(toChildProcess(fakeChild), "SIGTERM");
      expect(killSpy).not.toHaveBeenCalled();

      fakeChild.pid = -1;
      signalChild(toChildProcess(fakeChild), "SIGTERM");
      expect(killSpy).not.toHaveBeenCalled();

      fakeChild.pid = undefined as unknown as number;
      signalChild(toChildProcess(fakeChild), "SIGTERM");
      expect(killSpy).not.toHaveBeenCalled();
    });

    it("does not signal an already-exited child when group is also dead", () => {
      fakeChild.exitCode = 0;
      fakeChild.groupAlive = false;
      signalChild(toChildProcess(fakeChild), "SIGTERM");
      expect(killSpy).not.toHaveBeenCalledWith(-4242, "SIGTERM");
      expect(fakeChild.kill).not.toHaveBeenCalled();

      fakeChild.exitCode = null;
      fakeChild.signalCode = "SIGTERM";
      fakeChild.groupAlive = false;
      signalChild(toChildProcess(fakeChild), "SIGTERM");
      expect(killSpy).not.toHaveBeenCalledWith(-4242, "SIGTERM");
      expect(fakeChild.kill).not.toHaveBeenCalled();
    });

    it("falls back to child.kill if process.kill(-pid) fails with non-ESRCH error", () => {
      killSpy.mockImplementationOnce(() => {
        const err = new Error("EPERM") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      });

      signalChild(toChildProcess(fakeChild), "SIGTERM");
      expect(fakeChild.kill).toHaveBeenCalledWith("SIGTERM");
    });
  });
});

