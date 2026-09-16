/**
 * Does the Full Auto supervisor actually DISPATCH the agent that was chosen?
 *
 * `full-auto-agent-settings.test.tsx` proves the two `/settings` pills write
 * the bare keys, and `resolveAutoModeConfig` — a pure function — proves the
 * precedence. Neither observes a dispatch: between the resolver and the CLI
 * sit the engine's per-kind resolution, `defaultDispatch`, the stage driver
 * and `resolveAgentByNamedId`, and a wrong hand-off anywhere in that chain
 * would leave both of those tests green while unattended work ran on the
 * fallback agent. That is the gap this file closes.
 *
 * SO NOTHING IN THE CHAIN IS SIMULATED. The real `sweepProject` with the real
 * `defaultAutoModeDeps` — real settings-backed `resolveAutoModeConfigForProject`,
 * real candidate selection, real `defaultDispatch`, real
 * `createPipelineStageDriver`, real `resolveAgentByNamedId` against a real
 * `named_agents` table on the real migrated schema. In particular
 * `@/lib/agent-config/agent-resolution` is NOT mocked here, unlike in
 * auto-mode-e2e and pipeline-stages-dispatch — mocking it is precisely how a
 * broken hand-off would hide.
 *
 * Only the CLI child process is faked, and it takes no part in the choice: by
 * the time `processManager.start` is called the agent is already decided, and
 * the two things this file reads — the `agent_sessions` row and that call's
 * arguments — are the last two places the decision is observable before a
 * real binary is executed.
 *
 * Settings are written the way `PATCH /api/settings` writes them
 * (`JSON.stringify` of the editor value, `null` for "Default"), so the stored
 * encoding under test is the one the band actually produces, not a
 * convenient one.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";

const processManagerState = vi.hoisted(() => ({
  result: {
    type: "result",
    subtype: "success",
    success: true,
    result: "done",
  } as Record<string, unknown> | undefined,
}));

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

vi.mock("@/lib/claude/process-manager", () => ({
  processManager: {
    start: vi.fn(),
    getStatus: vi.fn(() => ({
      status: "completed",
      result: processManagerState.result,
    })),
  },
}));

vi.mock("@/lib/git/manager", () => ({
  createWorktree: vi.fn().mockResolvedValue({
    worktreePath: "/tmp/worktree",
    branchName: "feature/full-auto-dispatch",
  }),
  attachWorktree: vi.fn(),
  mergeWorktree: vi.fn(),
  isGitRepo: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/sync/export", () => ({ tryExportArjiJson: vi.fn() }));

vi.mock("@/lib/agent-config/prompts", () => ({
  resolveAgentPrompt: vi.fn().mockResolvedValue("system prompt"),
}));

vi.mock("@/lib/events/emit", () => ({
  emitSessionStarted: vi.fn(),
  emitSessionCompleted: vi.fn(),
  emitSessionFailed: vi.fn(),
  emitTicketMoved: vi.fn(),
  emitTicketUpdated: vi.fn(),
}));

vi.mock("@/lib/documents/mentions", () => ({
  buildMentionContextBlock: vi.fn(() => ""),
  enrichPromptWithDocumentMentions: vi.fn(
    ({ prompt }: { prompt: string }) => ({ prompt, missing: [] })
  ),
  userAuthoredTexts: vi.fn(() => []),
}));

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

const { db } = await import("@/lib/db");
const {
  projects,
  epics,
  agentSessions,
  namedAgents,
  compositeAgentMembers,
  settings,
  ticketActivityLog,
} = await import("@/lib/db/schema");
const { processManager } = await import("@/lib/claude/process-manager");
const { sweepProject } = await import("@/lib/auto-mode/engine");
const {
  AUTO_MODE_BUILD_AGENT_SETTING_KEY,
  autoModeBuildAgentSettingKey,
  autoModeEnabledSettingKey,
} = await import("@/lib/auto-mode/constants");
const { COMPOSITE_AGENT_PROVIDER } = await import(
  "@/lib/agent-config/constants"
);

/** The two agents every case picks between. Seeded once, name-unique. */
const BUILDER = {
  id: "na-workspace-builder",
  name: "Workspace Builder",
  provider: "claude-code",
  model: "opus",
};
const OVERRIDE = {
  id: "na-project-builder",
  name: "Project Builder",
  provider: "codex",
  model: "gpt-5.4-codex",
};

let seeded = false;
let counter = 0;

/** Exactly what `PATCH /api/settings` stores for one key. */
function putSetting(key: string, value: unknown) {
  db.insert(settings)
    .values({
      key,
      value: JSON.stringify(value),
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: JSON.stringify(value), updatedAt: new Date().toISOString() },
    })
    .run();
}

/**
 * A project with one buildable epic and Full Auto armed FOR THIS PROJECT.
 *
 * Enabled is scoped per project on purpose: the bare `auto_mode_enabled` is a
 * workspace flag, and arming it here would make every other case's project
 * sweep too.
 */
