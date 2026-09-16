/**
 * dispatchBackgroundSession — the one background-session dispatch path,
 * against the real migrated schema (createTestDb) with the CLI spawn mocked
 * and the REAL scheduler + lifecycle underneath:
 *
 *   - the provider, model, named agent and the composite it was unfolded
 *     from are read from the resolved agent and reach the row AND the spawn
 *     unchanged: a non-default provider survives dispatch end to end,
 *     nothing re-defaults it,
 *   - the CLI session id is minted only for providers that take an assigned
 *     id (`mintAssignedCliSessionId` is the single place that decides),
 *   - epicId/userStoryId are forwarded only when passed — an omitted epicId
 *     is absent from the queued payload and NULL on the row, an explicit one
 *     is stored — and the owned columns cannot be overridden via `session`,
 *   - hook order: onQueued fires with the row queued and before the spawn;
 *     evaluate decides the verdict BEFORE markSessionTerminal, so a zero-exit
 *     run that produced nothing usable is recorded as failed; onTerminal
 *     sees that verdict; `settled` resolves with it,
 *   - a spawn that throws fires onLaunchFailure synchronously — before the
 *     dispatch returns — with the queued context, `settled` resolves with the
 *     launch error, and the scheduler's safety net fails the row,
 *   - an onTerminal that throws still settles (verdict kept, launchError
 *     set) and leaves the already-terminal row alone,
 *   - a cancelled process reaches onTerminal as status "cancelled".
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { BackgroundSessionQueued } from "@/lib/agent-sessions/dispatch-background-session";
import { waitForBackground } from "./helpers/background";
import { claudeEnvelope } from "./helpers/provider-fixtures";

const pm = vi.hoisted(() => ({
  status: null as null | { status: string; result?: Record<string, unknown> },
  starts: [] as Array<{
    sessionId: string;
    options: Record<string, unknown>;
    provider: string;
  }>,
  throwOnStart: null as null | Error,
  onStart: null as null | ((sessionId: string) => void),
}));

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

vi.mock("@/lib/claude/process-manager", () => ({
  processManager: {
    start: vi.fn(
      (sessionId: string, options: Record<string, unknown>, provider: string) => {
        if (pm.throwOnStart) throw pm.throwOnStart;
        pm.starts.push({ sessionId, options, provider });
        pm.onStart?.(sessionId);
        return { sessionId, status: "running", provider, startedAt: new Date() };
      },
    ),
    getStatus: vi.fn(() => pm.status),
  },
}));

// The real lifecycle, with the queued insert wrapped so the PAYLOAD shape can
// be asserted (an omitted epicId must be absent, not null).
vi.mock("@/lib/agent-sessions/lifecycle", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/agent-sessions/lifecycle")>();
  return {
    ...actual,
    createQueuedSession: vi.fn(actual.createQueuedSession),
  };
});

vi.mock("fs", () => ({
  default: {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => {
      throw new Error("no logs in tests");
    }),
  },
}));

const fs = (await import("fs")).default;
const { db } = await import("@/lib/db");
const { projects, epics, userStories, agentSessions, namedAgents } =
  await import("@/lib/db/schema");
const { createQueuedSession } = await import("@/lib/agent-sessions/lifecycle");
const { dispatchBackgroundSession, mintAssignedCliSessionId } = await import(
  "@/lib/agent-sessions/dispatch-background-session"
);
const { agentScheduler } = await import("@/lib/agents/scheduler");
const { COMPOSITE_AGENT_PROVIDER } = await import(
  "@/lib/agent-config/constants"
);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let counter = 0;

/** The named agent a user bound to the role — `named_agent_id` is a FK. */
function seedNamedAgent(id: string, provider: string, model: string) {
  db.insert(namedAgents)
    .values({ id, name: "Codex Reviewer", provider, model })
    .onConflictDoNothing()
    .run();
}

/**
 * A composite is a `named_agents` ROW carrying kind = 'composite' — not a
 * table of its own — so `agent_sessions.composite_agent_id` is a FK into the
 * same table as `named_agent_id`.
 */
function seedCompositeAgent(id: string) {
  db.insert(namedAgents)
    .values({
      id,
      name: "Reviewers",
      kind: "composite",
      provider: COMPOSITE_AGENT_PROVIDER,
      model: "",
    })
    .onConflictDoNothing()
    .run();
}

/** One project per test: the scheduler's per-project state must start idle. */
function seedProject() {
  counter += 1;
  const projectId = `proj-bg-${counter}`;
  db.insert(projects)
    .values({ id: projectId, name: "Background", gitRepoPath: "/repos/bg" })
    .run();
  return projectId;
}

