/**
 * Tests for the pipeline's awaitable terminal seam (lib/pipeline/index.ts):
 * `onTerminal` fires EXACTLY ONCE with the terminal summary on every path —
 * succeeded, paused_question, cancelled, failed, and the engine-crash safety
 * net — and never lets a callback exception escape. Also covers the
 * batchRunId threading into the stage driver init and the forensic dispatch
 * (the row-level stamps are covered by pipeline-stages-dispatch and the
 * night engine tests).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const driverMocks = vi.hoisted(() => ({
  launchStage: vi.fn(),
  assessReview: vi.fn(),
  readSessionStatus: vi.fn(() => "completed" as string | null),
  checkGuards: vi.fn(() => ({
    conflictSessionId: null as string | null,
    reviewTargetStatus: "review" as string | null,
  })),
  runForensic: vi.fn(),
  createPipelineStageDriver: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

vi.mock("@/lib/pipeline/stages", () => ({
  createPipelineStageDriver: driverMocks.createPipelineStageDriver,
}));

vi.mock("@/lib/pipeline/forensic", () => ({
  runForensic: driverMocks.runForensic,
}));

const { db } = await import("@/lib/db");
const { projects, epics, settings } = await import("@/lib/db/schema");
const { startPipelineRun, pipelineRegistry } = await import("@/lib/pipeline");
const { pipelineMaxAttemptsSettingKey } = await import(
  "@/lib/pipeline/constants"
);
import type { PipelineStageResult, PipelineTerminalSummary } from "@/lib/pipeline";

let counter = 0;

async function flushBackground() {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

function seed() {
  counter += 1;
  const projectId = `proj-term-${counter}`;
  const epicId = `epic-term-${counter}`;
  db.insert(projects)
    .values({ id: projectId, name: "Terminal project", gitRepoPath: "/r" })
    .run();
  db.insert(epics)
    .values({
      id: epicId,
      projectId,
      title: "Terminal epic",
      status: "in_progress",
      position: 0,
    })
    .run();
  return { projectId, epicId };
}

function settledResult(
  sessionId: string,
  partial: Partial<PipelineStageResult> = {}
): PipelineStageResult {
  return {
    sessionId,
    success: true,
    outcome: "answered",
    error: null,
    ...partial,
  };
}

interface StartOverrides {
  buildSettled?: Promise<PipelineStageResult>;
  batchRunId?: string | null;
  onTerminal?: (summary: PipelineTerminalSummary) => void;
}

function start(projectId: string, epicId: string, overrides: StartOverrides) {
  return startPipelineRun({
    projectId,
    scope: "epic",
    epicId,
    userStoryId: null,
    buildSessionId: "s-build",
    buildProvider: "claude-code",
    buildNamedAgentId: null,
    buildSettled:
      overrides.buildSettled ?? Promise.resolve(settledResult("s-build")),
    ...(overrides.batchRunId !== undefined
      ? { batchRunId: overrides.batchRunId }
      : {}),
    ...(overrides.onTerminal ? { onTerminal: overrides.onTerminal } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  driverMocks.readSessionStatus.mockReturnValue("completed");
  driverMocks.checkGuards.mockReturnValue({
    conflictSessionId: null,
    reviewTargetStatus: "review",
  });
  driverMocks.createPipelineStageDriver.mockReturnValue({
    launchStage: driverMocks.launchStage,
    assessReview: driverMocks.assessReview,
    readSessionStatus: driverMocks.readSessionStatus,
    checkGuards: driverMocks.checkGuards,
  });
});

describe("startPipelineRun — onTerminal", () => {
  it("fires once with the succeeded summary", async () => {
    const { projectId, epicId } = seed();
    driverMocks.launchStage.mockResolvedValueOnce({
      sessionId: "s-review",
      settled: Promise.resolve(settledResult("s-review")),
      escalatedToProvider: null,
    });
    driverMocks.assessReview.mockResolvedValueOnce({
      blocking: false,
      blockingCount: 0,
      agentCommentCount: 1,
      usedProseFallback: false,
    });

    const onTerminal = vi.fn();
    start(projectId, epicId, { onTerminal });
    await flushBackground();

    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(onTerminal).toHaveBeenCalledWith({
      state: "succeeded",
      reason: null,
      sessionIds: ["s-build", "s-review"],
      fixCycles: 0,
    });
  });

  it("fires once with paused_question when the build asks", async () => {
    const { projectId, epicId } = seed();
    const onTerminal = vi.fn();
    start(projectId, epicId, {
      onTerminal,
      buildSettled: Promise.resolve(
        settledResult("s-build", { outcome: "asked_question" })
      ),
    });
    await flushBackground();

    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(onTerminal.mock.calls[0][0]).toMatchObject({
      state: "paused_question",
      reason: "agent asked a question (build)",
    });
  });

  it("fires once with cancelled when the user stopped the session", async () => {
    const { projectId, epicId } = seed();
    driverMocks.readSessionStatus.mockReturnValue("cancelled");
    const onTerminal = vi.fn();
    start(projectId, epicId, {
      onTerminal,
      buildSettled: Promise.resolve(
        settledResult("s-build", {
          success: false,
          outcome: null,
          error: "Cancelled by user",
        })
      ),
    });
    await flushBackground();

    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(onTerminal.mock.calls[0][0]).toMatchObject({
      state: "cancelled",
      reason: "stopped by user",
    });
  });

  it("fires once with failed after the ladder exhausts (forensic threaded the batchRunId)", async () => {
    const { projectId, epicId } = seed();
    db.insert(settings)
      .values({ key: pipelineMaxAttemptsSettingKey(projectId), value: "1" })
      .run();
    driverMocks.readSessionStatus.mockReturnValue("failed");
    driverMocks.runForensic.mockResolvedValueOnce({
      sessionId: "s-forensic",
      settled: Promise.resolve(settledResult("s-forensic")),
    });

    const onTerminal = vi.fn();
    start(projectId, epicId, {
      onTerminal,
      batchRunId: "night_run_1",
      buildSettled: Promise.resolve(
        settledResult("s-build", {
          success: false,
          outcome: "error",
          error: "spawn failed",
        })
      ),
    });
    await flushBackground();

    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(onTerminal.mock.calls[0][0]).toMatchObject({
      state: "failed",
      reason: "stage build failed after 1 attempts",
    });
    // The forensic dispatch carries the run tag.
    expect(driverMocks.runForensic).toHaveBeenCalledWith(
      expect.objectContaining({ batchRunId: "night_run_1" })
    );
  });

  it("fires once from the engine-crash safety net with the crash summary", async () => {
    const { projectId, epicId } = seed();
    const onTerminal = vi.fn();
    const { runId } = start(projectId, epicId, {
      onTerminal,
      // A settled promise resolving to garbage crashes the runner (engine
      // bug by contract) — the catch in startPipelineRun must still close
      // the run and fire the terminal seam exactly once.
      buildSettled: Promise.resolve(
        undefined as unknown as PipelineStageResult
      ),
    });
    await flushBackground();

    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(onTerminal).toHaveBeenCalledWith({
      state: "failed",
      reason: "pipeline engine error",
      sessionIds: ["s-build"],
      fixCycles: 0,
    });
    expect(pipelineRegistry.get(runId)).toMatchObject({
      state: "failed",
      reason: "pipeline engine error",
    });
  });

  it("a throwing onTerminal is swallowed and the registry still closes", async () => {
    const { projectId, epicId } = seed();
    const onTerminal = vi.fn(() => {
      throw new Error("listener exploded");
    });
    const { runId } = start(projectId, epicId, {
      onTerminal,
      buildSettled: Promise.resolve(
        settledResult("s-build", { outcome: "asked_question" })
      ),
    });
    await flushBackground();

    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(pipelineRegistry.get(runId)).toMatchObject({
      state: "paused_question",
    });
  });

  it("threads batchRunId into the stage driver init (null when absent)", async () => {
    const { projectId, epicId } = seed();
    start(projectId, epicId, {
      batchRunId: "night_tag_test",
      buildSettled: Promise.resolve(
        settledResult("s-build", { outcome: "asked_question" })
      ),
    });
    await flushBackground();
    expect(
      driverMocks.createPipelineStageDriver.mock.calls.at(-1)![0]
    ).toMatchObject({ batchRunId: "night_tag_test" });

    const { projectId: p2, epicId: e2 } = seed();
    start(p2, e2, {
      buildSettled: Promise.resolve(
        settledResult("s-build", { outcome: "asked_question" })
      ),
    });
    await flushBackground();
    expect(
      driverMocks.createPipelineStageDriver.mock.calls.at(-1)![0]
    ).toMatchObject({ batchRunId: null });
  });
});