function seedProject(): { projectId: string; epicId: string } {
  if (!seeded) {
    db.insert(namedAgents).values([BUILDER, OVERRIDE]).run();
    seeded = true;
  }

  counter += 1;
  const projectId = `proj-fa-${counter}`;
  const epicId = `epic-fa-${counter}`;

  db.insert(projects)
    .values({ id: projectId, name: "Full Auto Project", gitRepoPath: "/repos/fa" })
    .run();
  db.insert(epics)
    .values({
      id: epicId,
      projectId,
      title: "Buildable epic",
      status: "todo",
      position: 0,
      readableId: `E-fa-${counter}`,
    })
    .run();

  putSetting(autoModeEnabledSettingKey(projectId), true);
  return { projectId, epicId };
}

/** The build session the sweep created, or null if it dispatched nothing. */
function dispatchedSession(projectId: string) {
  return (
    db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.projectId, projectId))
      .all()
      .find((row) => row.agentType === "build") ?? null
  );
}

/** The arguments the fake CLI spawn was called with for that session. */
function spawnFor(sessionId: string) {
  const call = vi
    .mocked(processManager.start)
    .mock.calls.find((entry) => entry[0] === sessionId);
  expect(call, "processManager.start was never called for the session").toBeTruthy();
  return {
    opts: call![1] as unknown as Record<string, unknown>,
    provider: call![2] as string,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.delete(settings).where(eq(settings.key, AUTO_MODE_BUILD_AGENT_SETTING_KEY)).run();
});

describe("Full Auto dispatch — the chosen agent reaches the session", () => {
  it("puts the workspace default (the bare key) on the session it creates", async () => {
    const { projectId, epicId } = seedProject();
    putSetting(AUTO_MODE_BUILD_AGENT_SETTING_KEY, BUILDER.id);

    const result = await sweepProject(projectId);

    expect(result.skipped).toBeNull();
    // `buildsDispatched` carries SESSION ids, so the epic is read back off the
    // row rather than asserted against that list.
    expect(result.buildsDispatched).toHaveLength(1);
    const session = dispatchedSession(projectId);
    expect(session).toBeTruthy();
    expect(session!.id).toBe(result.buildsDispatched[0]);
    expect(session!.epicId).toBe(epicId);
    expect(session!.namedAgentId).toBe(BUILDER.id);
    expect(session!.namedAgentName).toBe(BUILDER.name);
    expect(session!.provider).toBe(BUILDER.provider);
    expect(session!.model).toBe(BUILDER.model);

    // …and the same identity reaches the spawn, not just the row.
    const spawn = spawnFor(session!.id);
    expect(spawn.provider).toBe(BUILDER.provider);
    expect(spawn.opts.model).toBe(BUILDER.model);
  });

  it("lets a per-project override beat the workspace default", async () => {
    const { projectId } = seedProject();
    putSetting(AUTO_MODE_BUILD_AGENT_SETTING_KEY, BUILDER.id);
    putSetting(autoModeBuildAgentSettingKey(projectId), OVERRIDE.id);

    await sweepProject(projectId);

    const session = dispatchedSession(projectId);
    expect(session!.namedAgentId).toBe(OVERRIDE.id);
    expect(session!.provider).toBe(OVERRIDE.provider);
    expect(spawnFor(session!.id).provider).toBe(OVERRIDE.provider);
  });

  it("falls back to the workspace default when the override is cleared to Default", async () => {
    const { projectId } = seedProject();
    putSetting(AUTO_MODE_BUILD_AGENT_SETTING_KEY, BUILDER.id);
    // "Default" in the popover clears the override — the row stays, holding
    // null, which is the case a `map.has(key)` check would get wrong.
    putSetting(autoModeBuildAgentSettingKey(projectId), null);

    await sweepProject(projectId);

    const session = dispatchedSession(projectId);
    expect(session!.namedAgentId).toBe(BUILDER.id);
    expect(session!.provider).toBe(BUILDER.provider);
  });

  it("dispatches with no named agent at all when both levels say Default", async () => {
    const { projectId } = seedProject();
    putSetting(AUTO_MODE_BUILD_AGENT_SETTING_KEY, null);
    putSetting(autoModeBuildAgentSettingKey(projectId), null);

    await sweepProject(projectId);

    const session = dispatchedSession(projectId);
    expect(session).toBeTruthy();
    expect(session!.namedAgentId).toBeNull();
    // Not a crash and not a blank-named agent: the built-in fallback runs.
    expect(session!.provider).toBe("claude-code");
  });

  it("ignores a stored id whose agent has been deleted rather than dispatching a ghost", async () => {
    const { projectId } = seedProject();
    putSetting(AUTO_MODE_BUILD_AGENT_SETTING_KEY, "na-deleted-agent");

    await sweepProject(projectId);

    const session = dispatchedSession(projectId);
    expect(session).toBeTruthy();
    expect(session!.namedAgentId).toBeNull();
    expect(session!.provider).toBe("claude-code");
  });
});

