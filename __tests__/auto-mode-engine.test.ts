/**
 * Tests for the Full Auto Mode sweep engine (lib/auto-mode/engine.ts).
 *
 * The dispatcher, the config resolver, the merge primitive and the session
 * status reader are injected as fakes; the registry, the selectors, the
 * activity log and the real database are in the loop. That split is what
 * makes the N/M caps, the per-project mutex and the parking ladder testable
 * without spawning a CLI.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
// Type-only imports are erased, so they can sit above the vi.mock hoisting.
import type {
  AutoModeDispatchInput,
  AutoModeEngineDeps,
} from "@/lib/auto-mode/engine";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

const { db } = await import("@/lib/db");
const {
  projects,
  epics,
  userStories,
  agentSessions,
  ticketComments,
  ticketActivityLog,
} = await import("@/lib/db/schema");
const {
  sweep,
  sweepProject,
  startAutoMode,
  stopAutoMode,
  isAutoModeRunning,
} = await import("@/lib/auto-mode/engine");
const { autoModeRegistry } = await import("@/lib/auto-mode/registry");
const { loadAutoModeBoard } = await import("@/lib/auto-mode/select");
const {
  AUTO_MODE_REASON_PREFIX,
  DEFAULT_AUTO_BUILD_CONCURRENCY,
  DEFAULT_AUTO_REVIEW_CONCURRENCY,
} = await import("@/lib/auto-mode/constants");

const PROJECT_ID = "proj-engine";

let seq = 0;
function at(minute: number): string {
  return new Date(Date.UTC(2026, 7, 19, 10, minute, 0)).toISOString();
}

function seedProject(id = PROJECT_ID): void {
  db.insert(projects)
    .values({ id, name: "Engine", gitRepoPath: `/repos/${id}` })
    .run();
}

function addEpic(input: {
  id: string;
  status: string;
  projectId?: string;
  branchName?: string | null;
  position?: number;
}): void {
  db.insert(epics)
    .values({
      id: input.id,
      projectId: input.projectId ?? PROJECT_ID,
      title: input.id,
      status: input.status,
      position: input.position ?? 0,
      branchName: input.branchName ?? null,
      readableId: `E-${input.id}`,
      createdAt: at(0),
      updatedAt: at(0),
    })
    .run();
}

function addStory(input: {
  id: string;
  epicId: string;
  status: string;
  position?: number;
}): void {
  db.insert(userStories)
    .values({
      id: input.id,
      epicId: input.epicId,
      title: input.id,
      status: input.status,
      position: input.position ?? 0,
      createdAt: at(0),
    })
    .run();
}

function addSession(input: {
  id?: string;
  projectId?: string;
  epicId: string;
  userStoryId?: string | null;
  status: string;
  agentType: string;
  createdAt: string;
  endedAt?: string | null;
}): string {
  seq += 1;
  const id = input.id ?? `s-${seq}`;
  db.insert(agentSessions)
    .values({
      id,
      projectId: input.projectId ?? PROJECT_ID,
      epicId: input.epicId,
      userStoryId: input.userStoryId ?? null,
      status: input.status,
      agentType: input.agentType,
      createdAt: input.createdAt,
      endedAt: input.endedAt ?? null,
    })
    .run();
  return id;
}

/* ------------------------------------------------------------------ */
/* Injectable fakes                                                    */
/* ------------------------------------------------------------------ */

interface Fakes {
  deps: AutoModeEngineDeps;
  dispatches: AutoModeDispatchInput[];
  merges: string[];
  /** Sessions the fake dispatcher created, keyed by id → status. */
  sessionStatus: Map<string, string>;
  setConfig(patch: Partial<ReturnType<AutoModeEngineDeps["resolveConfig"]>>): void;
  failNextDispatch(times: number, error?: string): void;
  conflictNextDispatch(sessionId: string): void;
  mergeOutcome(outcome: unknown): void;
}