function seedTicket(projectId: string) {
  const epicId = `epic-bg-${counter}`;
  const storyId = `story-bg-${counter}`;
  db.insert(epics)
    .values({
      id: epicId,
      projectId,
      title: "Ticket",
      status: "review",
      position: 0,
      readableId: `E-bg-${counter}`,
    })
    .run();
  db.insert(userStories)
    .values({ id: storyId, epicId, title: "Story", status: "review" })
    .run();
  return { epicId, storyId };
}

function getRow(sessionId: string) {
  return db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();
}

function lastQueuedPayload(): Record<string, unknown> {
  const calls = vi.mocked(createQueuedSession).mock.calls;
  return calls[calls.length - 1][0] as unknown as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  pm.starts = [];
  pm.throwOnStart = null;
  pm.onStart = null;
  pm.status = {
    status: "completed",
    result: { success: true, result: claudeEnvelope("done"), duration: 10 },
  };
});

describe("mintAssignedCliSessionId", () => {
  it("mints for the providers that consume a caller-chosen id", () => {
    expect(mintAssignedCliSessionId("claude-code")).toMatch(UUID_RE);
    expect(mintAssignedCliSessionId("codex")).toMatch(UUID_RE);
  });

  it("mints nothing for providers that report their own id", () => {
    expect(mintAssignedCliSessionId("oh-my-pi")).toBeUndefined();
    expect(mintAssignedCliSessionId("agy")).toBeUndefined();
    expect(mintAssignedCliSessionId("gemini-cli")).toBeUndefined();
  });
});

describe("dispatchBackgroundSession — the provider is carried, never re-defaulted", () => {
  it("a non-default provider reaches the row, the spawn and the caller unchanged", async () => {
    const projectId = seedProject();
    seedNamedAgent("na-codex", "codex", "gpt-5.4-codex");
    pm.status = {
      status: "completed",
      result: {
        success: true,
        result: claudeEnvelope("verdict", { costUsd: 0.42 }),
        duration: 10,
      },
    };

    const dispatched = dispatchBackgroundSession({
      agentType: "probe",
      projectId,
      prompt: "Look at the board.",
      resolvedAgent: {
        provider: "codex",
        model: "gpt-5.4-codex",
        name: "Codex Reviewer",
        namedAgentId: "na-codex",
      },
      mode: "plan",
      cwd: "/repos/bg",
      logPrefix: "[probe]",
    });

    // The caller learns which provider was actually dispatched to.
    expect(dispatched.provider).toBe("codex");
    expect(dispatched.cliSessionId).toMatch(UUID_RE);

    // The row says codex, with the named agent's identity and model.
    const settled = await dispatched.settled;
    const row = getRow(dispatched.sessionId);
    expect(row).toMatchObject({
      agentType: "probe",
      projectId,
      provider: "codex",
      model: "gpt-5.4-codex",
      namedAgentId: "na-codex",
      namedAgentName: "Codex Reviewer",
      mode: "plan",
      cliSessionId: dispatched.cliSessionId,
      status: "completed",
      outcome: "answered",
      totalCostUsd: 0.42,
    });

    // The spawn was told the same provider, model and CLI session id.
    expect(pm.starts).toHaveLength(1);
    expect(pm.starts[0]).toEqual({
      sessionId: dispatched.sessionId,
      provider: "codex",
      options: expect.objectContaining({
        mode: "plan",
        prompt: "Look at the board.",
        cwd: "/repos/bg",
        model: "gpt-5.4-codex",
        cliSessionId: dispatched.cliSessionId,
      }),
    });

    expect(settled).toMatchObject({
      sessionId: dispatched.sessionId,
      success: true,
      error: null,
      outcome: "answered",
      launchError: null,
    });
  });

  it("records the composite the resolved member was unfolded from, next to the member", async () => {
    const projectId = seedProject();
    seedNamedAgent("na-codex", "codex", "gpt-5.4-codex");
    seedCompositeAgent("ca-reviewers");

    const dispatched = dispatchBackgroundSession({
      agentType: "probe",
      projectId,
      prompt: "Look at the board.",
      resolvedAgent: {
        provider: "codex",
        model: "gpt-5.4-codex",
        name: "Codex Reviewer",
        namedAgentId: "na-codex",
        compositeAgentId: "ca-reviewers",
      },
      mode: "plan",
      logPrefix: "[probe]",
    });
    await dispatched.settled;

    // Both, and in the right columns: reliability statistics group by
    // `named_agent_id`, so the MEMBER is what ran; the composite is only the
    // list that chose it.
    expect(getRow(dispatched.sessionId)).toMatchObject({
      namedAgentId: "na-codex",
      compositeAgentId: "ca-reviewers",
    });
  });

  it("a resolved agent with no composite leaves the column NULL", async () => {
    const projectId = seedProject();
    const dispatched = dispatchBackgroundSession({
      agentType: "probe",
      projectId,
      prompt: "Look at the board.",
      resolvedAgent: { provider: "codex", model: "gpt-5.4-codex" },
      mode: "plan",
      logPrefix: "[probe]",
    });
    await dispatched.settled;

    expect(getRow(dispatched.sessionId)?.compositeAgentId).toBeNull();
  });

  it("a provider that reports its own session id gets no minted id, and still keeps its provider", async () => {
    const projectId = seedProject();

    const dispatched = dispatchBackgroundSession({
      agentType: "probe",
      projectId,
      prompt: "p",
      resolvedAgent: { provider: "oh-my-pi" },
      mode: "code",
      logPrefix: "[probe]",
    });
    await dispatched.settled;

    expect(dispatched.provider).toBe("oh-my-pi");
    expect(dispatched.cliSessionId).toBeUndefined();
    expect(getRow(dispatched.sessionId)).toMatchObject({
      provider: "oh-my-pi",
      cliSessionId: null,
      model: null,
      namedAgentId: null,
      namedAgentName: null,
    });
    expect(pm.starts[0].provider).toBe("oh-my-pi");
    expect(pm.starts[0].options.cliSessionId).toBeUndefined();
    expect(pm.starts[0].options.model).toBeUndefined();
  });

  it("spawns in the mode the row was persisted with", async () => {
    const projectId = seedProject();
    const dispatched = dispatchBackgroundSession({
      agentType: "probe",
      projectId,
      prompt: "p",
      resolvedAgent: { provider: "claude-code" },
      mode: "chat",
      logPrefix: "[probe]",
    });
    await dispatched.settled;

    expect(getRow(dispatched.sessionId)?.mode).toBe("chat");
    expect(pm.starts[0].options.mode).toBe("chat");
  });
});

