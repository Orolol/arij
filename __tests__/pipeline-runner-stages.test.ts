/**
 * Unit tests for the decomposed pipeline engine: every stage handler and
 * policy module under lib/pipeline/runner-*.ts is driven DIRECTLY through a
 * fake run context, without going through `runPipeline`'s loop.
 *
 * The end-to-end transition matrix stays in pipeline-runner.test.ts; this
 * file pins that each stage is reachable and assertable on its own — the
 * reason the engine was split along stage boundaries.
 */
import { describe, it, expect } from "vitest";

import type {
  PipelineGuardCheck,
  PipelineStageRequest,
  PipelineStageResult,
  PipelineTerminalSummary,
  RunPipelineOptions,
} from "@/lib/pipeline/runner";
import { PIPELINE_REASONS } from "@/lib/pipeline/constants";
import {
  createPipelineRunContext,
  type PipelineRunContext,
} from "@/lib/pipeline/runner-context";
import { awaitStageSettled } from "@/lib/pipeline/runner-cancel-watch";
import { dispatchStage } from "@/lib/pipeline/runner-dispatch";
import { handleStageFailure } from "@/lib/pipeline/runner-retry";
import { runDeterministicVerificationStep } from "@/lib/pipeline/runner-deterministic-verification";
import { runRegressionGateStep } from "@/lib/pipeline/runner-regression-gate";
import { handleCodeStageSuccess } from "@/lib/pipeline/runner-stage-code";
import { handleGradingStageSuccess } from "@/lib/pipeline/runner-stage-grading";
import { handleReviewStageSuccess } from "@/lib/pipeline/runner-stage-review";
import type { VerificationResult } from "@/lib/verify/runner";

function settledResult(
  sessionId: string,
  overrides: Partial<PipelineStageResult> = {}
): PipelineStageResult {
  return {
    sessionId,
    success: true,
    outcome: "answered",
    error: null,
    ...overrides,
  };
}

const OPEN_GUARD: PipelineGuardCheck = {
  conflictSessionId: null,
  reviewTargetStatus: "review",
};

interface Harness {
  ctx: PipelineRunContext;
  requests: PipelineStageRequest[];
  traces: Array<{ reason: string; sessionId: string | null }>;
  reasons(): string[];
  stateChanges: Array<{
    state: string;
    stage: string;
    attempt: number;
    fixCycles: number;
  }>;
  forensicInputs: Array<{
    deadSessionId: string;
    stage: string;
    attempts: number;
  }>;
  parked: Array<{ lastCodeSessionId: string | null; reason: string }>;
  finished(): PipelineTerminalSummary | null;
  rowStatus: Map<string, string>;
}

function makeHarness(
  overrides: Partial<RunPipelineOptions> & { guard?: PipelineGuardCheck } = {}
): Harness {
  const requests: PipelineStageRequest[] = [];
  const traces: Harness["traces"] = [];
  const stateChanges: Harness["stateChanges"] = [];
  const forensicInputs: Harness["forensicInputs"] = [];
  const parked: Harness["parked"] = [];
  const rowStatus = new Map<string, string>([["s-build", "completed"]]);
  let finished: PipelineTerminalSummary | null = null;
  let stageIndex = 0;
  const { guard, ...optionOverrides } = overrides;

  const options: RunPipelineOptions = {
    maxAttempts: 2,
    maxFixCycles: 2,
    maxSessions: 12,
    initialBuild: {
      sessionId: "s-build",
      settled: Promise.resolve(settledResult("s-build")),
    },
    launchStage: async (request) => {
      requests.push(request);
      stageIndex += 1;
      const sessionId = `s-${request.stage}-${stageIndex}`;
      rowStatus.set(sessionId, "completed");
      return {
        sessionId,
        settled: Promise.resolve(settledResult(sessionId)),
        escalatedToNamedAgent: null,
        escalatedToProvider: null,
      };
    },
    assessReview: async () => ({
      blocking: false,
      blockingCount: 0,
      agentCommentCount: 1,
      usedProseFallback: false,
    }),
    readSessionStatus: (sessionId) => rowStatus.get(sessionId) ?? null,
    checkGuards: () => guard ?? OPEN_GUARD,
    runForensic: async (input) => {
      forensicInputs.push(input);
      rowStatus.set("s-forensic", "completed");
      return {
        sessionId: "s-forensic",
        settled: Promise.resolve(settledResult("s-forensic")),
      };
    },
    parkRejectedTicket: (lastCodeSessionId, reason) => {
      parked.push({ lastCodeSessionId, reason });
    },
    cancelPollIntervalMs: 5,
    callbacks: {
      onStageChange: (state, stage, attempt, fixCycles) =>
        stateChanges.push({ state, stage, attempt, fixCycles }),
      onTrace: (reason, sessionId) => traces.push({ reason, sessionId }),
      onFinish: (summary) => {
        finished = summary;
      },
    },
    ...optionOverrides,
  };

  return {
    ctx: createPipelineRunContext(options),
    requests,
    traces,
    reasons: () => traces.map((t) => t.reason),
    stateChanges,
    forensicInputs,
    parked,
    finished: () => finished,
    rowStatus,
  };
}