function makeFakes(): Fakes {
  const dispatches: AutoModeDispatchInput[] = [];
  const merges: string[] = [];
  const sessionStatus = new Map<string, string>();
  let dispatchFailures = 0;
  let dispatchError = "dispatch exploded";
  let conflictSessionId: string | null = null;
  let mergeResult: unknown = { status: "skipped", reason: "n/a", sessionId: null };

  let config = {
    enabled: true,
    buildAgent: "build-agent" as string | null,
    buildConcurrency: DEFAULT_AUTO_BUILD_CONCURRENCY,
    reviewAgent: "review-agent" as string | null,
    reviewConcurrency: DEFAULT_AUTO_REVIEW_CONCURRENCY,
  };

  const deps: AutoModeEngineDeps = {
    listEnabledProjectIds: () => (config.enabled ? [PROJECT_ID] : []),
    resolveConfig: () => ({ ...config }),
    loadBoard: (projectId) => loadAutoModeBoard(projectId),
    dispatch: async (input) => {
      dispatches.push(input);
      if (conflictSessionId) {
        const id = conflictSessionId;
        conflictSessionId = null;
        return { sessionId: null, error: null, conflictSessionId: id };
      }
      if (dispatchFailures > 0) {
        dispatchFailures -= 1;
        return { sessionId: null, error: dispatchError, conflictSessionId: null };
      }
      seq += 1;
      const sessionId = `fake-${input.stage}-${seq}`;
      sessionStatus.set(sessionId, "running");
      // A real dispatch writes a session row, which is what makes the target
      // busy for the next sweep — reproduce that so the guards behave.
      db.insert(agentSessions)
        .values({
          id: sessionId,
          projectId: input.projectId,
          epicId: input.epicId,
          userStoryId: input.userStoryId,
          status: "running",
          agentType: input.stage === "review" ? "review_code" : "build",
          batchRunId: `auto_${input.projectId}`,
          createdAt: at(50 + seq),
        })
        .run();
      return { sessionId, error: null, conflictSessionId: null };
    },
    merge: async (_projectId, epicId) => {
      merges.push(epicId);
      return mergeResult as never;
    },
    readSessionStatus: (sessionId) =>
      sessionStatus.get(sessionId) ??
      db
        .select({ status: agentSessions.status })
        .from(agentSessions)
        .where(eq(agentSessions.id, sessionId))
        .get()?.status ??
      null,
    readEpicStatus: (epicId) =>
      db.select({ status: epics.status }).from(epics).where(eq(epics.id, epicId)).get()
        ?.status ?? null,
  };

  return {
    deps,
    dispatches,
    merges,
    sessionStatus,
    setConfig(patch) {
      config = { ...config, ...patch };
    },
    failNextDispatch(times, error) {
      dispatchFailures = times;
      if (error) dispatchError = error;
    },
    conflictNextDispatch(sessionId) {
      conflictSessionId = sessionId;
    },
    mergeOutcome(outcome) {
      mergeResult = outcome;
    },
  };
}

/** Marks a fake session terminal so the next sweep reconciles it. */
function settle(fakes: Fakes, sessionId: string, status: string): void {
  fakes.sessionStatus.set(sessionId, status);
  db.update(agentSessions)
    .set({ status, endedAt: at(90) })
    .where(eq(agentSessions.id, sessionId))
    .run();
}

function autoReasons(epicId: string): string[] {
  return db
    .select()
    .from(ticketActivityLog)
    .where(eq(ticketActivityLog.epicId, epicId))
    .all()
    .map((row) => row.reason ?? "")
    .filter((reason) => reason.startsWith(AUTO_MODE_REASON_PREFIX));
}

beforeEach(() => {
  db.delete(ticketComments).run();
  db.delete(ticketActivityLog).run();
  db.delete(agentSessions).run();
  db.delete(userStories).run();
  db.delete(epics).run();
  db.delete(projects).run();
  autoModeRegistry.resetAll();
  seedProject();
});

