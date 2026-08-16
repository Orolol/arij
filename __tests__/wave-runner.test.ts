/**
 * Tests for the DAG wave execution engine (lib/dependencies/wave-runner.ts):
 * layer ordering, blocking semantics (failed / asked_question), halt vs stop
 * failure policies, and composition with the real AgentScheduler at budget 1.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

import {
  runExecutionWaves,
  countPlanStatuses,
  type WaveLaunchHandle,
  type WaveTicketResult,
  type WaveSkippedTicket,
} from "@/lib/dependencies/wave-runner";
import type {
  BatchExecutionPlan,
  TicketExecutionStatus,
} from "@/lib/dependencies/scheduler";
import { AgentScheduler } from "@/lib/agents/scheduler";

function makePlan(layers: string[][]): BatchExecutionPlan {
  const ticketStatus = new Map<string, TicketExecutionStatus>();
  for (const layer of layers) {
    for (const id of layer) {
      ticketStatus.set(id, "pending");
    }
  }
  return { layers, ticketStatus, failureReasons: new Map() };
}

/** Edges as [ticket, dependsOn] pairs -> predecessor adjacency. */
function graphOf(edges: Array<[string, string]>): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const [ticket, dependsOn] of edges) {
    if (!graph.has(ticket)) graph.set(ticket, new Set());
    graph.get(ticket)!.add(dependsOn);
  }
  return graph;
}

interface FakeOutcome {
  success?: boolean;
  outcome?: string;
  error?: string | null;
}