/** A settled code stage sits in `state.handle`, as after the loop's await. */
function settleCodeStage(
  ctx: PipelineRunContext,
  stage: "build" | "fix" = "build"
): void {
  ctx.state.stage = stage;
  ctx.state.handle = {
    sessionId: "s-build",
    settled: Promise.resolve(settledResult("s-build")),
    escalatedToProvider: null,
  };
}

function passingReport(commandCount = 2): VerificationResult {
  return {
    id: "vr-1",
    status: "pass",
    commands: Array.from({ length: commandCount }, (_, index) => ({
      name: `cmd-${index + 1}`,
      command: `run ${index + 1}`,
      exitCode: 0,
      durationMs: 10,
      outputTail: "",
    })),
    persisted: true,
  } as unknown as VerificationResult;
}

function failingReport(): VerificationResult {
  return {
    id: "vr-2",
    status: "fail",
    commands: [
      {
        name: "test",
        command: "npm test",
        exitCode: 1,
        durationMs: 10,
        outputTail: "1 failed",
      },
    ],
    persisted: true,
  } as unknown as VerificationResult;
}

describe("runner-context — createPipelineRunContext", () => {
  it("starts on the initial build with the run's first session recorded", () => {
    const { ctx } = makeHarness();
    expect(ctx.state.stage).toBe("build");
    expect(ctx.state.stageAttempt).toBe(1);
    expect(ctx.state.fixCycles).toBe(0);
    expect(ctx.state.sessionIds).toEqual(["s-build"]);
    expect(ctx.state.handle.sessionId).toBe("s-build");
    expect(ctx.pollMs).toBe(5);
  });

  it("finish snapshots the session list and fires onFinish once", () => {
    const h = makeHarness();
    h.ctx.state.sessionIds.push("s-review-1");
    h.ctx.state.fixCycles = 1;
    const summary = h.ctx.finish("failed", "why");
    h.ctx.state.sessionIds.push("s-later");
    expect(summary).toEqual({
      state: "failed",
      reason: "why",
      sessionIds: ["s-build", "s-review-1"],
      fixCycles: 1,
    });
    expect(h.finished()).toBe(summary);
  });

  it("readStatusSafe swallows a throwing status reader", () => {
    const { ctx } = makeHarness({
      readSessionStatus: () => {
        throw new Error("db closed");
      },
    });
    expect(ctx.readStatusSafe("s-build")).toBeNull();
  });
});

describe("runner-cancel-watch — awaitStageSettled", () => {
  it("rescues a settle that never resolves once the row turns cancelled", async () => {
    const h = makeHarness();
    h.rowStatus.set("s-stuck", "queued");
    const pending = awaitStageSettled(h.ctx, {
      sessionId: "s-stuck",
      settled: new Promise<PipelineStageResult>(() => {}),
    });
    h.rowStatus.set("s-stuck", "cancelled");
    await expect(pending).resolves.toEqual({
      sessionId: "s-stuck",
      success: false,
      outcome: null,
      error: "Cancelled by user",
    });
  });

  it("passes a settled result straight through", async () => {
    const h = makeHarness();
    const result = settledResult("s-build");
    await expect(
      awaitStageSettled(h.ctx, {
        sessionId: "s-build",
        settled: Promise.resolve(result),
      })
    ).resolves.toBe(result);
  });
});

