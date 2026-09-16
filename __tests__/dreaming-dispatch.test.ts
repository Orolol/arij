/**
 * Dreaming — dispatch, guards and triggers, end-to-end against the real
 * migrated schema with the CLI spawn mocked.
 *
 * Covers the acceptance criteria of "Session dreaming + réécriture gardée" and
 * "Déclencheurs + garde-fous + notification":
 *   - a plan-mode 'dreaming' session with NO epicId, carrying the imposed
 *     section structure and the cross-session digest,
 *   - the memory is replaced ONLY when the session delivers (asked_question,
 *     silent and failures leave it exactly as it was),
 *   - the pre-dream memory is snapshotted and a deep-linked notification
 *     summarizes the change,
 *   - never two dreams at once on a project,
 *   - a journalled no-op when nothing happened since the last dream,
 *   - the night-run trigger: OFF by default, tri-state resolution, and the
 *     run id inherited as batch_run_id so the dream stays inside the cost cap.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { claudeEnvelope } from "./helpers/provider-fixtures";

const processManagerState = vi.hoisted(() => ({
  result: undefined as Record<string, unknown> | undefined,
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

vi.mock("@/lib/agent-config/prompts", () => ({
  resolveAgentPrompt: vi.fn().mockResolvedValue("dreaming system prompt"),
}));

vi.mock("@/lib/agent-config/agent-resolution", () => ({
  resolveAgentByNamedId: vi.fn(() => ({
    provider: "claude-code",
    namedAgentId: null,
    name: null,
    model: null,
  })),
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
  settings,
  documents,
} = await import("@/lib/db/schema");
const {
  dispatchDreamingSession,
  evaluateDreamGuards,
  evaluateNightRunDreamGuards,
  maybeDreamAfterNightRun,
} = await import("@/lib/workflow/dreaming");
// The settings rows live in their own module: the facade no longer re-exports
// them, so the tests read them where production code does.
const {
  findLastDreamCutoff,
  isDreamingAfterNightRunEnabled,
  recordDreamCutoff,
} = await import("@/lib/workflow/dreaming-settings");
const { isWritableSettingKey } = await import("@/lib/settings/writable-keys");
const { eventBus } = await import("@/lib/events/bus");
type BusEvent = import("@/lib/events/bus").TicketEvent;
const { processManager } = await import("@/lib/claude/process-manager");
const { hasPendingMemoryWriter } = await import(
  "@/lib/workflow/memory-writer-lock"
);
const { dispatchMemoryDistillSession } = await import(
  "@/lib/workflow/memory-distill"
);
const {
  getProjectMemoryArchiveDoc,
  getProjectMemoryContent,
  sanitizeMemoryDocument,
  saveProjectMemory,
} = await import("@/lib/documents/memory");
const { getMemoryWriteProvenance } = await import(
  "@/lib/documents/memory-provenance"
);
const {
  PROJECT_MEMORY_MAX_CHARS,
  PROJECT_MEMORY_MAX_TOKENS,
} = await import("@/lib/documents/memory-constants");
const {
  DREAMING_AFTER_NIGHT_RUN_SETTING_KEY,
  DREAMING_AGENT_TYPE,
  DREAMING_MEMORY_SECTIONS,
} = await import("@/lib/workflow/dreaming-constants");
const { sumNightRunCost } = await import("@/lib/night/summary");

let counter = 0;
let projectId = "";
let epicId = "";
/** Every bus event of the current test's project, in emission order. */
let busEvents: BusEvent[] = [];
let unsubscribeBus: (() => void) | null = null;

function eventsOfType(type: string): BusEvent[] {
  return busEvents.filter((event) => event.type === type);
}

function sessionRow(sessionId: string) {
  return db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get()!;
}

function seedProject() {
  counter += 1;
  projectId = `proj-dreamd-${counter}`;
  epicId = `epic-dreamd-${counter}`;
  db.insert(projects)
    .values({ id: projectId, name: "Dream Project", gitRepoPath: "/repos/d" })
    .run();
  db.insert(epics)
    .values({
      id: epicId,
      projectId,
      title: "Checkout flow",
      status: "review",
      position: 0,
      readableId: `E-dd-${counter}`,
    })
    .run();
}