describe("dispatchBackgroundSession — ticket anchoring is the caller's word", () => {
  it("an omitted epicId is absent from the queued payload and NULL on the row", async () => {
    const projectId = seedProject();
    const dispatched = dispatchBackgroundSession({
      agentType: "probe",
      projectId,
      prompt: "p",
      resolvedAgent: { provider: "claude-code" },
      mode: "plan",
      logPrefix: "[probe]",
    });
    await dispatched.settled;

    const payload = lastQueuedPayload();
    expect(payload).not.toHaveProperty("epicId");
    expect(payload).not.toHaveProperty("userStoryId");
    expect(getRow(dispatched.sessionId)).toMatchObject({
      epicId: null,
      userStoryId: null,
    });
  });

  it("an explicit epicId and userStoryId are stored", async () => {
    const projectId = seedProject();
    const { epicId, storyId } = seedTicket(projectId);

    const dispatched = dispatchBackgroundSession({
      agentType: "probe",
      projectId,
      epicId,
      userStoryId: storyId,
      prompt: "p",
      resolvedAgent: { provider: "claude-code" },
      mode: "code",
      logPrefix: "[probe]",
    });
    await dispatched.settled;

    expect(lastQueuedPayload()).toMatchObject({ epicId, userStoryId: storyId });
    expect(getRow(dispatched.sessionId)).toMatchObject({
      epicId,
      userStoryId: storyId,
    });
  });

  it("an explicit null epicId is kept as an explicit null", async () => {
    const projectId = seedProject();
    const dispatched = dispatchBackgroundSession({
      agentType: "probe",
      projectId,
      epicId: null,
      prompt: "p",
      resolvedAgent: { provider: "claude-code" },
      mode: "plan",
      logPrefix: "[probe]",
    });
    await dispatched.settled;

    expect(lastQueuedPayload()).toHaveProperty("epicId", null);
    expect(getRow(dispatched.sessionId)?.epicId).toBeNull();
  });

  it("`session` adds columns but cannot override the owned ones", async () => {
    const projectId = seedProject();
    const dispatched = dispatchBackgroundSession({
      agentType: "probe",
      projectId,
      prompt: "the real prompt",
      resolvedAgent: { provider: "codex", model: "gpt-5.4-codex" },
      mode: "plan",
      logPrefix: "[probe]",
      session: {
        batchRunId: "night-run-1",
        worktreePath: "/repos/bg/.arij-worktrees/x",
        branchName: "feature/x",
        orchestrationMode: "solo",
        // Not representable in the type; a caller that forces it through
        // still cannot re-default the provider or swap the prompt.
        ...({
          provider: "claude-code",
          prompt: "a different prompt",
          agentType: "impostor",
          epicId: "not-an-epic",
          compositeAgentId: "ca-impostor",
        } as Record<string, unknown>),
      },
    });
    await dispatched.settled;

    expect(getRow(dispatched.sessionId)).toMatchObject({
      batchRunId: "night-run-1",
      worktreePath: "/repos/bg/.arij-worktrees/x",
      branchName: "feature/x",
      orchestrationMode: "solo",
      provider: "codex",
      prompt: "the real prompt",
      agentType: "probe",
      epicId: null,
      compositeAgentId: null,
    });
    expect(pm.starts[0].provider).toBe("codex");
    expect(pm.starts[0].options.prompt).toBe("the real prompt");
  });

  it("creates the session's logs directory and dumps the result there", async () => {
    const projectId = seedProject();
    const dispatched = dispatchBackgroundSession({
      agentType: "probe",
      projectId,
      prompt: "p",
      resolvedAgent: { provider: "claude-code" },
      mode: "plan",
      logPrefix: "[probe]",
    });
    await dispatched.settled;

    expect(dispatched.logsPath).toMatch(
      new RegExp(`data[\\\\/]sessions[\\\\/]${dispatched.sessionId}[\\\\/]logs\\.json$`),
    );
    expect(getRow(dispatched.sessionId)?.logsPath).toBe(dispatched.logsPath);
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`${dispatched.sessionId}$`)),
      { recursive: true },
    );
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      dispatched.logsPath,
      expect.stringContaining('"success": true'),
    );
  });
});