describe("runner-dispatch — dispatchStage guards", () => {
  const reviewRequest: PipelineStageRequest = {
    stage: "review",
    attempt: 1,
    fixCycle: 0,
    previousAttemptSessionId: null,
    lastCodeSessionId: "s-build",
  };

  it("fails the run at the session cap without launching", async () => {
    const h = makeHarness({ maxSessions: 1 });
    const summary = await dispatchStage(h.ctx, reviewRequest);
    expect(summary?.state).toBe("failed");
    expect(summary?.reason).toBe("session cap reached");
    expect(h.reasons()).toEqual([PIPELINE_REASONS.failedSessionCap]);
    expect(h.requests).toHaveLength(0);
  });

  it("fails the run when a foreign session holds the target", async () => {
    const h = makeHarness({
      guard: { conflictSessionId: "s-foreign", reviewTargetStatus: "review" },
    });
    const summary = await dispatchStage(h.ctx, reviewRequest);
    expect(summary?.reason).toBe("target busy: another agent took the ticket");
    expect(h.traces).toEqual([
      { reason: PIPELINE_REASONS.failedTargetBusy, sessionId: "s-foreign" },
    ]);
    expect(h.requests).toHaveLength(0);
  });

  it("requires review|done for review and grading stages, not for fix", async () => {
    const guard: PipelineGuardCheck = {
      conflictSessionId: null,
      reviewTargetStatus: "in_progress",
    };
    const blocked = makeHarness({ guard });
    expect(
      (await dispatchStage(blocked.ctx, reviewRequest))?.reason
    ).toBe("ticket left review before the review stage");
    expect(
      (await dispatchStage(makeHarness({ guard }).ctx, {
        ...reviewRequest,
        stage: "grading",
      }))?.reason
    ).toBe("ticket left review before the review stage");

    const fix = makeHarness({ guard });
    expect(
      await dispatchStage(fix.ctx, {
        ...reviewRequest,
        stage: "fix",
        fixCycle: 1,
      })
    ).toBeNull();
    expect(fix.requests.map((r) => r.stage)).toEqual(["fix"]);
  });

  it("records the launched session, advances the state, and traces attempt 1", async () => {
    const h = makeHarness();
    expect(await dispatchStage(h.ctx, reviewRequest)).toBeNull();
    expect(h.ctx.state.stage).toBe("review");
    expect(h.ctx.state.stageAttempt).toBe(1);
    expect(h.ctx.state.currentRequest).toBe(reviewRequest);
    expect(h.ctx.state.sessionIds).toEqual(["s-build", "s-review-1"]);
    expect(h.ctx.state.reviewStageStartedAt).not.toBe("");
    expect(h.stateChanges).toEqual([
      { state: "running_review", stage: "review", attempt: 1, fixCycles: 0 },
    ]);
    expect(h.traces).toEqual([
      { reason: PIPELINE_REASONS.reviewStarted, sessionId: "s-review-1" },
    ]);
  });

  it("turns a throwing launcher into a session-less failed handle", async () => {
    const h = makeHarness({
      launchStage: async () => {
        throw new Error("launch exploded");
      },
    });
    expect(await dispatchStage(h.ctx, reviewRequest)).toBeNull();
    expect(h.ctx.state.handle.sessionId).toBeNull();
    await expect(h.ctx.state.handle.settled).resolves.toMatchObject({
      success: false,
      error: "launch exploded",
    });
    expect(h.ctx.state.sessionIds).toEqual(["s-build"]);
  });

  it("traces provider and effort escalations reported by the launcher", async () => {
    const h = makeHarness({
      launchStage: async () => ({
        sessionId: "s-fix-3",
        settled: Promise.resolve(settledResult("s-fix-3")),
        escalatedToNamedAgent: "Stronger",
        escalatedToProvider: "codex",
      }),
    });
    await dispatchStage(h.ctx, {
      stage: "fix",
      attempt: 3,
      fixCycle: 1,
      previousAttemptSessionId: "s-fix-2",
      lastCodeSessionId: "s-build",
    });
    expect(h.reasons()).toEqual([
      PIPELINE_REASONS.escalation("fix", "codex"),
      PIPELINE_REASONS.effortEscalation("fix", "Stronger"),
    ]);
  });
});