let sessionSeq = 0;

function seedSourceSession(
  overrides: Partial<typeof agentSessions.$inferInsert> = {}
): string {
  sessionSeq += 1;
  const id = `src-${counter}-${sessionSeq}`;
  const now = new Date().toISOString();
  db.insert(agentSessions)
    .values({
      id,
      projectId,
      epicId,
      status: "completed",
      agentType: "ticket_build",
      outcome: "answered",
      provider: "claude-code",
      lastNonEmptyText: "Learned: envelope every API response.",
      createdAt: now,
      startedAt: now,
      endedAt: now,
      completedAt: now,
      ...overrides,
    })
    .run();
  return id;
}

function dreamSessions() {
  return db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.projectId, projectId))
    .all()
    .filter((row) => row.agentType === DREAMING_AGENT_TYPE);
}

beforeEach(() => {
  vi.clearAllMocks();
  // The GLOBAL dreaming setting outlives a test — every project reads it, so a
  // test that turns it on would silently arm every test after it. Each test
  // states its own global answer (its per-project key is fresh with the
  // project).
  db.delete(settings)
    .where(eq(settings.key, DREAMING_AFTER_NIGHT_RUN_SETTING_KEY))
    .run();
  seedProject();
  unsubscribeBus?.();
  busEvents = [];
  unsubscribeBus = eventBus.subscribe(projectId, (event) => {
    busEvents.push(event);
  });
  processManagerState.result = {
    success: true,
    result: claudeEnvelope(
      DREAMING_MEMORY_SECTIONS.map((title) => `## ${title}\n\n- something`).join(
        "\n\n"
      )
    ),
    duration: 1000,
  };
});