describe("dispatchBackgroundSession — hook order and the terminal verdict", () => {
  it("onQueued fires with the row queued, before the spawn, with the row's timestamps", async () => {
    const projectId = seedProject();
    const order: string[] = [];
    let queuedContext: BackgroundSessionQueued | null = null;
    let statusAtQueued: string | null | undefined;
    pm.onStart = () => order.push("spawn");

    const dispatched = dispatchBackgroundSession({
      agentType: "probe",
      projectId,
      prompt: "p",
      resolvedAgent: { provider: "claude-code" },
      mode: "plan",
      logPrefix: "[probe]",
      onQueued: (context) => {
        order.push("queued");
        queuedContext = context;
        statusAtQueued = getRow(context.sessionId)?.status;
      },
    });
    await dispatched.settled;

    expect(order).toEqual(["queued", "spawn"]);
    expect(statusAtQueued).toBe("queued");
    expect(queuedContext).toEqual({
      sessionId: dispatched.sessionId,
      logsPath: dispatched.logsPath,
      createdAt: getRow(dispatched.sessionId)?.createdAt,
    });
  });

  it("evaluate decides the verdict before the row goes terminal, so a zero-exit run with nothing usable is a failure", async () => {
    const projectId = seedProject();
    let statusAtEvaluate: string | null | undefined;
    const terminals: Array<Record<string, unknown>> = [];

    const dispatched = dispatchBackgroundSession({
      agentType: "probe",
      projectId,
      prompt: "p",
      resolvedAgent: { provider: "claude-code" },
      mode: "plan",
      logPrefix: "[probe]",
      evaluate: (run) => {
        statusAtEvaluate = getRow(run.sessionId)?.status;
        // The CLI exited zero and answered — but the workflow found nothing
        // usable in the answer.
        expect(run.result?.success).toBe(true);
        expect(run.outcome).toBe("answered");
        return { success: false, error: "The output was empty after sanitisation." };
      },
      onTerminal: (terminal) => {
        terminals.push({
          success: terminal.success,
          error: terminal.error,
          outcome: terminal.outcome,
          rowStatus: getRow(terminal.sessionId)?.status,
        });
      },
    });
    const settled = await dispatched.settled;

    expect(statusAtEvaluate).toBe("running");
    expect(getRow(dispatched.sessionId)).toMatchObject({
      status: "failed",
      error: "The output was empty after sanitisation.",
      // The delivery verdict stays what the classifier said: the agent did
      // answer; the workflow simply refused the answer.
      outcome: "answered",
    });
    expect(terminals).toEqual([
      {
        success: false,
        error: "The output was empty after sanitisation.",
        outcome: "answered",
        rowStatus: "failed",
      },
    ]);
    expect(settled).toMatchObject({
      success: false,
      error: "The output was empty after sanitisation.",
      launchError: null,
    });
  });

  it("without evaluate, the provider's own success/error is the verdict", async () => {
    const projectId = seedProject();
    pm.status = {
      status: "failed",
      result: { success: false, error: "exit 1", duration: 10 },
    };

    const dispatched = dispatchBackgroundSession({
      agentType: "probe",
      projectId,
      prompt: "p",
      resolvedAgent: { provider: "claude-code" },
      mode: "plan",
      logPrefix: "[probe]",
    });
    const settled = await dispatched.settled;

    expect(getRow(dispatched.sessionId)).toMatchObject({
      status: "failed",
      error: "exit 1",
      outcome: "error",
    });
    expect(settled).toMatchObject({ success: false, error: "exit 1", outcome: "error" });
  });

  it("a cancelled process reaches onTerminal as status 'cancelled'", async () => {
    const projectId = seedProject();
    pm.status = {
      status: "cancelled",
      result: { success: false, error: "Cancelled by user", duration: 10 },
    };
    const seen: Array<string | undefined> = [];

    const dispatched = dispatchBackgroundSession({
      agentType: "probe",
      projectId,
      prompt: "p",
      resolvedAgent: { provider: "claude-code" },
      mode: "plan",
      logPrefix: "[probe]",
      onTerminal: ({ status }) => {
        seen.push(status);
      },
    });
    const settled = await dispatched.settled;

    expect(seen).toEqual(["cancelled"]);
    expect(settled.status).toBe("cancelled");
  });
});