describe("runner-retry — handleStageFailure", () => {
  it("climbs the ladder: retry trace, then the next attempt resuming the failed session", async () => {
    const h = makeHarness({ maxAttempts: 3 });
    h.ctx.state.stage = "fix";
    h.ctx.state.stageAttempt = 1;
    h.ctx.state.fixCycles = 1;
    h.ctx.state.lastCodeSessionId = "s-build";
    h.ctx.state.handle = {
      sessionId: "s-fix-old",
      settled: Promise.resolve(settledResult("s-fix-old", { success: false })),
    };
    h.ctx.state.currentRequest = {
      stage: "fix",
      attempt: 1,
      fixCycle: 1,
      previousAttemptSessionId: null,
      lastCodeSessionId: "s-build",
      gradingFailure: { reportId: "gr-1", summary: "missed", missed: [] },
    };

    expect(await handleStageFailure(h.ctx)).toBeNull();
    expect(h.reasons()[0]).toBe(PIPELINE_REASONS.retry("fix", 2, 3));
    expect(h.requests).toEqual([
      {
        stage: "fix",
        attempt: 2,
        fixCycle: 1,
        previousAttemptSessionId: "s-fix-old",
        lastCodeSessionId: "s-build",
        gradingFailure: { reportId: "gr-1", summary: "missed", missed: [] },
      },
    ]);
  });

  it("exhausts into the forensic post-mortem and the terminal failure", async () => {
    const h = makeHarness({ maxAttempts: 2 });
    h.ctx.state.stage = "review";
    h.ctx.state.stageAttempt = 2;
    h.ctx.state.handle = {
      sessionId: "s-review-2",
      settled: Promise.resolve(settledResult("s-review-2", { success: false })),
    };

    const summary = await handleStageFailure(h.ctx);
    expect(summary).toMatchObject({
      state: "failed",
      reason: "stage review failed after 2 attempts",
      sessionIds: ["s-build", "s-forensic"],
    });
    expect(h.forensicInputs).toEqual([
      { deadSessionId: "s-review-2", stage: "review", attempts: 2 },
    ]);
    expect(h.stateChanges).toEqual([
      { state: "running_forensic", stage: "forensic", attempt: 1, fixCycles: 0 },
    ]);
    expect(h.reasons()).toEqual([PIPELINE_REASONS.failedStage("review", 2)]);
    expect(h.requests).toHaveLength(0);
  });

  it("skips the forensic when the session cap leaves no room, still failing the run", async () => {
    const h = makeHarness({ maxAttempts: 1, maxSessions: 1 });
    h.ctx.state.stage = "build";
    h.ctx.state.stageAttempt = 1;
    h.ctx.state.handle = {
      sessionId: "s-build",
      settled: Promise.resolve(settledResult("s-build", { success: false })),
    };
    const summary = await handleStageFailure(h.ctx);
    expect(summary?.state).toBe("failed");
    expect(h.forensicInputs).toHaveLength(0);
    expect(summary?.sessionIds).toEqual(["s-build"]);
  });
});

