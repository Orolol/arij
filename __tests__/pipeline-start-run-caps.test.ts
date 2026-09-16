/**
 * startPipelineRun stamps the run's caps on its registry snapshot (audit
 * 2026-09-10, lot 05, #72) — what lets the ticket overlay print
 * "attempt n/max · fix cycle n/max" from the registry alone.
 *
 * The attempt cap is the budget the runner SIZED for the stage, so a
 * composite build agent shows its member count, not the setting.
 */
import { describe, it, expect, vi } from "vitest";

const driverMocks = vi.hoisted(() => ({
  attemptBudget: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

vi.mock("@/lib/pipeline/stages", () => ({
  createPipelineStageDriver: vi.fn(() => ({
    launchStage: vi.fn(),
    assessReview: vi.fn(),
    assessGrading: vi.fn(),
    readSessionStatus: vi.fn(() => "running"),
    checkGuards: vi.fn(() => ({ conflictSessionId: null, reviewTargetStatus: "review" })),
    runDeterministicVerification: vi.fn(async () => ({ ran: false, result: null })),
    attemptBudget: driverMocks.attemptBudget,
  })),
}));

vi.mock("@/lib/pipeline/forensic", () => ({ runForensic: vi.fn() }));

const { db } = await import("@/lib/db");
const { projects, epics, settings } = await import("@/lib/db/schema");
const { startPipelineRun, pipelineRegistry } = await import("@/lib/pipeline");
const { pipelineMaxAttemptsSettingKey, pipelineMaxFixCyclesSettingKey } = await import(
  "@/lib/pipeline/constants"
);

let counter = 0;

function seed() {
  counter += 1;
  const projectId = `proj-caps-${counter}`;
  const epicId = `epic-caps-${counter}`;
  db.insert(projects).values({ id: projectId, name: "Caps", gitRepoPath: "/repos/c" }).run();
  db.insert(epics)
    .values({ id: epicId, projectId, title: "Caps epic", status: "in_progress", position: 0 })
    .run();
  db.insert(settings).values({ key: pipelineMaxAttemptsSettingKey(projectId), value: "4" }).run();
  db.insert(settings).values({ key: pipelineMaxFixCyclesSettingKey(projectId), value: "3" }).run();
  return { projectId, epicId };
}

function start(projectId: string, epicId: string) {
  return startPipelineRun({
    projectId,
    scope: "epic",
    epicId,
    userStoryId: null,
    buildSessionId: `s-build-${counter}`,
    buildProvider: "claude-code",
    buildNamedAgentId: null,
    // Never settles: the run stays in its build stage for the assertions.
    buildSettled: new Promise(() => {}),
  });
}

async function flush() {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 5));
}

describe("startPipelineRun caps", () => {
  it("registers the configured caps from the first read", async () => {
    const { projectId, epicId } = seed();
    driverMocks.attemptBudget.mockImplementation((_stage: string, configured: number) => configured);

    const { runId } = start(projectId, epicId);

    expect(pipelineRegistry.get(runId)).toMatchObject({
      stageAttempt: 1,
      stageMaxAttempts: 4,
      fixCycles: 0,
      maxFixCycles: 3,
    });
    await flush();
    expect(pipelineRegistry.get(runId)?.stageMaxAttempts).toBe(4);
  });

  it("replaces the attempt cap with the budget sized for a composite build", async () => {
    const { projectId, epicId } = seed();
    driverMocks.attemptBudget.mockResolvedValue(2);

    const { runId } = start(projectId, epicId);
    await flush();

    expect(pipelineRegistry.get(runId)).toMatchObject({
      stageMaxAttempts: 2,
      maxFixCycles: 3,
    });
  });
});