describe("dispatchBackgroundSession — launch failures", () => {
  it("a spawn that throws fires onLaunchFailure synchronously, before the dispatch returns, and the row ends failed", async () => {
    const projectId = seedProject();
    pm.throwOnStart = new Error("claude: command not found");
    const failures: Array<{ error: unknown; context: BackgroundSessionQueued }> =
      [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const dispatched = dispatchBackgroundSession({
      agentType: "probe",
      projectId,
      prompt: "p",
      resolvedAgent: { provider: "claude-code" },
      mode: "plan",
      logPrefix: "[probe]",
      onLaunchFailure: (error, context) => {
        failures.push({ error, context });
      },
    });

    // Already fired: the scheduler ran the idle project's launch closure in
    // the submitting tick, and the hook received the id the caller has only
    // just been handed.
    expect(failures).toHaveLength(1);
    expect(failures[0].error).toBe(pm.throwOnStart);
    expect(failures[0].context).toEqual({
      sessionId: dispatched.sessionId,
      logsPath: dispatched.logsPath,
      createdAt: expect.any(String),
    });

    const settled = await dispatched.settled;
    expect(settled).toMatchObject({
      sessionId: dispatched.sessionId,
      success: false,
      outcome: "error",
      error: "claude: command not found",
      result: undefined,
      status: undefined,
    });
    expect(settled.launchError).toBe(pm.throwOnStart);

    // The scheduler's safety net owns the row and the slot: it is a separate
    // async path with no handle to await, so the wait is on the row itself.
    await waitForBackground(
      () =>
        expect(getRow(dispatched.sessionId)).toMatchObject({
          status: "failed",
          error: "claude: command not found",
        }),
      "the scheduler safety net finalizing the failed row",
    );
    expect(agentScheduler.getCounts(projectId)).toEqual({ running: 0, queued: 0 });
    expect(pm.starts).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it("an onTerminal that throws still settles with the verdict, reports the error, and leaves the terminal row alone", async () => {
    const projectId = seedProject();
    const launchFailures: unknown[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const dispatched = dispatchBackgroundSession({
      agentType: "probe",
      projectId,
      prompt: "p",
      resolvedAgent: { provider: "claude-code" },
      mode: "plan",
      logPrefix: "[probe]",
      onTerminal: () => {
        throw new Error("listener exploded");
      },
      onLaunchFailure: (error) => {
        launchFailures.push(error);
      },
    });
    const settled = await dispatched.settled;

    expect(settled.success).toBe(true);
    expect(settled.outcome).toBe("answered");
    expect(settled.launchError).toBeInstanceOf(Error);
    expect((settled.launchError as Error).message).toBe("listener exploded");
    expect(launchFailures).toHaveLength(1);
    expect((launchFailures[0] as Error).message).toBe("listener exploded");

    // Already terminal when the hook threw; the safety net's second write is
    // a lifecycle conflict and stays silent. The ROW is settled by the promise
    // above, but the SLOT is released by that same safety net afterwards —
    // hence the wait on the count rather than on the row.
    expect(getRow(dispatched.sessionId)).toMatchObject({
      status: "completed",
      error: null,
    });
    await waitForBackground(
      () => expect(agentScheduler.getCounts(projectId)).toEqual({ running: 0, queued: 0 }),
      "the safety net releasing the project slot",
    );
    errorSpy.mockRestore();
  });
});