describe("runner-deterministic-verification — runDeterministicVerificationStep", () => {
  it("proceeds silently when no verification driver is configured", async () => {
    const h = makeHarness();
    settleCodeStage(h.ctx);
    h.ctx.state.lastCodeSessionId = "s-build";
    expect(await runDeterministicVerificationStep(h.ctx)).toEqual({
      kind: "proceed",
      verificationReport: undefined,
    });
    expect(h.traces).toHaveLength(0);
  });

  it("proceeds with the passing report and traces the command count", async () => {
    const report = passingReport(3);
    const h = makeHarness({
      runDeterministicVerification: async () => ({ ran: true, result: report }),
    });
    settleCodeStage(h.ctx);
    h.ctx.state.lastCodeSessionId = "s-build";
    expect(await runDeterministicVerificationStep(h.ctx)).toEqual({
      kind: "proceed",
      verificationReport: report,
    });
    expect(h.traces).toEqual([
      {
        reason: PIPELINE_REASONS.deterministicVerificationPassed(3),
        sessionId: "s-build",
      },
    ]);
  });

  it("spends a fix cycle carrying the failed command while budget remains", async () => {
    const h = makeHarness({
      runDeterministicVerification: async () => ({
        ran: true,
        result: failingReport(),
      }),
    });
    settleCodeStage(h.ctx);
    h.ctx.state.lastCodeSessionId = "s-build";
    expect(await runDeterministicVerificationStep(h.ctx)).toEqual({
      kind: "dispatched",
    });
    expect(h.ctx.state.fixCycles).toBe(1);
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]).toMatchObject({
      stage: "fix",
      attempt: 1,
      fixCycle: 1,
      lastCodeSessionId: "s-build",
      verificationFailure: { name: "test", exitCode: 1 },
    });
    expect(h.reasons()).toEqual([
      PIPELINE_REASONS.deterministicVerificationFailed("test"),
      PIPELINE_REASONS.fixStarted(1, 2),
    ]);
  });

  it("parks the ticket and fails the run when the fix budget is spent", async () => {
    const h = makeHarness({
      maxFixCycles: 1,
      runDeterministicVerification: async () => ({
        ran: true,
        result: failingReport(),
      }),
    });
    settleCodeStage(h.ctx, "fix");
    h.ctx.state.fixCycles = 1;
    h.ctx.state.lastCodeSessionId = "s-fix-1";
    const step = await runDeterministicVerificationStep(h.ctx);
    expect(step.kind).toBe("terminal");
    expect(h.finished()).toMatchObject({
      state: "failed",
      reason: "deterministic verification still failing after 1 fix cycles",
    });
    expect(h.parked).toEqual([
      {
        lastCodeSessionId: "s-fix-1",
        reason: "Deterministic verification rejected the branch",
      },
    ]);
    expect(h.requests).toHaveLength(0);
  });

  it("parks the ticket and fails the run when the driver crashes", async () => {
    const h = makeHarness({
      runDeterministicVerification: async () => {
        throw new Error("runner exploded");
      },
    });
    settleCodeStage(h.ctx);
    h.ctx.state.lastCodeSessionId = "s-build";
    const step = await runDeterministicVerificationStep(h.ctx);
    expect(step.kind).toBe("terminal");
    expect(h.finished()?.reason).toBe("deterministic verification crashed");
    expect(h.reasons()).toEqual([
      PIPELINE_REASONS.failedDeterministicVerificationCrashed,
    ]);
    expect(h.parked[0]?.reason).toBe(
      "Deterministic verification crashed before it could verify the branch"
    );
  });

  it("traces the visible reason of a skipped check and proceeds", async () => {
    const h = makeHarness({
      runDeterministicVerification: async () => ({
        ran: false,
        result: null,
        skipReason: "worktree pruned",
      }),
    });
    settleCodeStage(h.ctx);
    expect((await runDeterministicVerificationStep(h.ctx)).kind).toBe(
      "proceed"
    );
    expect(h.reasons()).toEqual([
      PIPELINE_REASONS.deterministicVerificationSkipped("worktree pruned"),
    ]);
  });
});

