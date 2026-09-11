/**
 * Concurrent spec edits during a background spec session (#12 / #106).
 *
 * Both background writers — the manual update and the release-triggered
 * auto rewrite — build their prompt from the spec as it was at dispatch, then
 * run for a while. A user who saves the Spec view in that window must not be
 * overwritten: the commit goes through commitGeneratedSpec, which compares
 * the stored spec with the one the prompt reasoned from, and a mismatch is a
 * FAILED session carrying the ProjectSpecChangedError message — the newer
 * edit stays, arji.json is not re-exported, and the agent's rewrite is kept
 * as a `spec_proposal` document the session error names.
 *
 * The concurrent edit is simulated inside the mocked processManager.start,
 * i.e. after the prompt captured the spec and before the run completes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";

const processManagerState = vi.hoisted(() => ({
  result: undefined as Record<string, unknown> | undefined,
  onStart: undefined as (() => void) | undefined,
}));

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

vi.mock("@/lib/claude/process-manager", () => ({
  processManager: {
    start: vi.fn(() => processManagerState.onStart?.()),
    getStatus: vi.fn(() => ({
      status: "completed",
      result: processManagerState.result,
    })),
  },
}));

vi.mock("@/lib/agent-config/prompts", () => ({
  resolveAgentPrompt: vi.fn().mockResolvedValue("spec system prompt"),
}));

vi.mock("@/lib/agent-config/agent-resolution", () => ({
  resolveAgentByNamedId: vi.fn(() => ({
    provider: "claude-code",
    namedAgentId: null,
    name: null,
    model: null,
  })),
}));

vi.mock("@/lib/sync/export", () => ({
  tryExportArjiJson: vi.fn(),
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
const { projects, releases, agentSessions, documents } = await import("@/lib/db/schema");
const { dispatchSpecUpdateSession } = await import("@/lib/workflow/spec-update");
const { dispatchSpecAutoRewriteSession } = await import(
  "@/lib/workflow/spec-auto-rewrite"
);
const { ProjectSpecChangedError } = await import("@/lib/projects/spec-write");
const { tryExportArjiJson } = await import("@/lib/sync/export");

const ORIGINAL_SPEC = "# Original spec\n\nPlanned: checkout flow.";
const HUMAN_EDIT = "# Original spec\n\nPlanned: checkout flow.\n\nAlso: refunds.";
const AGENT_SPEC = "# Rewritten spec\n\nCheckout flow is live.";

let counter = 0;

async function flushBackground() {
  await new Promise((r) => setTimeout(r, 25));
  await new Promise((r) => setTimeout(r, 25));
}

function claudeEnvelope(text: string): string {
  return JSON.stringify({ type: "result", subtype: "success", result: text });
}

function seedProject(): { projectId: string; releaseId: string } {
  counter += 1;
  const projectId = `proj-spec-conflict-${counter}`;
  const releaseId = `rel-spec-conflict-${counter}`;
  db.insert(projects)
    .values({ id: projectId, name: "Spec Project", gitRepoPath: "/repos/s", spec: ORIGINAL_SPEC })
    .run();
  db.insert(releases)
    .values({
      id: releaseId,
      projectId,
      version: "0.1.0",
      title: "First release",
      changelog: "- checkout flow",
      epicIds: "[]",
      createdAt: new Date().toISOString(),
    })
    .run();
  return { projectId, releaseId };
}

function getSpec(projectId: string): string | null {
  return db.select({ spec: projects.spec }).from(projects).where(eq(projects.id, projectId)).get()?.spec ?? null;
}

function sessionRow(sessionId: string) {
  return db.select().from(agentSessions).where(eq(agentSessions.id, sessionId)).get()!;
}

/** The user saves the Spec view while the agent is running. */
function editSpecDuringRun(projectId: string) {
  processManagerState.onStart = () => {
    db.update(projects).set({ spec: HUMAN_EDIT }).where(eq(projects.id, projectId)).run();
  };
}

/** The agent's rewrite survives as a spec_proposal the session error names. */
function expectProposalNamedIn(projectId: string, error: string | null) {
  const proposal = db
    .select()
    .from(documents)
    .where(eq(documents.projectId, projectId))
    .get();
  expect(proposal?.kind).toBe("spec_proposal");
  expect(proposal?.markdownContent).toBe(AGENT_SPEC);
  expect(error).toContain(proposal!.originalFilename);
}

beforeEach(() => {
  vi.clearAllMocks();
  processManagerState.onStart = undefined;
  processManagerState.result = {
    success: true,
    result: claudeEnvelope(AGENT_SPEC),
    duration: 1000,
  };
});

describe("manual spec update vs a concurrent edit", () => {
  it("keeps the newer edit and marks the session failed with the conflict message", async () => {
    const { projectId } = seedProject();
    editSpecDuringRun(projectId);

    const { sessionId } = await dispatchSpecUpdateSession({
      projectId,
      instruction: null,
      namedAgentId: null,
    });
    await flushBackground();

    expect(getSpec(projectId)).toBe(HUMAN_EDIT);
    const session = sessionRow(sessionId);
    expect(session.status).toBe("failed");
    expect(session.error).toContain(new ProjectSpecChangedError().message);
    expectProposalNamedIn(projectId, session.error);
    expect(tryExportArjiJson).not.toHaveBeenCalled();
  });

  it("still commits when nobody edited the spec in the meantime", async () => {
    const { projectId } = seedProject();

    const { sessionId } = await dispatchSpecUpdateSession({
      projectId,
      instruction: null,
      namedAgentId: null,
    });
    await flushBackground();

    expect(getSpec(projectId)).toBe(AGENT_SPEC);
    expect(sessionRow(sessionId).status).toBe("completed");
    expect(tryExportArjiJson).toHaveBeenCalledWith(projectId);
  });
});

describe("release-triggered auto rewrite vs a concurrent edit", () => {
  it("keeps the newer edit and marks the session failed with the conflict message", async () => {
    const { projectId, releaseId } = seedProject();
    editSpecDuringRun(projectId);

    const { sessionId } = await dispatchSpecAutoRewriteSession({ projectId, releaseId });
    await flushBackground();

    expect(getSpec(projectId)).toBe(HUMAN_EDIT);
    const session = sessionRow(sessionId);
    expect(session.status).toBe("failed");
    expect(session.error).toContain(new ProjectSpecChangedError().message);
    expectProposalNamedIn(projectId, session.error);
    expect(tryExportArjiJson).not.toHaveBeenCalled();
  });

  it("marks a silent run failed instead of claiming success over an unchanged spec", async () => {
    const { projectId, releaseId } = seedProject();
    processManagerState.result = { success: true, result: "", duration: 500 };

    const { sessionId } = await dispatchSpecAutoRewriteSession({ projectId, releaseId });
    await flushBackground();

    expect(getSpec(projectId)).toBe(ORIGINAL_SPEC);
    const session = sessionRow(sessionId);
    expect(session.status).toBe("failed");
    expect(session.error).toContain("left unchanged");
    expect(tryExportArjiJson).not.toHaveBeenCalled();
  });
});
