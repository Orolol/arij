/**
 * Learned project memory — distillation workflow end-to-end against the real
 * migrated schema (createTestDb), with the CLI spawn mocked:
 *
 *   - dispatchMemoryDistillSession creates a queued 'memory_distill' session,
 *     runs it through the real scheduler + lifecycle, and on an answered
 *     completion REPLACES the memory document (cap-enforced) and writes the
 *     actor-'system' "Project memory updated" activity-log entry,
 *   - non-answered outcomes (asked_question) leave the memory doc untouched,
 *   - accidental full-document code fences are unwrapped,
 *   - the distill prompt embeds the current memory and the source session's
 *     ticket/outcome/result context,
 *   - maybeAutoDistillAfterSessionTerminal end-to-end: off by default, spawns
 *     exactly one distill for an eligible build, and every guard denial
 *     (failure, distill-of-distill, pending distill) spawns nothing.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";

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
  resolveAgentPrompt: vi.fn().mockResolvedValue("distill system prompt"),
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
const { projects, epics, agentSessions, settings, ticketActivityLog } =
  await import("@/lib/db/schema");
const {
  dispatchMemoryDistillSession,
  maybeAutoDistillAfterSessionTerminal,
  sanitizeDistilledMemory,
  MEMORY_UPDATED_REASON,
} = await import("@/lib/workflow/memory-distill");
const { getProjectMemoryContent, saveProjectMemory } = await import(
  "@/lib/documents/memory"
);
const { PROJECT_MEMORY_MAX_CHARS } = await import(
  "@/lib/documents/memory-constants"
);

let counter = 0;

async function flushBackground() {
  await new Promise((r) => setTimeout(r, 25));
  await new Promise((r) => setTimeout(r, 25));
}

function claudeEnvelope(text: string): string {
  return JSON.stringify({ type: "result", subtype: "success", result: text });
}

function seedProject() {
  counter += 1;
  const projectId = `proj-distill-${counter}`;
  const epicId = `epic-distill-${counter}`;
  db.insert(projects)
    .values({ id: projectId, name: "Distill Project", gitRepoPath: "/repos/d" })
    .run();
  db.insert(epics)
    .values({
      id: epicId,
      projectId,
      title: "Checkout flow",
      status: "done",
      position: 0,
      readableId: `E-d-${counter}`,
    })
    .run();
  return { projectId, epicId };
}

function seedSourceSession(
  projectId: string,
  epicId: string | null,
  overrides: Partial<typeof agentSessions.$inferInsert> = {}
): string {
  const id = `source-${counter}-${Math.random().toString(36).slice(2, 8)}`;
  db.insert(agentSessions)
    .values({
      id,
      projectId,
      epicId,
      status: "completed",
      agentType: "ticket_build",
      outcome: "answered",
      lastNonEmptyText: "Learned: envelope every API response.",
      createdAt: new Date().toISOString(),
      ...overrides,
    })
    .run();
  return id;
}

function distillSessions(projectId: string) {
  return db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.projectId, projectId))
    .all()
    .filter((row) => row.agentType === "memory_distill");
}

function enableAutoDistill() {
  db.insert(settings)
    .values({ key: "memory_auto_distill", value: "true" })
    .run();
}

beforeEach(() => {
  vi.clearAllMocks();
  db.delete(settings).where(eq(settings.key, "memory_auto_distill")).run();
  processManagerState.result = {
    success: true,
    result: claudeEnvelope("## Conventions\n\n- Envelope every API response"),
    duration: 1000,
  };
});

describe("dispatchMemoryDistillSession", () => {
  it("runs a memory_distill session and replaces the memory doc on answered completion", async () => {
    const { projectId, epicId } = seedProject();
    saveProjectMemory(projectId, "- Old rule: keep tests green");
    const sourceId = seedSourceSession(projectId, epicId);

    const { sessionId } = await dispatchMemoryDistillSession({
      projectId,
      sourceSessionId: sourceId,
    });
    await flushBackground();

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session).toMatchObject({
      agentType: "memory_distill",
      status: "completed",
      outcome: "answered",
      projectId,
      mode: "plan",
      epicId: null, // never holds an epic slot
    });

    // Prompt embeds the current memory and the source session context.
    expect(session!.prompt).toContain("## Current Project Memory");
    expect(session!.prompt).toContain("- Old rule: keep tests green");
    expect(session!.prompt).toContain("**Ticket:** Checkout flow");
    expect(session!.prompt).toContain("**Outcome:** answered");
    expect(session!.prompt).toContain("Learned: envelope every API response.");
    expect(session!.prompt).toContain("distill system prompt");

    // The memory document was replaced with the agent's output.
    expect(getProjectMemoryContent(projectId)).toBe(
      "## Conventions\n\n- Envelope every API response"
    );

    // Activity log: actor-system entry anchored to the source ticket.
    const activity = db
      .select()
      .from(ticketActivityLog)
      .where(eq(ticketActivityLog.epicId, epicId))
      .all();
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      projectId,
      epicId,
      actor: "system",
      reason: MEMORY_UPDATED_REASON,
      sessionId,
      fromStatus: "done",
      toStatus: "done",
    });
  });

  it("enforces the cap on the distilled output", async () => {
    const { projectId, epicId } = seedProject();
    const sourceId = seedSourceSession(projectId, epicId);
    processManagerState.result = {
      success: true,
      result: claudeEnvelope("m".repeat(PROJECT_MEMORY_MAX_CHARS + 1000)),
      duration: 1000,
    };

    await dispatchMemoryDistillSession({ projectId, sourceSessionId: sourceId });
    await flushBackground();

    expect(getProjectMemoryContent(projectId)).toHaveLength(
      PROJECT_MEMORY_MAX_CHARS
    );
  });

  it("unwraps an accidental full-document code fence", async () => {
    const { projectId } = seedProject();
    processManagerState.result = {
      success: true,
      result: claudeEnvelope("```markdown\n- fenced rule\n```"),
      duration: 1000,
    };

    await dispatchMemoryDistillSession({ projectId });
    await flushBackground();

    expect(getProjectMemoryContent(projectId)).toBe("- fenced rule");
  });

  it("leaves the memory doc untouched when the distill run asked a question", async () => {
    const { projectId, epicId } = seedProject();
    saveProjectMemory(projectId, "- Untouched rule");
    const sourceId = seedSourceSession(projectId, epicId);
    processManagerState.result = {
      success: true,
      result: claudeEnvelope("Should I drop the legacy section?"),
      endedWithQuestion: true,
      duration: 1000,
    };

    const { sessionId } = await dispatchMemoryDistillSession({
      projectId,
      sourceSessionId: sourceId,
    });
    await flushBackground();

    const session = db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .get();
    expect(session!.outcome).toBe("asked_question");
    expect(getProjectMemoryContent(projectId)).toBe("- Untouched rule");
    expect(
      db
        .select()
        .from(ticketActivityLog)
        .where(eq(ticketActivityLog.epicId, epicId))
        .all()
    ).toHaveLength(0);
  });

  it("throws for an unknown project", async () => {
    await expect(
      dispatchMemoryDistillSession({ projectId: "nope" })
    ).rejects.toThrow("Project not found");
  });
});

describe("sanitizeDistilledMemory", () => {
  it("trims plain output and unwraps fences", () => {
    expect(sanitizeDistilledMemory("  body  ")).toBe("body");
    expect(sanitizeDistilledMemory("```\nbody\n```")).toBe("body");
    expect(sanitizeDistilledMemory("```md\nbody\n```")).toBe("body");
    // Inner fences (partial) are preserved.
    expect(sanitizeDistilledMemory("intro\n```\ncode\n```")).toBe(
      "intro\n```\ncode\n```"
    );
  });
});

describe("maybeAutoDistillAfterSessionTerminal", () => {
  it("does nothing when the setting is absent (off by default)", async () => {
    const { projectId, epicId } = seedProject();
    const sourceId = seedSourceSession(projectId, epicId, {
      agentType: "build",
    });

    const decision = await maybeAutoDistillAfterSessionTerminal(sourceId);
    await flushBackground();

    expect(decision.allowed).toBe(false);
    expect(distillSessions(projectId)).toHaveLength(0);
  });

  it("spawns exactly one distill session for an eligible completed build", async () => {
    const { projectId, epicId } = seedProject();
    enableAutoDistill();
    const sourceId = seedSourceSession(projectId, epicId, {
      agentType: "build",
    });

    const decision = await maybeAutoDistillAfterSessionTerminal(sourceId);
    await flushBackground();

    expect(decision).toEqual({ allowed: true, reason: "eligible" });
    const spawned = distillSessions(projectId);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].status).toBe("completed");
    expect(getProjectMemoryContent(projectId)).toContain(
      "Envelope every API response"
    );
  });

  it("never distills a distill session", async () => {
    const { projectId } = seedProject();
    enableAutoDistill();
    const distillId = seedSourceSession(projectId, null, {
      agentType: "memory_distill",
    });

    const decision = await maybeAutoDistillAfterSessionTerminal(distillId);
    await flushBackground();

    expect(decision.allowed).toBe(false);
    expect(distillSessions(projectId)).toHaveLength(1); // only the seed itself
  });

  it("never distills failed sessions", async () => {
    const { projectId, epicId } = seedProject();
    enableAutoDistill();
    const failedId = seedSourceSession(projectId, epicId, {
      agentType: "build",
      status: "failed",
      outcome: "error",
    });

    const decision = await maybeAutoDistillAfterSessionTerminal(failedId);
    await flushBackground();

    expect(decision.allowed).toBe(false);
    expect(distillSessions(projectId)).toHaveLength(0);
  });

  it("skips when a distill is already pending for the project", async () => {
    const { projectId, epicId } = seedProject();
    enableAutoDistill();
    seedSourceSession(projectId, null, {
      agentType: "memory_distill",
      status: "queued",
      outcome: null,
    });
    const sourceId = seedSourceSession(projectId, epicId, {
      agentType: "build",
    });

    const decision = await maybeAutoDistillAfterSessionTerminal(sourceId);
    await flushBackground();

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("already pending");
    expect(distillSessions(projectId)).toHaveLength(1); // only the seeded one
  });
});