describe("runner-regression-gate — runRegressionGateStep", () => {
  it("proceeds when no gate is wired", async () => {
    const h = makeHarness();
    settleCodeStage(h.ctx);
    expect(await runRegressionGateStep(h.ctx)).toEqual({ kind: "proceed" });
  });

  it("spends a fix cycle carrying the exact red→green verdict", async () => {
    const h = makeHarness({
      runVerifyGate: async () => ({
        ran: true,
        passed: false,
        result: {
          status: "failed",
          reason: "test_passes_on_base",
          testFiles: ["__tests__/bug.test.ts"],
          detail: "passes on the merge-base",
        },
      }),
    });
    settleCodeStage(h.ctx);
    h.ctx.state.lastCodeSessionId = "s-build";
    expect(await runRegressionGateStep(h.ctx)).toEqual({ kind: "dispatched" });
    expect(h.ctx.state.fixCycles).toBe(1);
    expect(h.requests[0]).toMatchObject({
      stage: "fix",
      fixCycle: 1,
      verifyFailure: {
        regression: {
          status: "failed",
          reason: "test_passes_on_base",
          testFiles: ["__tests__/bug.test.ts"],
          detail: "passes on the merge-base",
        },
      },
    });
    expect(h.reasons()[0]).toBe(PIPELINE_REASONS.regressionFailed(1, 2));
  });

  it("fails immediately on a command error without spending the budget", async () => {
    const h = makeHarness({
      runVerifyGate: async () => ({
        ran: true,
        passed: false,
        result: {
          status: "failed",
          reason: "command_error",
          testFiles: [],
          detail: "vitest not found",
        },
      }),
    });
    settleCodeStage(h.ctx);
    h.ctx.state.lastCodeSessionId = "s-build";
    const step = await runRegressionGateStep(h.ctx);
    expect(step.kind).toBe("terminal");
    expect(h.finished()?.reason).toBe(
      "regression command error: vitest not found"
    );
    expect(h.ctx.state.fixCycles).toBe(0);
    expect(h.parked[0]?.reason).toBe(
      "Regression test command could not run — the branch was never verified"
    );
    expect(h.reasons()).toEqual([
      PIPELINE_REASONS.failedRegressionCommandError,
    ]);
  });

  it("parks and fails when the gate itself crashes", async () => {
    const h = makeHarness({
      runVerifyGate: async () => {
        throw new Error("gate exploded");
      },
    });
    settleCodeStage(h.ctx);
    const step = await runRegressionGateStep(h.ctx);
    expect(step.kind).toBe("terminal");
    expect(h.finished()?.reason).toBe("regression gate crashed");
    expect(h.reasons()).toEqual([
      PIPELINE_REASONS.failedRegressionGateCrashed,
    ]);
    expect(h.parked).toHaveLength(1);
  });
});

describe("runner-stage-code — handleCodeStageSuccess", () => {
  it("records the code session and dispatches review, carrying the passing report", async () => {
    const report = passingReport(1);
    const h = makeHarness({
      runDeterministicVerification: async () => ({ ran: true, result: report }),
    });
    settleCodeStage(h.ctx, "fix");
    h.ctx.state.handle.sessionId = "s-fix-1";
    expect(await handleCodeStageSuccess(h.ctx)).toBeNull();
    expect(h.ctx.state.lastCodeSessionId).toBe("s-fix-1");
    expect(h.ctx.state.lastVerificationReport).toBe(report);
    expect(h.requests).toEqual([
      {
        stage: "review",
        attempt: 1,
        fixCycle: 0,
        previousAttemptSessionId: null,
        lastCodeSessionId: "s-fix-1",
        verificationReport: report,
      },
    ]);
  });

  it("dispatches grading first when the grader is enabled", async () => {
    const h = makeHarness({ gradingEnabled: true });
    settleCodeStage(h.ctx);
    expect(await handleCodeStageSuccess(h.ctx)).toBeNull();
    expect(h.requests.map((r) => r.stage)).toEqual(["grading"]);
    expect(h.requests[0]).not.toHaveProperty("verificationReport");
  });

  it("keeps the previous code session when the handle has none", async () => {
    const h = makeHarness();
    settleCodeStage(h.ctx);
    h.ctx.state.lastCodeSessionId = "s-earlier";
    h.ctx.state.handle.sessionId = null;
    await handleCodeStageSuccess(h.ctx);
    expect(h.ctx.state.lastCodeSessionId).toBe("s-earlier");
  });
});

