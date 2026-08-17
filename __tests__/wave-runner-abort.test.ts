/**
 * Tests for the wave engine's mid-run abort hook (shouldAbortRun): abort
 * between waves skips every still-pending ticket with kind "aborted" and the
 * returned reason verbatim, the summary carries abortedAtWave/abortReason,
 * in-flight waves always settle before the boundary check, and an absent
 * (or never-tripping) option leaves behavior byte-identical.
 */

import { describe, it, expect } from "vitest";

import {
  runExecutionWaves,
  type WaveLaunchHandle,
  type WaveSkippedTicket,
  type WaveTicketResult,
} from "@/lib/dependencies/wave-runner";
import type {
  BatchExecutionPlan,
  TicketExecutionStatus,
} from "@/lib/dependencies/scheduler";

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

describe("runExecutionWaves — shouldAbortRun", () => {
  it("aborts at the wave boundary: pending tickets skipped 'aborted' with the reason verbatim", async () => {
    const plan = makePlan([["a"], ["b"], ["c"]]);
    const graph = graphOf([
      ["b", "a"],
      ["c", "b"],
    ]);
    const log: string[] = [];
    const skips: WaveSkippedTicket[] = [];

    // Trips after the first wave settled.
    let settledWaves = 0;
    const summary = await runExecutionWaves({
      plan,
      graph,
      failurePolicy: "halt",
      launch: instantLauncher({}, log),
      shouldAbortRun: () =>
        settledWaves >= 1 ? "circuit breaker: 3 consecutive pipeline failures" : null,
      callbacks: {
        onWaveSettled: () => {
          settledWaves += 1;
        },
        onSkip: (skip) => skips.push(skip),
      },
    });

    // Wave 1 ran; waves 2 and 3 never launched.
    expect(log).toEqual(["launch:a"]);
    expect(summary.results.map((r) => r.epicId)).toEqual(["a"]);
    expect(summary.wavesExecuted).toBe(1);

    // Both pending tickets were aborted with the reason verbatim.
    expect(skips).toHaveLength(2);
    for (const skip of skips) {
      expect(skip.kind).toBe("aborted");
      expect(skip.blockedById).toBeNull();
      expect(skip.blockedBySessionId).toBeNull();
      expect(skip.wave).toBe(1);
    }
    expect(new Set(skips.map((s) => s.epicId))).toEqual(new Set(["b", "c"]));
    expect(plan.ticketStatus.get("b")).toBe("skipped");
    expect(plan.ticketStatus.get("c")).toBe("skipped");
    expect(plan.failureReasons.get("b")).toBe(
      "circuit breaker: 3 consecutive pipeline failures"
    );
    expect(plan.failureReasons.get("c")).toBe(
      "circuit breaker: 3 consecutive pipeline failures"
    );

    // Summary carries the abort fields.
    expect(summary.abortedAtWave).toBe(1);
    expect(summary.abortReason).toBe(
      "circuit breaker: 3 consecutive pipeline failures"
    );
    expect(summary.stoppedAtWave).toBeNull();
    expect(summary.skipped).toEqual(skips);
  });

  it("lets the whole in-flight wave settle before the next boundary check", async () => {
    // Both b1 and b2 sit in wave 2; the abort flag flips DURING wave 2's
    // settlement — both results must still be recorded, only wave 3 aborts.
    const plan = makePlan([["a"], ["b1", "b2"], ["c"]]);
    const graph = graphOf([
      ["b1", "a"],
      ["b2", "a"],
      ["c", "b1"],
    ]);
    const log: string[] = [];
    let tripped = false;

    const summary = await runExecutionWaves({
      plan,
      graph,
      failurePolicy: "halt",
      launch: instantLauncher(
        { b1: { success: false, outcome: "error", error: "boom" } },
        log
      ),
      shouldAbortRun: () => (tripped ? "cost cap reached: $9.00 of $5.00" : null),
      callbacks: {
        onWaveSettled: (wave) => {
          if (wave === 2) tripped = true;
        },
      },
    });

    expect(log).toEqual(["launch:a", "launch:b1", "launch:b2"]);
    expect(summary.results.map((r) => r.epicId)).toEqual(["a", "b1", "b2"]);
    // c was aborted at the wave-3 boundary (it was already skip-eligible via
    // b1's failure too, but the failure skip ran first — either way it never
    // launched; the recorded kind is the dependency skip).
    expect(plan.ticketStatus.get("c")).toBe("skipped");
    expect(summary.abortedAtWave).toBe(2);
    expect(summary.abortReason).toBe("cost cap reached: $9.00 of $5.00");
  });

  it("aborting before any wave launched marks everything aborted at wave 0", async () => {
    const plan = makePlan([["a"], ["b"]]);
    const graph = graphOf([["b", "a"]]);
    const log: string[] = [];

    const summary = await runExecutionWaves({
      plan,
      graph,
      failurePolicy: "halt",
      launch: instantLauncher({}, log),
      shouldAbortRun: () => "cost cap reached: $12.00 of $10.00",
    });

    expect(log).toEqual([]);
    expect(summary.results).toEqual([]);
    expect(summary.wavesExecuted).toBe(0);
    expect(summary.abortedAtWave).toBe(0);
    expect(summary.abortReason).toBe("cost cap reached: $12.00 of $10.00");
    expect(summary.skipped.map((s) => s.epicId).sort()).toEqual(["a", "b"]);
    for (const skip of summary.skipped) {
      expect(skip.kind).toBe("aborted");
      expect(skip.wave).toBe(0);
    }
  });

  it("option absent: summary reports null abort fields and behavior is unchanged", async () => {
    const plan = makePlan([["a"], ["b"]]);
    const graph = graphOf([["b", "a"]]);
    const log: string[] = [];

    const summary = await runExecutionWaves({
      plan,
      graph,
      failurePolicy: "halt",
      launch: instantLauncher({}, log),
    });

    expect(log).toEqual(["launch:a", "launch:b"]);
    expect(summary.abortedAtWave).toBeNull();
    expect(summary.abortReason).toBeNull();
    expect(summary.skipped).toEqual([]);
    expect(plan.ticketStatus.get("a")).toBe("done");
    expect(plan.ticketStatus.get("b")).toBe("done");
  });

  it("a hook that never trips behaves exactly like an absent hook", async () => {
    const plan = makePlan([["a"], ["b"]]);
    const graph = graphOf([["b", "a"]]);
    const log: string[] = [];
    let polls = 0;

    const summary = await runExecutionWaves({
      plan,
      graph,
      failurePolicy: "halt",
      launch: instantLauncher({}, log),
      shouldAbortRun: () => {
        polls += 1;
        return null;
      },
    });

    // Polled at the top of every wave iteration.
    expect(polls).toBe(2);
    expect(log).toEqual(["launch:a", "launch:b"]);
    expect(summary.abortedAtWave).toBeNull();
    expect(summary.abortReason).toBeNull();
  });

  it("onFinish receives the abort fields", async () => {
    const plan = makePlan([["a"], ["b"]]);
    const graph = graphOf([["b", "a"]]);
    let finishSummary: unknown = null;

    await runExecutionWaves({
      plan,
      graph,
      failurePolicy: "halt",
      launch: instantLauncher({}, []),
      shouldAbortRun: () =>
        plan.ticketStatus.get("a") === "done" ? "circuit breaker: 1 consecutive pipeline failures" : null,
      callbacks: {
        onFinish: (summary) => {
          finishSummary = summary;
        },
      },
    });

    expect(finishSummary).toMatchObject({
      abortedAtWave: 1,
      abortReason: "circuit breaker: 1 consecutive pipeline failures",
    });
  });
});