describe("evaluateDreamGuards", () => {
  it("refuses while any memory writer is pending", () => {
    const decision = evaluateDreamGuards({
      hasPendingMemoryWriter: true,
      sessionCount: 12,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("already pending");
    // A code next to the sentence: the panel translates the code, never the
    // server's English phrase.
    expect(decision.code).toBe("writer_pending");
  });

  it("refuses when the window turned up nothing", () => {
    const decision = evaluateDreamGuards({
      hasPendingMemoryWriter: false,
      sessionCount: 0,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("no new sessions");
    expect(decision.code).toBe("no_new_sessions");
  });

  it("allows a project with fresh evidence and no rewrite in flight", () => {
    expect(
      evaluateDreamGuards({ hasPendingMemoryWriter: false, sessionCount: 1 })
    ).toEqual({ allowed: true, reason: "eligible", code: "eligible" });
  });
});

/**
 * The dream is dispatched from the run's terminal choke point, past the wave
 * engine's last cost-cap check — so the cap has to be re-applied here or it
 * simply does not apply to the dream at all.
 */
describe("evaluateNightRunDreamGuards", () => {
  const base = {
    enabled: true,
    abortReason: null as string | null,
    costCapUsd: null as number | null,
    spentUsd: 0,
  };

  it("refuses when the setting is off", () => {
    expect(evaluateNightRunDreamGuards({ ...base, enabled: false })).toEqual({
      allowed: false,
      reason: "dreaming_after_night_run is off",
    });
  });

  it("refuses after a user stop — stopping a run means stopping its spend", () => {
    const decision = evaluateNightRunDreamGuards({
      ...base,
      abortReason: "stopped by user",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("stopped by the user");
  });

  it("refuses once the run's cost cap is reached", () => {
    const decision = evaluateNightRunDreamGuards({
      ...base,
      costCapUsd: 5,
      spentUsd: 5.4,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("cost cap");
  });

  it("allows a run still under its cap", () => {
    expect(
      evaluateNightRunDreamGuards({ ...base, costCapUsd: 5, spentUsd: 4.99 })
    ).toEqual({ allowed: true, reason: "eligible" });
  });

  it("allows an uncapped run whatever it spent", () => {
    expect(
      evaluateNightRunDreamGuards({ ...base, costCapUsd: null, spentUsd: 999 })
        .allowed
    ).toBe(true);
  });

  it("still dreams after a circuit-breaker trip — that run has the most to teach", () => {
    expect(
      evaluateNightRunDreamGuards({
        ...base,
        abortReason: "circuit breaker: 3 consecutive pipeline failures",
      }).allowed
    ).toBe(true);
  });
});

describe("dispatchDreamingSession", () => {
  it("runs a plan-mode dreaming session and replaces the memory on delivery", async () => {
    saveProjectMemory(projectId, "- Old rule: keep tests green");
    seedSourceSession({ lastNonEmptyText: "SOURCE SESSION TEXT" });

    const result = await dispatchDreamingSession({ projectId, trigger: "manual" });
    await result.settled;

    expect(result.dispatched).toBe(true);
    expect(result.sessionsAnalyzed).toBe(1);

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, result.sessionId!))
      .get();
    expect(session).toMatchObject({
      agentType: "dreaming",
      status: "completed",
      outcome: "answered",
      projectId,
      mode: "plan",
      // Never holds an epic slot: a dream spans every ticket and must block none.
      epicId: null,
      batchRunId: null,
    });

    // The prompt frames the current memory, the digest and the imposed sections.
    expect(session!.prompt).toContain("dreaming system prompt");
    expect(session!.prompt).toContain("## Current Project Memory");
    expect(session!.prompt).toContain("- Old rule: keep tests green");
    expect(session!.prompt).toContain("## Recent Sessions Digest");
    expect(session!.prompt).toContain("SOURCE SESSION TEXT");
    expect(session!.prompt).toContain("**Sessions analyzed:** 1");
    for (const title of DREAMING_MEMORY_SECTIONS) {
      expect(session!.prompt).toContain(`## ${title}`);
    }

    // The memory document now holds the dreamed text.
    const memory = getProjectMemoryContent(projectId)!;
    for (const title of DREAMING_MEMORY_SECTIONS) {
      expect(memory).toContain(`## ${title}`);
    }

    // A dream that landed says so on its row and on the bus — and only that.
    expect(session).toMatchObject({ error: null });
    expect(eventsOfType("memory:changed")).toHaveLength(1);
    expect(eventsOfType("memory:discarded")).toHaveLength(0);
    expect(eventsOfType("session:completed")).toHaveLength(1);
  });

  it("snapshots the memory it overwrites", async () => {
    saveProjectMemory(projectId, "- Rule that is about to be replaced");
    seedSourceSession();

    await (await dispatchDreamingSession({ projectId })).settled;

    const archive = getProjectMemoryArchiveDoc(projectId);
    expect(archive?.markdownContent).toBe("- Rule that is about to be replaced");
    expect(archive?.kind).toBe("memory_archive");
    // The live memory moved on.
    expect(getProjectMemoryContent(projectId)).not.toBe(
      "- Rule that is about to be replaced"
    );
  });

  it("records the dream as the memory's provenance, with its session", async () => {
    saveProjectMemory(projectId, "x".repeat(120));
    seedSourceSession();

    const result = await dispatchDreamingSession({ projectId });
    await result.settled;

    // The memory panel reads the last-write provenance; there is no
    // notification row to assert on.
    const provenance = getMemoryWriteProvenance(projectId);
    expect(provenance?.source).toBe("dreaming");
    expect(provenance?.sessionId).toBe(result.sessionId);
  });

  it("enforces the memory cap on the dreamed output", async () => {
    seedSourceSession();
    // Over the cap, but the four headings all sit inside it — so capping
    // trims the tail of the LAST section and the document stays well-formed.
    processManagerState.result = {
      success: true,
      result: claudeEnvelope(
        DREAMING_MEMORY_SECTIONS.map(
          (title) => `## ${title}\n\n- a rule`
        ).join("\n\n") + `\n- ${"x".repeat(PROJECT_MEMORY_MAX_CHARS + 500)}`
      ),
      duration: 1000,
    };

    await (await dispatchDreamingSession({ projectId })).settled;

    expect(getProjectMemoryContent(projectId)).toHaveLength(
      PROJECT_MEMORY_MAX_CHARS
    );
    expect(PROJECT_MEMORY_MAX_TOKENS).toBe(10_000);
  });

  /**
   * The prompt imposes four sections; a prompt is not a guarantee. Storing an
   * unstructured document would put it into every future prompt AND mark the
   * window as learned, so the dream is discarded instead — and the window stays
   * open for the retry.
   */
  it("refuses a delivered answer that ignored the section structure", async () => {
    saveProjectMemory(projectId, "- EXISTING MEMORY");
    seedSourceSession();
    processManagerState.result = {
      success: true,
      result: claudeEnvelope(
        "Here is a summary of everything I read across the sessions."
      ),
      duration: 1000,
    };

    const result = await dispatchDreamingSession({ projectId });
    await result.settled;

    // The agent answered, but the row must not claim success over a memory
    // that did not change: failed, with the reason in its error column.
    const row = sessionRow(result.sessionId!);
    expect(row.outcome).toBe("answered");
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/structure/i);
    // The discard is announced as such — a code, not a sentence, for the panel.
    expect(eventsOfType("memory:discarded")).toEqual([
      expect.objectContaining({
        data: {
          source: "dreaming",
          reason: "invalid_structure",
          sessionId: result.sessionId,
        },
      }),
    ]);
    expect(eventsOfType("memory:changed")).toHaveLength(0);
    expect(eventsOfType("session:failed")).toHaveLength(1);
    // ...and nothing was stored, nothing archived, nothing claimed.
    expect(getProjectMemoryContent(projectId)).toBe("- EXISTING MEMORY");
    expect(getProjectMemoryArchiveDoc(projectId)).toBeNull();
    expect(findLastDreamCutoff(projectId)).toBeNull();
  });

  /**
   * The truncation case the cap creates: a response long enough that capping
   * cuts a whole section off. It is validated on the text that WOULD BE
   * STORED, so this is caught rather than saved half-written.
   */
  it("refuses an over-cap answer whose last sections the cap would cut off", async () => {
    saveProjectMemory(projectId, "- EXISTING MEMORY");
    seedSourceSession();
    processManagerState.result = {
      success: true,
      result: claudeEnvelope(
        DREAMING_MEMORY_SECTIONS.map(
          (title) =>
            `## ${title}\n\n${"- a long rule\n".repeat(
              Math.ceil(PROJECT_MEMORY_MAX_CHARS / "- a long rule\n".length)
            )}`
        ).join("\n")
      ),
      duration: 1000,
    };

    await (await dispatchDreamingSession({ projectId })).settled;

    expect(getProjectMemoryContent(projectId)).toBe("- EXISTING MEMORY");
    expect(findLastDreamCutoff(projectId)).toBeNull();
  });

  it("refuses sections delivered out of order", async () => {
    seedSourceSession();
    processManagerState.result = {
      success: true,
      result: claudeEnvelope(
        [
          DREAMING_MEMORY_SECTIONS[3],
          DREAMING_MEMORY_SECTIONS[0],
          DREAMING_MEMORY_SECTIONS[1],
          DREAMING_MEMORY_SECTIONS[2],
        ]
          .map((title) => `## ${title}\n\n- a rule`)
          .join("\n\n")
      ),
      duration: 1000,
    };

    await (await dispatchDreamingSession({ projectId })).settled;

    expect(getProjectMemoryContent(projectId)).toBeNull();
    expect(findLastDreamCutoff(projectId)).toBeNull();
  });

  it("unwraps an accidental full-document code fence", async () => {
    seedSourceSession();
    // A well-formed document that merely arrived wrapped: unwrapping has to
    // happen BEFORE the structure check, or the fence would look like a
    // missing first heading and the whole dream would be thrown away.
    const body = DREAMING_MEMORY_SECTIONS.map(
      (title) => `## ${title}\n\n- fenced rule`
    ).join("\n\n");
    processManagerState.result = {
      success: true,
      result: claudeEnvelope(`\`\`\`markdown\n${body}\n\`\`\``),
      duration: 1000,
    };

    await (await dispatchDreamingSession({ projectId })).settled;

    expect(getProjectMemoryContent(projectId)).toBe(body);
  });

  it("inherits the batch run id so the dream stays inside the night cost cap", async () => {
    const runId = `night_dream_${counter}`;
    seedSourceSession({ batchRunId: runId, totalCostUsd: 3 });
    processManagerState.result = {
      success: true,
      result: claudeEnvelope("## Codebase pitfalls\n\n- rule", { costUsd: 0.5 }),
      duration: 1000,
    };

    const result = await dispatchDreamingSession({
      projectId,
      batchRunId: runId,
      trigger: "night_run",
    });
    await result.settled;

    const row = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, result.sessionId!))
      .get();
    expect(row!.batchRunId).toBe(runId);
    expect(row!.epicId).toBeNull();
    // 3 (source build) + 0.5 (the dream) — the cap query is untouched.
    expect(sumNightRunCost(runId)).toBeCloseTo(3.5, 10);
  });

  it("throws for an unknown project", async () => {
    await expect(
      dispatchDreamingSession({ projectId: "nope" })
    ).rejects.toThrow("Project not found");
  });
});

describe("dispatchDreamingSession — the memory is only replaced on delivery", () => {
  it("leaves the memory untouched when the dream asked a question", async () => {
    saveProjectMemory(projectId, "- Untouched rule");
    seedSourceSession();
    processManagerState.result = {
      success: true,
      result: claudeEnvelope("Should I drop the legacy section?"),
      endedWithQuestion: true,
      duration: 1000,
    };

    const result = await dispatchDreamingSession({ projectId });
    await result.settled;

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, result.sessionId!))
      .get();
    expect(session!.outcome).toBe("asked_question");
    expect(getProjectMemoryContent(projectId)).toBe("- Untouched rule");
    expect(getProjectMemoryArchiveDoc(projectId)).toBeNull();
  });

  it("leaves the memory untouched when the dream failed", async () => {
    saveProjectMemory(projectId, "- Untouched rule");
    seedSourceSession();
    processManagerState.result = {
      success: false,
      error: "CLI crashed",
      duration: 10,
    };

    await (await dispatchDreamingSession({ projectId })).settled;

    expect(getProjectMemoryContent(projectId)).toBe("- Untouched rule");
    expect(getProjectMemoryArchiveDoc(projectId)).toBeNull();
  });

  it("leaves the memory untouched when the dream produced nothing", async () => {
    saveProjectMemory(projectId, "- Untouched rule");
    seedSourceSession();
    processManagerState.result = { success: true, result: "", duration: 10 };

    await (await dispatchDreamingSession({ projectId })).settled;

    expect(getProjectMemoryContent(projectId)).toBe("- Untouched rule");
    expect(getProjectMemoryArchiveDoc(projectId)).toBeNull();
  });
});

/**
 * The window may only advance when the memory REALLY changed. A dream that
 * answered but whose write threw taught the project nothing, so the sessions
 * it read must still be readable by the next dream.
 */
describe("dispatchDreamingSession — the window only advances on a real write", () => {
  it("records the collection cutoff after a successful rewrite", async () => {
    seedSourceSession();
    expect(findLastDreamCutoff(projectId)).toBeNull();

    await (await dispatchDreamingSession({ projectId })).settled;

    const cutoff = findLastDreamCutoff(projectId);
    expect(cutoff).not.toBeNull();
    expect(Number.isNaN(Date.parse(cutoff!))).toBe(false);
  });

  it("does NOT record a cutoff when the dream did not deliver", async () => {
    seedSourceSession();
    processManagerState.result = {
      success: true,
      result: claudeEnvelope("Should I drop the legacy section?"),
      endedWithQuestion: true,
      duration: 1000,
    };

    await (await dispatchDreamingSession({ projectId })).settled;

    expect(findLastDreamCutoff(projectId)).toBeNull();
  });

  it("does NOT record a cutoff when persisting the dreamed memory fails", async () => {
    const sourceId = seedSourceSession();
    // A real, un-mocked write failure: the memory document is created with the
    // filename "Project memory", and documents are unique per (project, name).
    // Squatting that name makes saveProjectMemory throw exactly as a disk or
    // constraint error would.
    db.insert(documents)
      .values({
        id: `squatter-${counter}`,
        projectId,
        originalFilename: "Project memory",
        kind: "text",
        markdownContent: "not the memory doc",
        mimeType: "text/markdown",
        sizeBytes: 19,
      })
      .run();

    const result = await dispatchDreamingSession({ projectId });
    await result.settled;

    // The session answered, but its row records that the write never landed...
    const session = sessionRow(result.sessionId!);
    expect(session.outcome).toBe("answered");
    expect(session.status).toBe("failed");
    expect(session.error).toBeTruthy();
    expect(eventsOfType("memory:discarded")).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ reason: "save_failed" }),
      }),
    ]);
    // ...nothing was stored, so the window stayed shut and no notification
    // claimed otherwise.
    expect(getProjectMemoryContent(projectId)).toBeNull();
    expect(findLastDreamCutoff(projectId)).toBeNull();

    // And the evidence is still on the table for the next dream.
    db.delete(documents)
      .where(eq(documents.id, `squatter-${counter}`))
      .run();
    const retry = await dispatchDreamingSession({ projectId });
    await retry.settled;
    expect(retry.dispatched).toBe(true);
    expect(retry.sessionsAnalyzed).toBe(1);
    expect(retry.sessionId).not.toBe(result.sessionId);
    expect(sourceId).toBeTruthy();
  });
});