describe("runner-stage-grading — handleGradingStageSuccess", () => {
  function settleGrading(ctx: PipelineRunContext): void {
    ctx.state.stage = "grading";
    ctx.state.lastCodeSessionId = "s-build";
    ctx.state.handle = {
      sessionId: "s-grading-1",
      settled: Promise.resolve(settledResult("s-grading-1")),
    };
  }

  it("goes straight to review on a rubric-free skip, carrying the verification report", async () => {
    const report = passingReport(1);
    const h = makeHarness();
    settleGrading(h.ctx);
    h.ctx.state.lastVerificationReport = report;
    expect(
      await handleGradingStageSuccess(
        h.ctx,
        settledResult("", { gradingReportId: null, gradingSkipped: true })
      )
    ).toBeNull();
    expect(h.requests[0]).toMatchObject({
      stage: "review",
      verificationReport: report,
    });
  });

  it("dispatches review when every criterion is met", async () => {
    const h = makeHarness({
      assessGrading: async () => ({
        reportId: "gr-1",
        summary: "all met",
        gradings: [],
        missed: [],
      }),
    });
    settleGrading(h.ctx);
    expect(
      await handleGradingStageSuccess(
        h.ctx,
        settledResult("s-grading-1", { gradingReportId: "gr-1" })
      )
    ).toBeNull();
    expect(h.reasons()[0]).toBe(PIPELINE_REASONS.gradingPassed);
    expect(h.requests.map((r) => r.stage)).toEqual(["review"]);
  });

  it("turns missed criteria into a fix carrying criterion and evidence", async () => {
    const missed = [
      {
        storyId: "us-1",
        criterion: "Second criterion",
        status: "missed" as const,
        evidence: "nothing implements it",
      },
    ];
    const h = makeHarness({
      assessGrading: async () => ({
        reportId: "gr-1",
        summary: "one missed",
        gradings: missed,
        missed,
      }),
    });
    settleGrading(h.ctx);
    expect(
      await handleGradingStageSuccess(
        h.ctx,
        settledResult("s-grading-1", { gradingReportId: "gr-1" })
      )
    ).toBeNull();
    expect(h.ctx.state.fixCycles).toBe(1);
    expect(h.requests[0]).toMatchObject({
      stage: "fix",
      fixCycle: 1,
      gradingFailure: { reportId: "gr-1", summary: "one missed", missed },
    });
    expect(h.reasons()[0]).toBe(PIPELINE_REASONS.gradingMissed(1, 1, 2));
  });

  it("parks the ticket and fails the run once the fix budget is spent", async () => {
    const missed = [
      { storyId: "us-1", criterion: "A", status: "missed" as const, evidence: "no" },
      { storyId: "us-1", criterion: "B", status: "missed" as const, evidence: "no" },
    ];
    const h = makeHarness({
      maxFixCycles: 1,
      assessGrading: async () => ({
        reportId: "gr-2",
        summary: "two missed",
        gradings: missed,
        missed,
      }),
    });
    settleGrading(h.ctx);
    h.ctx.state.fixCycles = 1;
    const summary = await handleGradingStageSuccess(
      h.ctx,
      settledResult("s-grading-1", { gradingReportId: "gr-2" })
    );
    expect(summary?.reason).toBe(
      "2 acceptance criteria remain missed after 1 fix cycles"
    );
    expect(h.parked[0]?.reason).toBe(
      "Acceptance grading found missed criteria after the fix-cycle budget was exhausted"
    );
    expect(h.requests).toHaveLength(0);
  });

  it("treats an unreadable report as a failed attempt on the ladder", async () => {
    const h = makeHarness({ maxAttempts: 2 });
    settleGrading(h.ctx);
    h.ctx.state.stageAttempt = 1;
    expect(
      await handleGradingStageSuccess(
        h.ctx,
        settledResult("s-grading-1", { gradingReportId: null })
      )
    ).toBeNull();
    expect(h.reasons()[0]).toBe(PIPELINE_REASONS.retry("grading", 2, 2));
    expect(h.requests[0]).toMatchObject({
      stage: "grading",
      attempt: 2,
      previousAttemptSessionId: "s-grading-1",
    });
  });
});