/* ------------------------------------------------------------------ */
/* The composite ladder                                                */
/* ------------------------------------------------------------------ */

const COMPOSITE_ID = "na-ladder";

/** A composite over BUILDER then OVERRIDE — the ordered fallback list. */
function seedComposite(): void {
  db.insert(namedAgents)
    .values({
      id: COMPOSITE_ID,
      name: "Ladder",
      kind: "composite",
      provider: COMPOSITE_AGENT_PROVIDER,
      model: "",
    })
    .onConflictDoNothing()
    .run();
  db.insert(compositeAgentMembers)
    .values([
      { id: "cm-0", compositeId: COMPOSITE_ID, memberId: BUILDER.id, position: 0 },
      { id: "cm-1", compositeId: COMPOSITE_ID, memberId: OVERRIDE.id, position: 1 },
    ])
    .onConflictDoNothing()
    .run();
}

/** Every build session of the project, in dispatch order. */
function buildSessions(projectId: string) {
  return db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.projectId, projectId))
    .all()
    .filter((row) => row.agentType === "build");
}

/** The build is a failure from now on — the CLI reports an error result. */
function failEveryBuild(): void {
  processManagerState.result = {
    type: "result",
    subtype: "error",
    success: false,
    error: "boom",
  };
}

/** Waits for the launch closure to finalize the row, which is asynchronous. */
async function waitForTerminal(sessionId: string): Promise<string> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const status = db
      .select({ status: agentSessions.status })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get()?.status;
    if (status && status !== "queued" && status !== "running") return status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Session ${sessionId} never reached a terminal status`);
}

function autoReasons(epicId: string): string[] {
  return db
    .select()
    .from(ticketActivityLog)
    .where(eq(ticketActivityLog.epicId, epicId))
    .all()
    .map((row) => row.reason ?? "");
}

describe("Full Auto dispatch — a composite descends its own ladder", () => {
  it("runs the next member after a failed build, then parks at the end of the list", async () => {
    const { projectId, epicId } = seedProject();
    seedComposite();
    putSetting(autoModeBuildAgentSettingKey(projectId), COMPOSITE_ID);
    failEveryBuild();

    // Attempt 1 — the ticket has no failures yet, so rank 0 runs.
    await sweepProject(projectId);
    const [first] = buildSessions(projectId);
    expect(first.namedAgentId).toBe(BUILDER.id);
    expect(first.compositeAgentId).toBe(COMPOSITE_ID);
    expect(first.provider).toBe(BUILDER.provider);
    expect(await waitForTerminal(first.id)).toBe("failed");

    // Attempt 2 — one failure charged, so the list descends to rank 1. This
    // is the whole point of a composite, and it is the behaviour that was
    // missing: the mode used to re-dispatch attempt 1 forever.
    await sweepProject(projectId);
    const sessions = buildSessions(projectId);
    expect(sessions).toHaveLength(2);
    const second = sessions[1];
    expect(second.namedAgentId).toBe(OVERRIDE.id);
    expect(second.compositeAgentId).toBe(COMPOSITE_ID);
    expect(spawnFor(second.id).provider).toBe(OVERRIDE.provider);

    // …and the feed says why the agent changed, without opening the dead
    // session.
    expect(autoReasons(epicId)).toContain(
      `Auto mode composite fallback: build moved from ${BUILDER.name} to ${OVERRIDE.name} (attempt 2/2) because build session failed`
    );

    expect(await waitForTerminal(second.id)).toBe("failed");

    // Attempt 3 — the list is spent. The member count IS the cap, so the
    // ticket parks here instead of re-running the member that just failed.
    const third = await sweepProject(projectId);
    expect(third.parked).toContain(epicId);
    expect(third.buildsDispatched).toEqual([]);
    expect(buildSessions(projectId)).toHaveLength(2);
  });

  it("keeps a simple agent on attempt 1 and on the mode's own cap", async () => {
    const { projectId, epicId } = seedProject();
    putSetting(autoModeBuildAgentSettingKey(projectId), BUILDER.id);
    failEveryBuild();

    // Three failures: the default cap, not a composite's shorter list. A
    // simple agent has no ladder, so nothing about the streak changes WHO runs.
    for (let sweep = 0; sweep < 3; sweep++) {
      await sweepProject(projectId);
      const sessions = buildSessions(projectId);
      expect(sessions.at(-1)!.namedAgentId).toBe(BUILDER.id);
      await waitForTerminal(sessions.at(-1)!.id);
    }

    const fourth = await sweepProject(projectId);
    expect(fourth.parked).toContain(epicId);
    expect(buildSessions(projectId)).toHaveLength(3);
    expect(
      autoReasons(epicId).filter((reason) =>
        reason.includes("composite fallback")
      )
    ).toEqual([]);
  });
});