/** Launcher whose sessions settle immediately with the given outcomes. */
function instantLauncher(
  outcomes: Record<string, FakeOutcome>,
  log: string[]
) {
  return async (epicId: string): Promise<WaveLaunchHandle | null> => {
    log.push(`launch:${epicId}`);
    const fake = outcomes[epicId] ?? {};
    const result: WaveTicketResult = {
      epicId,
      sessionId: `s-${epicId}`,
      success: fake.success ?? true,
      outcome: fake.outcome ?? "answered",
      error: fake.error ?? null,
    };
    return { sessionId: `s-${epicId}`, settled: Promise.resolve(result) };
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("runExecutionWaves — ordering", () => {
  it("launches dependencies before dependents: wave N+1 starts only after ALL of wave N settled", async () => {
    const plan = makePlan([["a", "b"], ["c"]]);
    const graph = graphOf([
      ["c", "a"],
      ["c", "b"],
    ]);
    const log: string[] = [];

    const settlers = new Map<string, (r: WaveTicketResult) => void>();
    const launch = async (epicId: string): Promise<WaveLaunchHandle> => {
      log.push(`launch:${epicId}`);
      const settled = new Promise<WaveTicketResult>((resolve) => {
        settlers.set(epicId, resolve);
      });
      return { sessionId: `s-${epicId}`, settled };
    };

    const run = runExecutionWaves({
      plan,
      graph,
      failurePolicy: "halt",
      launch,
    });

    await flush();
    expect(log).toEqual(["launch:a", "launch:b"]);

    // First wave only half settled — the second wave must keep waiting.
    settlers.get("a")!({
      epicId: "a",
      sessionId: "s-a",
      success: true,
      outcome: "answered",
      error: null,
    });
    await flush();
    expect(log).toEqual(["launch:a", "launch:b"]);

    settlers.get("b")!({
      epicId: "b",
      sessionId: "s-b",
      success: true,
      outcome: "answered",
      error: null,
    });
    await flush();
    expect(log).toEqual(["launch:a", "launch:b", "launch:c"]);

    settlers.get("c")!({
      epicId: "c",
      sessionId: "s-c",
      success: true,
      outcome: "answered",
      error: null,
    });

    const summary = await run;
    expect(summary.totalWaves).toBe(2);
    expect(summary.wavesExecuted).toBe(2);
    expect(summary.stoppedAtWave).toBeNull();
    expect(summary.skipped).toEqual([]);
    expect(plan.ticketStatus.get("a")).toBe("done");
    expect(plan.ticketStatus.get("c")).toBe("done");
  });

  it("reports wave lifecycle through callbacks in order", async () => {
    const plan = makePlan([["a"], ["b"]]);
    const graph = graphOf([["b", "a"]]);
    const log: string[] = [];
    const events: string[] = [];

    await runExecutionWaves({
      plan,
      graph,
      failurePolicy: "halt",
      launch: instantLauncher({}, log),
      callbacks: {
        onWaveStart: (wave, total, epicIds) =>
          events.push(`start:${wave}/${total}:${epicIds.join(",")}`),
        onWaveLaunched: (wave, sessionIds) =>
          events.push(`launched:${wave}:${sessionIds.join(",")}`),
        onWaveSettled: (wave, results) =>
          events.push(`settled:${wave}:${results.length}`),
        onFinish: (summary) =>
          events.push(`finish:${summary.wavesExecuted}`),
      },
    });

    expect(events).toEqual([
      "start:1/2:a",
      "launched:1:s-a",
      "settled:1:1",
      "start:2/2:b",
      "launched:2:s-b",
      "settled:2:1",
      "finish:2",
    ]);
  });
});

describe("runExecutionWaves — blocking", () => {
  it("a failed epic skips its transitive dependents but not independent branches (halt)", async () => {
    // a -> b -> c chain, d independent (placed in wave 2 by the planner).
    const plan = makePlan([["a"], ["b", "d"], ["c"]]);
    const graph = graphOf([
      ["b", "a"],
      ["c", "b"],
    ]);
    const log: string[] = [];
    const skips: WaveSkippedTicket[] = [];

    const summary = await runExecutionWaves({
      plan,
      graph,
      failurePolicy: "halt",
      launch: instantLauncher(
        { a: { success: false, outcome: "error", error: "boom" } },
        log
      ),
      callbacks: { onSkip: (skip) => skips.push(skip) },
    });

    // b and c never launch; the independent branch d still does.
    expect(log).toEqual(["launch:a", "launch:d"]);
    expect(plan.ticketStatus.get("a")).toBe("failed");
    expect(plan.ticketStatus.get("b")).toBe("skipped");
    expect(plan.ticketStatus.get("c")).toBe("skipped");
    expect(plan.ticketStatus.get("d")).toBe("done");
    expect(plan.failureReasons.get("a")).toBe("boom");
    expect(plan.failureReasons.get("b")).toContain("dependency a failed");

    expect(skips).toHaveLength(2);
    for (const skip of skips) {
      expect(skip.kind).toBe("failed");
      expect(skip.blockedById).toBe("a");
      expect(skip.blockedBySessionId).toBe("s-a");
      expect(skip.wave).toBe(1);
    }
    expect(new Set(skips.map((s) => s.epicId))).toEqual(new Set(["b", "c"]));
    expect(summary.stoppedAtWave).toBeNull();
    expect(countPlanStatuses(plan)).toEqual({
      pending: 0,
      running: 0,
      done: 1,
      asked: 0,
      failed: 1,
      skipped: 2,
    });
  });

  it("asked_question blocks dependents exactly like a failure", async () => {
    const plan = makePlan([["a"], ["b"]]);
    const graph = graphOf([["b", "a"]]);
    const log: string[] = [];
    const skips: WaveSkippedTicket[] = [];
    const blockedWaves: Array<{ wave: number; blocked: WaveTicketResult[] }> =
      [];

    await runExecutionWaves({
      plan,
      graph,
      failurePolicy: "halt",
      launch: instantLauncher(
        { a: { success: true, outcome: "asked_question" } },
        log
      ),
      callbacks: {
        onSkip: (skip) => skips.push(skip),
        onWaveBlocked: (wave, blocked) => blockedWaves.push({ wave, blocked }),
      },
    });

    expect(log).toEqual(["launch:a"]);
    expect(plan.ticketStatus.get("a")).toBe("asked");
    expect(plan.ticketStatus.get("b")).toBe("skipped");
    expect(skips).toEqual([
      {
        epicId: "b",
        kind: "asked_question",
        blockedById: "a",
        blockedBySessionId: "s-a",
        wave: 1,
      },
    ]);
    expect(blockedWaves).toHaveLength(1);
    expect(blockedWaves[0].wave).toBe(1);
    expect(blockedWaves[0].blocked.map((b) => b.epicId)).toEqual(["a"]);
  });

  it("a throwing launcher counts as a failed epic (no session) and skips dependents", async () => {
    const plan = makePlan([["a"], ["b"]]);
    const graph = graphOf([["b", "a"]]);

    const summary = await runExecutionWaves({
      plan,
      graph,
      failurePolicy: "halt",
      launch: async (epicId) => {
        if (epicId === "a") throw new Error("worktree exploded");
        return instantLauncher({}, [])(epicId);
      },
    });

    const aResult = summary.results.find((r) => r.epicId === "a")!;
    expect(aResult.success).toBe(false);
    expect(aResult.sessionId).toBeNull();
    expect(aResult.error).toBe("worktree exploded");
    expect(plan.ticketStatus.get("b")).toBe("skipped");
  });

  it("a null launch (epic vanished) counts as a failed epic", async () => {
    const plan = makePlan([["a"]]);

    const summary = await runExecutionWaves({
      plan,
      graph: new Map(),
      failurePolicy: "halt",
      launch: async () => null,
    });

    expect(summary.results[0].success).toBe(false);
    expect(summary.results[0].error).toContain("not found");
    expect(plan.ticketStatus.get("a")).toBe("failed");
  });
});

describe("runExecutionWaves — failure policies", () => {
  it("halt (default) keeps building independent epics after a failure", async () => {
    const plan = makePlan([["a"], ["d"]]);
    const log: string[] = [];

    const summary = await runExecutionWaves({
      plan,
      graph: new Map(), // d does not depend on a
      failurePolicy: "halt",
      launch: instantLauncher(
        { a: { success: false, outcome: "error", error: "boom" } },
        log
      ),
    });

    expect(log).toEqual(["launch:a", "launch:d"]);
    expect(plan.ticketStatus.get("d")).toBe("done");
    expect(summary.stoppedAtWave).toBeNull();
  });

  it("stop abandons all remaining waves, marking un-launched epics skipped", async () => {
    const plan = makePlan([["a"], ["d"], ["e"]]);
    const log: string[] = [];
    const skips: WaveSkippedTicket[] = [];

    const summary = await runExecutionWaves({
      plan,
      graph: new Map(),
      failurePolicy: "stop",
      launch: instantLauncher(
        { a: { success: false, outcome: "error", error: "boom" } },
        log
      ),
      callbacks: { onSkip: (skip) => skips.push(skip) },
    });

    expect(log).toEqual(["launch:a"]);
    expect(summary.stoppedAtWave).toBe(1);
    expect(summary.wavesExecuted).toBe(1);
    expect(plan.ticketStatus.get("d")).toBe("skipped");
    expect(plan.ticketStatus.get("e")).toBe("skipped");
    expect(skips.map((s) => s.kind)).toEqual(["stopped", "stopped"]);
    expect(skips[0].blockedById).toBeNull();
    expect(plan.failureReasons.get("d")).toBe("batch stopped after wave 1");
  });
});

describe("runExecutionWaves — scheduler composition", () => {
  it("keeps wave ordering when the agent scheduler budget is 1 (sessions serialize inside a wave)", async () => {
    const plan = makePlan([["a", "b"], ["c"]]);
    const graph = graphOf([
      ["c", "a"],
      ["c", "b"],
    ]);
    const log: string[] = [];
    const scheduler = new AgentScheduler({ getMaxConcurrent: () => 1 });

    const launch = async (epicId: string): Promise<WaveLaunchHandle> => {
      log.push(`launch:${epicId}`);
      const sessionId = `s-${epicId}`;
      let settle!: (r: WaveTicketResult) => void;
      const settled = new Promise<WaveTicketResult>((resolve) => {
        settle = resolve;
      });
      scheduler.submit("proj-1", sessionId, async () => {
        log.push(`run:${epicId}:start`);
        await new Promise((r) => setTimeout(r, 5));
        log.push(`run:${epicId}:end`);
        settle({
          epicId,
          sessionId,
          success: true,
          outcome: "answered",
          error: null,
        });
      });
      return { sessionId, settled };
    };

    const summary = await runExecutionWaves({
      plan,
      graph,
      failurePolicy: "halt",
      launch,
    });

    // Budget 1: b's session may only start after a's ended...
    expect(log.indexOf("run:b:start")).toBeGreaterThan(
      log.indexOf("run:a:end")
    );
    // ...and wave 2 still waits for the whole first wave.
    expect(log.indexOf("launch:c")).toBeGreaterThan(log.indexOf("run:b:end"));
    expect(log.indexOf("run:c:start")).toBeGreaterThan(
      log.indexOf("launch:c")
    );
    expect(summary.results).toHaveLength(3);

    // The slot frees one microtask after `settled` resolves.
    await flush();
    expect(scheduler.getCounts("proj-1")).toEqual({ running: 0, queued: 0 });
  });
});