afterEach(() => {
  stopAutoMode();
});

/* ------------------------------------------------------------------ */
/* Budgets                                                             */
/* ------------------------------------------------------------------ */

describe("budgets", () => {
  it("dispatches exactly N builders and M reviewers, leaving the rest waiting", async () => {
    const fakes = makeFakes();
    fakes.setConfig({ buildConcurrency: 2, reviewConcurrency: 1 });
    addEpic({ id: "t1", status: "todo", position: 0 });
    addEpic({ id: "t2", status: "todo", position: 1 });
    addEpic({ id: "t3", status: "todo", position: 2 });
    addEpic({ id: "r1", status: "review", position: 3 });
    addSession({
      epicId: "r1",
      status: "completed",
      agentType: "build",
      createdAt: at(1),
      endedAt: at(2),
    });

    const result = await sweepProject(PROJECT_ID, fakes.deps);

    expect(result.buildsDispatched).toHaveLength(2);
    expect(result.reviewsDispatched).toHaveLength(1);
    expect(result.inFlight).toEqual({ build: 2, review: 1 });

    const builtEpics = fakes.dispatches
      .filter((d) => d.stage === "build")
      .map((d) => d.epicId);
    expect(builtEpics).toEqual(["t1", "t2"]);
  });

  it("never exceeds the budgets across consecutive sweeps", async () => {
    const fakes = makeFakes();
    fakes.setConfig({ buildConcurrency: 1, reviewConcurrency: 0 });
    addEpic({ id: "t1", status: "todo", position: 0 });
    addEpic({ id: "t2", status: "todo", position: 1 });

    await sweepProject(PROJECT_ID, fakes.deps);
    await sweepProject(PROJECT_ID, fakes.deps);
    await sweepProject(PROJECT_ID, fakes.deps);

    expect(autoModeRegistry.countInFlight(PROJECT_ID).build).toBe(1);
    expect(fakes.dispatches.filter((d) => d.stage === "build")).toHaveLength(1);
  });

  it("refills the freed slot once the in-flight session goes terminal", async () => {
    const fakes = makeFakes();
    fakes.setConfig({ buildConcurrency: 1, reviewConcurrency: 0 });
    addEpic({ id: "t1", status: "todo", position: 0 });
    addEpic({ id: "t2", status: "todo", position: 1 });

    const first = await sweepProject(PROJECT_ID, fakes.deps);
    settle(fakes, first.buildsDispatched[0], "completed");
    db.update(epics).set({ status: "review" }).where(eq(epics.id, "t1")).run();

    const second = await sweepProject(PROJECT_ID, fakes.deps);
    expect(second.buildsDispatched).toHaveLength(1);
    expect(
      fakes.dispatches.filter((d) => d.stage === "build").map((d) => d.epicId)
    ).toEqual(["t1", "t2"]);
  });

  it("a build concurrency of 0 disables builds without disabling reviews", async () => {
    const fakes = makeFakes();
    fakes.setConfig({ buildConcurrency: 0, reviewConcurrency: 2 });
    addEpic({ id: "t1", status: "todo" });
    addEpic({ id: "r1", status: "review", position: 1 });
    addSession({
      epicId: "r1",
      status: "completed",
      agentType: "build",
      createdAt: at(1),
      endedAt: at(2),
    });

    const result = await sweepProject(PROJECT_ID, fakes.deps);
    expect(result.buildsDispatched).toEqual([]);
    expect(result.reviewsDispatched).toHaveLength(1);
  });

  it("a review concurrency of 0 disables reviews without disabling builds", async () => {
    const fakes = makeFakes();
    fakes.setConfig({ buildConcurrency: 2, reviewConcurrency: 0 });
    addEpic({ id: "t1", status: "todo" });
    addEpic({ id: "r1", status: "review", position: 1 });
    addSession({
      epicId: "r1",
      status: "completed",
      agentType: "build",
      createdAt: at(1),
      endedAt: at(2),
    });

    const result = await sweepProject(PROJECT_ID, fakes.deps);
    expect(result.reviewsDispatched).toEqual([]);
    expect(result.buildsDispatched).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* Dispatch shape                                                      */
/* ------------------------------------------------------------------ */

describe("dispatch shape", () => {
  it("passes the configured build and review agents and the auto batch id", async () => {
    const fakes = makeFakes();
    addEpic({ id: "r1", status: "review" });
    addSession({
      epicId: "r1",
      status: "completed",
      agentType: "build",
      createdAt: at(1),
      endedAt: at(2),
    });

    const result = await sweepProject(PROJECT_ID, fakes.deps);

    expect(fakes.dispatches[0]).toMatchObject({
      stage: "review",
      scope: "epic",
      epicId: "r1",
      buildNamedAgentId: "build-agent",
      reviewNamedAgentId: "review-agent",
    });
    const row = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, result.reviewsDispatched[0]))
      .get()!;
    expect(row.batchRunId).toBe(`auto_${PROJECT_ID}`);
  });

  it("dispatches story scope for an epic with stories and epic scope otherwise", async () => {
    const fakes = makeFakes();
    fakes.setConfig({ reviewConcurrency: 0 });
    addEpic({ id: "with", status: "todo", position: 0 });
    addStory({ id: "s1", epicId: "with", status: "todo" });
    addEpic({ id: "without", status: "todo", position: 1 });

    await sweepProject(PROJECT_ID, fakes.deps);

    expect(fakes.dispatches).toEqual([
      expect.objectContaining({
        scope: "story",
        epicId: "with",
        userStoryId: "s1",
      }),
      expect.objectContaining({
        scope: "epic",
        epicId: "without",
        userStoryId: null,
      }),
    ]);
  });

  it("hands the driver its own session ids for the race check", async () => {
    const fakes = makeFakes();
    fakes.setConfig({ buildConcurrency: 2, reviewConcurrency: 0 });
    addEpic({ id: "t1", status: "todo", position: 0 });
    addEpic({ id: "t2", status: "todo", position: 1 });

    const result = await sweepProject(PROJECT_ID, fakes.deps);

    expect(fakes.dispatches[0].ownSessionIds).toEqual([]);
    expect(fakes.dispatches[1].ownSessionIds).toEqual([
      result.buildsDispatched[0],
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Activity trace                                                      */
/* ------------------------------------------------------------------ */

describe("activity trace", () => {
  it("logs every dispatch with actor system and an 'Auto mode ' reason", async () => {
    const fakes = makeFakes();
    addEpic({ id: "t1", status: "todo" });

    await sweepProject(PROJECT_ID, fakes.deps);

    const entries = db
      .select()
      .from(ticketActivityLog)
      .where(eq(ticketActivityLog.epicId, "t1"))
      .all();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: "system",
      fromStatus: "todo",
      toStatus: "todo",
      reason: "Auto mode dispatched a build (epic scope)",
    });
    expect(entries[0].sessionId).toBeTruthy();
  });

  it("logs a skip when another agent took the ticket first", async () => {
    const fakes = makeFakes();
    addEpic({ id: "t1", status: "todo" });
    fakes.conflictNextDispatch("someone-elses-session");

    const result = await sweepProject(PROJECT_ID, fakes.deps);

    expect(result.buildsDispatched).toEqual([]);
    expect(autoReasons("t1")).toContain(
      "Auto mode skipped: another agent is already on this ticket"
    );
    // A conflict is not the ticket's fault — no failure is charged.
    expect(autoModeRegistry.listParked(PROJECT_ID)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Parking                                                             */
/* ------------------------------------------------------------------ */

describe("parking", () => {
  it("parks a ticket after 3 consecutive dispatch failures and skips it after", async () => {
    const fakes = makeFakes();
    fakes.setConfig({ reviewConcurrency: 0 });
    addEpic({ id: "t1", status: "todo" });

    fakes.failNextDispatch(3, "boom");
    await sweepProject(PROJECT_ID, fakes.deps);
    await sweepProject(PROJECT_ID, fakes.deps);
    const third = await sweepProject(PROJECT_ID, fakes.deps);

    expect(third.parked).toEqual(["t1"]);
    expect(autoModeRegistry.isParked(PROJECT_ID, "t1")).toBe(true);
    expect(autoReasons("t1")).toContain(
      "Auto mode parked this ticket after 3 consecutive failures"
    );

    const dispatchesBefore = fakes.dispatches.length;
    await sweepProject(PROJECT_ID, fakes.deps);
    expect(fakes.dispatches.length).toBe(dispatchesBefore);
  });

  it("parks a ticket whose dispatched sessions keep failing", async () => {
    const fakes = makeFakes();
    fakes.setConfig({ buildConcurrency: 1, reviewConcurrency: 0 });
    addEpic({ id: "t1", status: "todo" });

    for (let i = 0; i < 3; i += 1) {
      const result = await sweepProject(PROJECT_ID, fakes.deps);
      expect(result.buildsDispatched).toHaveLength(1);
      settle(fakes, result.buildsDispatched[0], "failed");
    }

    const final = await sweepProject(PROJECT_ID, fakes.deps);
    expect(final.parked).toEqual(["t1"]);
    expect(final.buildsDispatched).toEqual([]);
  });

  it("a completed session clears the failure streak", async () => {
    const fakes = makeFakes();
    fakes.setConfig({ buildConcurrency: 1, reviewConcurrency: 0 });
    addEpic({ id: "t1", status: "todo" });

    let result = await sweepProject(PROJECT_ID, fakes.deps);
    settle(fakes, result.buildsDispatched[0], "failed");
    result = await sweepProject(PROJECT_ID, fakes.deps);
    settle(fakes, result.buildsDispatched[0], "completed");
    result = await sweepProject(PROJECT_ID, fakes.deps);
    settle(fakes, result.buildsDispatched[0], "failed");
    result = await sweepProject(PROJECT_ID, fakes.deps);
    settle(fakes, result.buildsDispatched[0], "failed");

    // 1 failure, reset, then 2 more — still below the cap of 3.
    const final = await sweepProject(PROJECT_ID, fakes.deps);
    expect(autoModeRegistry.isParked(PROJECT_ID, "t1")).toBe(false);
    expect(final.buildsDispatched).toHaveLength(1);
  });

  it("a user-cancelled session counts neither as success nor failure", async () => {
    const fakes = makeFakes();
    fakes.setConfig({ buildConcurrency: 1, reviewConcurrency: 0 });
    addEpic({ id: "t1", status: "todo" });

    for (let i = 0; i < 4; i += 1) {
      const result = await sweepProject(PROJECT_ID, fakes.deps);
      if (result.buildsDispatched[0]) {
        settle(fakes, result.buildsDispatched[0], "cancelled");
      }
    }

    expect(autoModeRegistry.isParked(PROJECT_ID, "t1")).toBe(false);
  });

  it("un-parks a ticket the user comments on", async () => {
    const fakes = makeFakes();
    fakes.setConfig({ reviewConcurrency: 0 });
    addEpic({ id: "t1", status: "todo" });

    fakes.failNextDispatch(3, "boom");
    await sweepProject(PROJECT_ID, fakes.deps);
    await sweepProject(PROJECT_ID, fakes.deps);
    await sweepProject(PROJECT_ID, fakes.deps);
    expect(autoModeRegistry.isParked(PROJECT_ID, "t1")).toBe(true);

    db.insert(ticketComments)
      .values({
        id: "cmt-unpark",
        epicId: "t1",
        author: "user",
        content: "try again",
        createdAt: new Date(Date.now() + 60_000).toISOString(),
      })
      .run();

    const result = await sweepProject(PROJECT_ID, fakes.deps);
    expect(autoModeRegistry.isParked(PROJECT_ID, "t1")).toBe(false);
    expect(result.buildsDispatched).toHaveLength(1);
  });

  it("clears parks when the mode is switched off", async () => {
    const fakes = makeFakes();
    fakes.setConfig({ reviewConcurrency: 0 });
    addEpic({ id: "t1", status: "todo" });
    fakes.failNextDispatch(3, "boom");
    await sweepProject(PROJECT_ID, fakes.deps);
    await sweepProject(PROJECT_ID, fakes.deps);
    await sweepProject(PROJECT_ID, fakes.deps);

    fakes.setConfig({ enabled: false });
    const off = await sweepProject(PROJECT_ID, fakes.deps);
    expect(off.skipped).toBe("disabled");
    expect(autoModeRegistry.isParked(PROJECT_ID, "t1")).toBe(false);
    expect(autoModeRegistry.snapshot(PROJECT_ID).enabled).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Merge step                                                          */
/* ------------------------------------------------------------------ */

describe("merge step", () => {
  function seedMergeable(): void {
    addEpic({ id: "m1", status: "review", branchName: "feat/m1" });
    addSession({
      epicId: "m1",
      status: "completed",
      agentType: "build",
      createdAt: at(1),
      endedAt: at(2),
    });
    addSession({
      epicId: "m1",
      status: "completed",
      agentType: "review_code",
      createdAt: at(3),
      endedAt: at(4),
    });
  }

  it("merges before dispatching anything, and a clean merge costs no slot", async () => {
    const fakes = makeFakes();
    seedMergeable();
    fakes.mergeOutcome({ status: "merged", commitHash: "c1", sessionId: null });

    const result = await sweepProject(PROJECT_ID, fakes.deps);

    expect(fakes.merges).toEqual(["m1"]);
    expect(result.merged).toEqual(["m1"]);
    expect(result.inFlight).toEqual({ build: 0, review: 0 });
  });

  it("charges a merge-fix session to the build budget", async () => {
    const fakes = makeFakes();
    fakes.setConfig({ buildConcurrency: 1, reviewConcurrency: 0 });
    seedMergeable();
    addEpic({ id: "t1", status: "todo", position: 5 });
    fakes.mergeOutcome({
      status: "conflict",
      error: "CONFLICT",
      sessionId: "merge-fix-1",
    });

    const result = await sweepProject(PROJECT_ID, fakes.deps);

    expect(result.mergeConflicts).toEqual(["m1"]);
    expect(autoModeRegistry.countInFlight(PROJECT_ID).build).toBe(1);
    // The budget of 1 is spent on the merge fix, so no build goes out.
    expect(result.buildsDispatched).toEqual([]);
  });

  it("does not park an epic whose merge was refused by a guard", async () => {
    const fakes = makeFakes();
    seedMergeable();
    fakes.mergeOutcome({
      status: "skipped",
      reason: "unresolved review comments",
      sessionId: null,
    });

    for (let i = 0; i < 4; i += 1) await sweepProject(PROJECT_ID, fakes.deps);

    expect(autoModeRegistry.isParked(PROJECT_ID, "m1")).toBe(false);
  });

  it("parks an epic after three hard merge failures", async () => {
    const fakes = makeFakes();
    seedMergeable();
    fakes.mergeOutcome({
      status: "failed",
      error: "Branch not found",
      sessionId: null,
    });

    await sweepProject(PROJECT_ID, fakes.deps);
    await sweepProject(PROJECT_ID, fakes.deps);
    const third = await sweepProject(PROJECT_ID, fakes.deps);

    expect(third.parked).toContain("m1");
    expect(autoModeRegistry.isParked(PROJECT_ID, "m1")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Mutex + lifecycle                                                   */
/* ------------------------------------------------------------------ */

describe("per-project mutex", () => {
  it("never lets two sweeps of the same project overlap", async () => {
    const fakes = makeFakes();
    fakes.setConfig({ buildConcurrency: 4, reviewConcurrency: 0 });
    addEpic({ id: "t1", status: "todo", position: 0 });
    addEpic({ id: "t2", status: "todo", position: 1 });

    // Make the dispatcher await a gate so the first sweep is still inside its
    // critical section when the second one starts.
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const inner = fakes.deps.dispatch;
    let firstCall = true;
    fakes.deps.dispatch = async (input) => {
      if (firstCall) {
        firstCall = false;
        await gate;
      }
      return inner(input);
    };

    const firstSweep = sweepProject(PROJECT_ID, fakes.deps);
    const secondSweep = sweepProject(PROJECT_ID, fakes.deps);

    expect((await secondSweep).skipped).toBe("locked");
    releaseGate();
    const first = await firstSweep;
    expect(first.skipped).toBeNull();
    expect(first.buildsDispatched).toHaveLength(2);
  });

  it("releases the lock even when the sweep throws", async () => {
    const fakes = makeFakes();
    addEpic({ id: "t1", status: "todo" });
    fakes.deps.loadBoard = () => {
      throw new Error("board exploded");
    };

    const result = await sweepProject(PROJECT_ID, fakes.deps);
    expect(result.skipped).toBeNull();
    expect(autoModeRegistry.isSweeping(PROJECT_ID)).toBe(false);

    fakes.deps.loadBoard = (projectId) => loadAutoModeBoard(projectId);
    const recovered = await sweepProject(PROJECT_ID, fakes.deps);
    expect(recovered.buildsDispatched).toHaveLength(1);
  });
});

describe("sweep() across projects", () => {
  it("sweeps every enabled project and records the sweep timestamp", async () => {
    const fakes = makeFakes();
    addEpic({ id: "t1", status: "todo" });

    const results = await sweep(new Date(Date.UTC(2026, 7, 19, 12, 0, 0)), fakes.deps);

    expect(results.map((r) => r.projectId)).toEqual([PROJECT_ID]);
    expect(autoModeRegistry.snapshot(PROJECT_ID).lastSweepAt).toBe(
      "2026-08-19T12:00:00.000Z"
    );
  });

  it("gives a project just switched off one final state-clearing sweep", async () => {
    const fakes = makeFakes();
    addEpic({ id: "t1", status: "todo" });
    await sweep(new Date(), fakes.deps);
    expect(autoModeRegistry.snapshot(PROJECT_ID).enabled).toBe(true);

    fakes.setConfig({ enabled: false });
    const results = await sweep(new Date(), fakes.deps);
    expect(results.map((r) => r.skipped)).toEqual(["disabled"]);
    expect(autoModeRegistry.snapshot(PROJECT_ID).enabled).toBe(false);
    expect(autoModeRegistry.snapshot(PROJECT_ID).inFlight).toEqual({
      build: 0,
      review: 0,
    });
  });
});

describe("timer lifecycle", () => {
  it("start is idempotent and the interval never keeps the process alive", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    try {
      startAutoMode();
      startAutoMode();
      startAutoMode();
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      expect(isAutoModeRunning()).toBe(true);
      const timer = setIntervalSpy.mock.results[0].value as {
        unref?: () => void;
      };
      // Node timers expose unref(); the engine calls it so `npm run build`
      // and one-shot scripts can still exit.
      expect(typeof timer.unref).toBe("function");
    } finally {
      setIntervalSpy.mockRestore();
    }

    stopAutoMode();
    expect(isAutoModeRunning()).toBe(false);
    stopAutoMode();
    expect(isAutoModeRunning()).toBe(false);
  });

  it("survives a module re-evaluation through the globalThis slot", async () => {
    startAutoMode();
    expect(isAutoModeRunning()).toBe(true);
    vi.resetModules();
    const reloaded = await import("@/lib/auto-mode/engine");
    expect(reloaded.isAutoModeRunning()).toBe(true);
    reloaded.stopAutoMode();
    expect(isAutoModeRunning()).toBe(false);
  });
});