/**
 * 'memory_distill' and 'dreaming' replace the SAME whole document. Their
 * triggers are unrelated (a finished build auto-distills while a finished
 * night run dreams), so without a shared lock the slower one silently
 * overwrites the faster one.
 */
describe("memory writers exclude each other", () => {
  it("refuses a dream while a distill is queued", async () => {
    seedSourceSession();
    seedSourceSession({
      agentType: "memory_distill",
      status: "queued",
      outcome: null,
      epicId: null,
    });

    expect(hasPendingMemoryWriter(projectId)).toBe(true);
    const result = await dispatchDreamingSession({ projectId });
    await result.settled;

    expect(result.dispatched).toBe(false);
    expect(result.reason).toContain("already pending");
    expect(dreamSessions()).toHaveLength(0);
  });

  it("refuses a distill while a dream is running", async () => {
    seedSourceSession({
      agentType: DREAMING_AGENT_TYPE,
      status: "running",
      outcome: null,
      epicId: null,
    });

    await expect(
      dispatchMemoryDistillSession({ projectId })
    ).rejects.toThrow(/already in progress/i);
  });

  it("lets only ONE of a simultaneous dream and distill through", async () => {
    seedSourceSession();

    const [dream, distill] = await Promise.allSettled([
      dispatchDreamingSession({ projectId }),
      dispatchMemoryDistillSession({ projectId }),
    ]);
    // Both settlements, so the loser's (absent) run is not left in flight
    // while the assertions read the database.
    await Promise.all(
      [dream, distill].map((outcome) =>
        outcome.status === "fulfilled" ? outcome.value.settled : undefined,
      ),
    );

    const dreamWon =
      dream.status === "fulfilled" && dream.value.dispatched === true;
    const distillWon = distill.status === "fulfilled";
    expect([dreamWon, distillWon].filter(Boolean)).toHaveLength(1);

    const writers = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.projectId, projectId))
      .all()
      .filter(
        (row) =>
          row.agentType === DREAMING_AGENT_TYPE ||
          row.agentType === "memory_distill"
      );
    expect(writers).toHaveLength(1);
  });
});