describe("runner-stage-review — handleReviewStageSuccess", () => {
  function settleReview(ctx: PipelineRunContext): void {
    ctx.state.stage = "review";
    ctx.state.lastCodeSessionId = "s-build";
    ctx.state.reviewStageStartedAt = "2026-09-06T00:00:00.000Z";
    ctx.state.handle = {
      sessionId: "s-review-1",
      settled: Promise.resolve(settledResult("s-review-1")),
    };
  }

  it("succeeds on a clean review, leaving the ticket for human sign-off", async () => {
    const seen: Array<{ sessionId: string; stageStartedAt: string }> = [];
    const h = makeHarness({
      assessReview: async (input) => {
        seen.push(input);
        return {
          blocking: false,
          blockingCount: 0,
          agentCommentCount: 1,
          usedProseFallback: false,
        };
      },
    });
    settleReview(h.ctx);
    expect(await handleReviewStageSuccess(h.ctx)).toMatchObject({
      state: "succeeded",
      reason: null,
    });
    expect(seen).toEqual([
      {
        sessionId: "s-review-1",
        stageStartedAt: "2026-09-06T00:00:00.000Z",
      },
    ]);
    expect(h.reasons()).toEqual([PIPELINE_REASONS.finished]);
  });

  it("spends a fix cycle on blocking findings", async () => {
    const h = makeHarness({
      assessReview: async () => ({
        blocking: true,
        blockingCount: 2,
        agentCommentCount: 2,
        usedProseFallback: false,
      }),
    });
    settleReview(h.ctx);
    expect(await handleReviewStageSuccess(h.ctx)).toBeNull();
    expect(h.ctx.state.fixCycles).toBe(1);
    expect(h.requests).toEqual([
      {
        stage: "fix",
        attempt: 1,
        fixCycle: 1,
        previousAttemptSessionId: null,
        lastCodeSessionId: "s-build",
      },
    ]);
  });

  it("fails without forensic once the fix budget is spent", async () => {
    const h = makeHarness({
      maxFixCycles: 1,
      assessReview: async () => ({
        blocking: true,
        blockingCount: 1,
        agentCommentCount: 1,
        usedProseFallback: false,
      }),
    });
    settleReview(h.ctx);
    h.ctx.state.fixCycles = 1;
    const summary = await handleReviewStageSuccess(h.ctx);
    expect(summary?.reason).toBe("blocking findings remain after 1 fix cycles");
    expect(h.reasons()).toEqual([PIPELINE_REASONS.failedFindings(1)]);
    expect(h.forensicInputs).toHaveLength(0);
  });

  it("re-reviews through the ladder when the review is unverifiable with nothing to fix", async () => {
    const h = makeHarness({
      assessReview: async () => ({
        blocking: true,
        blockingCount: 0,
        agentCommentCount: 0,
        usedProseFallback: false,
        unverifiable: true,
        verdictSource: "unverifiable",
      }),
    });
    settleReview(h.ctx);
    h.ctx.state.stageAttempt = 1;
    expect(await handleReviewStageSuccess(h.ctx)).toBeNull();
    expect(h.reasons()[0]).toBe(PIPELINE_REASONS.retry("review", 2, 2));
    expect(h.requests[0]).toMatchObject({ stage: "review", attempt: 2 });
    expect(h.ctx.state.fixCycles).toBe(0);
  });

  it("treats an assessment crash as a failed review attempt", async () => {
    const h = makeHarness({
      assessReview: async () => {
        throw new Error("assessment exploded");
      },
    });
    settleReview(h.ctx);
    h.ctx.state.stageAttempt = 1;
    expect(await handleReviewStageSuccess(h.ctx)).toBeNull();
    expect(h.requests[0]).toMatchObject({
      stage: "review",
      attempt: 2,
      previousAttemptSessionId: "s-review-1",
    });
  });
});