/**
 * A dream reads the memory when it builds its prompt and writes minutes later.
 * The Docs editor is live that whole time.
 */
describe("dispatchDreamingSession — a human edit mid-dream wins", () => {
  it("discards the dreamed output when the memory changed while it ran", async () => {
    saveProjectMemory(projectId, "- AS THE DREAM READ IT");
    seedSourceSession();

    // The edit lands from inside the running session rather than from a race:
    // getStatus is polled after the prompt captured the memory and before the
    // replacement, which is exactly when a Docs-tab save would arrive.
    vi.mocked(processManager.getStatus).mockImplementationOnce((() => {
      saveProjectMemory(projectId, "- A HUMAN EDITED THIS");
      return { status: "completed", result: processManagerState.result };
      // The module mock returns this loose shape everywhere; only the real
      // signature is wider, so the cast keeps the test on the mock's contract.
    }) as unknown as typeof processManager.getStatus);

    const result = await dispatchDreamingSession({ projectId });
    await result.settled;

    // The session still answered — its output is readable on the session page
    // — but the row says the memory was NOT replaced, and why.
    const session = sessionRow(result.sessionId!);
    expect(session.outcome).toBe("answered");
    expect(session.status).toBe("failed");
    expect(session.error).toMatch(/edited/i);
    expect(eventsOfType("memory:discarded")).toEqual([
      expect.objectContaining({
        data: {
          source: "dreaming",
          reason: "memory_changed",
          sessionId: result.sessionId,
        },
      }),
    ]);
    expect(eventsOfType("memory:changed")).toHaveLength(0);

    // ...but the human edit stands, untouched.
    expect(getProjectMemoryContent(projectId)).toBe("- A HUMAN EDITED THIS");
    // No snapshot was taken and no notification claimed an update.
    expect(getProjectMemoryArchiveDoc(projectId)).toBeNull();
    // And the window did not advance, so the next dream re-reads the evidence.
    expect(findLastDreamCutoff(projectId)).toBeNull();
  });

  it("replaces normally when nobody touched the memory", async () => {
    saveProjectMemory(projectId, "- AS THE DREAM READ IT");
    seedSourceSession();

    await (await dispatchDreamingSession({ projectId })).settled;

    expect(getProjectMemoryContent(projectId)).not.toBe(
      "- AS THE DREAM READ IT"
    );
    expect(getProjectMemoryArchiveDoc(projectId)!.markdownContent).toBe(
      "- AS THE DREAM READ IT"
    );
    expect(findLastDreamCutoff(projectId)).not.toBeNull();
  });
});

describe("dispatchDreamingSession — guard rails", () => {
  it("never starts a second dream while one is in flight", async () => {
    seedSourceSession();
    seedSourceSession({
      agentType: DREAMING_AGENT_TYPE,
      status: "running",
      outcome: null,
      epicId: null,
    });

    expect(hasPendingMemoryWriter(projectId)).toBe(true);
    const result = await dispatchDreamingSession({ projectId });
    await result.settled;

    expect(result.dispatched).toBe(false);
    expect(result.sessionId).toBeNull();
    expect(result.reason).toContain("already pending");
    // Only the seeded one — no second dream row.
    expect(dreamSessions()).toHaveLength(1);
  });

  it("lets only ONE of two simultaneous dispatches through", async () => {
    seedSourceSession();

    // Both calls pass the first guard before either inserts a row — the
    // synchronous re-check right before createQueuedSession is what settles it.
    const [first, second] = await Promise.all([
      dispatchDreamingSession({ projectId, trigger: "manual" }),
      dispatchDreamingSession({ projectId, trigger: "night_run" }),
    ]);
    await Promise.all([first.settled, second.settled]);

    const dispatched = [first, second].filter((r) => r.dispatched);
    expect(dispatched).toHaveLength(1);
    expect(dreamSessions()).toHaveLength(1);
    expect(
      [first, second].find((r) => !r.dispatched)!.reason
    ).toContain("already pending");
  });

  it("no-ops (without spending a session) when nothing happened since the last dream", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    seedSourceSession({
      createdAt: past,
      startedAt: past,
      endedAt: past,
      completedAt: past,
    });
    // A previous dream already folded that window into the memory.
    recordDreamCutoff(projectId, new Date().toISOString());

    const result = await dispatchDreamingSession({ projectId });
    await result.settled;

    expect(result.dispatched).toBe(false);
    expect(result.sessionId).toBeNull();
    expect(result.reason).toContain("no new sessions");
    expect(dreamSessions()).toHaveLength(0);
  });

  it("no-ops on a project that never ran a dreamable session", async () => {
    const result = await dispatchDreamingSession({ projectId });
    await result.settled;
    expect(result.dispatched).toBe(false);
    expect(dreamSessions()).toHaveLength(0);
  });
});

/**
 * One sanitiser for both memory writers: the distill and the dream used to
 * carry byte-identical copies, free to drift on what counts as the body.
 */
describe("sanitizeMemoryDocument", () => {
  it("trims plain output and unwraps a full-document fence", () => {
    expect(sanitizeMemoryDocument("  body  ")).toBe("body");
    expect(sanitizeMemoryDocument("```\nbody\n```")).toBe("body");
    expect(sanitizeMemoryDocument("```md\nbody\n```")).toBe("body");
    // Inner (partial) fences survive — they are content, not wrapping.
    expect(sanitizeMemoryDocument("intro\n```\ncode\n```")).toBe(
      "intro\n```\ncode\n```"
    );
  });
});

describe("maybeDreamAfterNightRun", () => {
  function setSetting(key: string, value: unknown) {
    db.insert(settings)
      .values({ key, value: JSON.stringify(value) })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: JSON.stringify(value) },
      })
      .run();
  }

  it("is off when the setting is absent (the default)", async () => {
    seedSourceSession();
    expect(isDreamingAfterNightRunEnabled()).toBe(false);

    const decision = await maybeDreamAfterNightRun(projectId, "night_x");
    await decision.settled;

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("off");
    expect(dreamSessions()).toHaveLength(0);
  });

  it("dreams when the global setting is on, tagging the run", async () => {
    setSetting(DREAMING_AFTER_NIGHT_RUN_SETTING_KEY, true);
    seedSourceSession();

    const decision = await maybeDreamAfterNightRun(projectId, "night_on");
    await decision.settled;

    expect(decision.allowed).toBe(true);
    const spawned = dreamSessions();
    expect(spawned).toHaveLength(1);
    expect(spawned[0].batchRunId).toBe("night_on");
    expect(spawned[0].status).toBe("completed");
  });

  /**
   * The per-project `dreaming_after_night_run:<id>` override was resolved,
   * allowed and swept, but written by nothing — no field, no dialog, no route.
   * It is retired: a row left behind by a hand-made request must not decide
   * anything, and PATCH /api/settings must stop accepting it.
   */
  it("ignores a legacy per-project row — the switch is global only", async () => {
    setSetting(DREAMING_AFTER_NIGHT_RUN_SETTING_KEY, false);
    setSetting(`${DREAMING_AFTER_NIGHT_RUN_SETTING_KEY}:${projectId}`, true);
    seedSourceSession();

    expect(isDreamingAfterNightRunEnabled()).toBe(false);
    const decision = await maybeDreamAfterNightRun(projectId, "night_legacy");
    await decision.settled;

    expect(decision.allowed).toBe(false);
    expect(dreamSessions()).toHaveLength(0);
  });

  it("a legacy per-project false no longer vetoes the global switch", async () => {
    setSetting(DREAMING_AFTER_NIGHT_RUN_SETTING_KEY, true);
    setSetting(`${DREAMING_AFTER_NIGHT_RUN_SETTING_KEY}:${projectId}`, false);
    seedSourceSession();

    expect(isDreamingAfterNightRunEnabled()).toBe(true);
    await (await maybeDreamAfterNightRun(projectId, "night_global")).settled;

    expect(dreamSessions()).toHaveLength(1);
  });

  it("refuses the scoped key at the settings allowlist", () => {
    expect(isWritableSettingKey(DREAMING_AFTER_NIGHT_RUN_SETTING_KEY)).toBe(true);
    expect(
      isWritableSettingKey(`${DREAMING_AFTER_NIGHT_RUN_SETTING_KEY}:proj1`)
    ).toBe(false);
  });

  it("never throws into the night run's finish path", async () => {
    setSetting(DREAMING_AFTER_NIGHT_RUN_SETTING_KEY, true);
    // Unknown project: dispatch throws, the trigger swallows it.
    await expect(
      maybeDreamAfterNightRun("no-such-project", "night_boom")
    ).resolves.toMatchObject({ allowed: false });
  });
});
