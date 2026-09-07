/**
 * The one background-session dispatch path.
 *
 * Every non-interactive agent run in Arij — memory distill, dreaming, spec
 * update and auto-rewrite, refinement, grading, forensic diagnostics, the
 * Full Auto second opinion, QA checks — had its own hand-rolled copy of the
 * same nine steps: mint a session id, make the logs directory, decide
 * whether the provider takes a pre-assigned CLI session id, insert the
 * queued row, submit to the scheduler, mark running, spawn, wait, classify,
 * extract usage, mark terminal. Nine copies is nine chances to drop the
 * user's resolved agent on the floor and re-default the provider, which is
 * exactly the failure this module exists to make impossible: the provider is
 * read from the resolved agent here and nowhere else.
 *
 * What stays with the caller: everything that is not the lifecycle. Guards,
 * prompt assembly, worktree creation, events, report rows, and the domain
 * decision of what "success" even means for that kind of run. Those arrive
 * as the `evaluate` / `onTerminal` / `onLaunchFailure` hooks below rather
 * than as flags, because they differ per call site in ways a flag cannot
 * express — a grading run is only successful if a report row exists, a spec
 * rewrite only if the output survives sanitisation.
 *
 * THE LAUNCH PROLOGUE IS DELIBERATELY NOT INSIDE AN `async` FUNCTION.
 * Spawning is synchronous, and a missing CLI or a vanished worktree is the
 * launch failure that actually happens; a plain try/catch catches it in the
 * same tick, so a caller's `onLaunchFailure` (the QA report row, the
 * refinement report) is already written when the dispatching request
 * returns. Wrapping the same code in `async` would defer that catch to a
 * microtask and turn a guarantee into a timing accident. The scheduler
 * documents the synchronous throw as a supported path and funnels it into
 * the same rejection handling.
 */

import fs from "fs";
import path from "path";

import { createId } from "@/lib/utils/nanoid";
import { processManager } from "@/lib/claude/process-manager";
import type { ClaudeOptions, ClaudeResult } from "@/lib/claude/spawn";
import type { SessionStatus } from "@/lib/claude/process-manager";
import {
  classifySessionOutcome,
  extractSessionUsage,
} from "@/lib/claude/resolve-session-output";
import { agentScheduler } from "@/lib/agents/scheduler";
import type { ResolvedAgent } from "@/lib/agent-config/agent-resolution";
import {
  createQueuedSession,
  type CreateQueuedSessionInput,
  isSessionLifecycleConflictError,
  markSessionRunning,
  markSessionTerminal,
  type SessionOutcome,
} from "@/lib/agent-sessions/lifecycle";
import { providerAcceptsAssignedSessionId } from "@/lib/agent-sessions/resume-capability";
import { resolveSessionsRoot } from "@/lib/agent-sessions/session-paths";
import { waitForProcessCompletion } from "@/lib/agent-sessions/wait-for-completion";

/**
 * The CLI session id to record for a provider, or `undefined` when the
 * provider reports its own.
 *
 * The sole reference to {@link providerAcceptsAssignedSessionId} outside its
 * own module: the dispatch paths that cannot yet take the whole helper (the
 * build, review, merge, pull and release routes, which carry worktrees,
 * workflow transitions and an explicit resume preference) still mint their
 * id through this function, so the answer to "does this provider take an
 * assigned id?" is written once.
 *
 * Callers with a resume preference keep it: `resume ? previousId :
 * mintAssignedCliSessionId(provider)`.
 */
export function mintAssignedCliSessionId(
  provider: string,
): string | undefined {
  return providerAcceptsAssignedSessionId(provider)
    ? crypto.randomUUID()
    : undefined;
}

/** Absolute path of a session's own artifact directory. */
export function sessionLogsDir(sessionId: string): string {
  return path.join(resolveSessionsRoot(), sessionId);
}

/**
 * Creates `data/sessions/<id>/` and returns the convenience log file path.
 * The session row and its chunks stay authoritative; this file is a dump.
 */
export function createSessionLogsPath(sessionId: string): string {
  const logsDir = sessionLogsDir(sessionId);
  fs.mkdirSync(logsDir, { recursive: true });
  return path.join(logsDir, "logs.json");
}

/** What the run produced, handed to every hook and to the settled promise. */
export interface BackgroundSessionRun {
  sessionId: string;
  /** Raw provider result; `undefined` when the process vanished. */
  result: ClaudeResult | undefined;
  /** `waitForProcessCompletion`'s status — "cancelled" matters to reports. */
  status: SessionStatus | undefined;
  outcome: SessionOutcome;
  completedAt: string;
}

/** The terminal verdict written to the session row. */
export interface BackgroundSessionVerdict {
  success: boolean;
  error: string | null;
}

/** Everything a hook fired after the row is terminal needs. */
export interface BackgroundSessionTerminal
  extends BackgroundSessionRun,
    BackgroundSessionVerdict {}

/**
 * Handed to `onQueued` and `onLaunchFailure`: the row exists; nothing may
 * have spawned yet.
 */
export interface BackgroundSessionQueued {
  sessionId: string;
  logsPath: string;
  /** The row's `created_at`, for dependent rows that should share it. */
  createdAt: string;
}

/** Resolution value of {@link DispatchedBackgroundSession.settled}. */
export interface BackgroundSessionSettled extends BackgroundSessionTerminal {
  /**
   * Set when the launch itself threw (missing CLI, vanished worktree) or the
   * wait rejected. `result` is then `undefined` and no verdict was derived
   * from a provider run.
   */
  launchError: unknown;
}

export interface DispatchBackgroundSessionInput {
  /** `agent_sessions.agent_type` — the row's identity, and the persona key. */
  agentType: string;
  projectId: string;
  /**
   * Deliberately optional, and deliberately NOT defaulted.
   *
   * A project-level background run (distill, dreaming, spec update/rewrite,
   * refinement, forensic) passes nothing here so the epic-scoped concurrency
   * guards do not see it as "an agent is already working on this ticket" and
   * so its MCP token cannot default to a ticket it was not launched for. A
   * ticket-scoped run (grading, second opinion) passes the epic on purpose.
   * Both are load-bearing; neither is a default.
   */
  epicId?: string | null;
  userStoryId?: string | null;
  prompt: string;
  /**
   * The user's choice, already resolved. The provider, model, named-agent id
   * and name are all read from here — this helper never falls back to a
   * built-in provider, because a silent re-default is the bug it exists to
   * prevent.
   */
  resolvedAgent: ResolvedAgent;
  mode: ClaudeOptions["mode"];
  /** Working directory for the CLI. */
  cwd?: string;
  /** Poll interval for `waitForProcessCompletion`; the default is its own. */
  pollIntervalMs?: number;
  /**
   * Extra columns for the queued row: `worktreePath`, `branchName`,
   * `batchRunId`, `orchestrationMode`, `estimatedPromptTokens`,
   * `refinementActions`, … Anything the helper owns (`id`, `projectId`,
   * `epicId`, `userStoryId`, `mode`, `provider`, `prompt`, `logsPath`,
   * `cliSessionId`, `namedAgentId`, `compositeAgentId`, `namedAgentName`,
   * `model`, `agentType`, `createdAt`) is set from the fields above and
   * cannot be overridden here.
   */
  session?: Omit<
    Partial<CreateQueuedSessionInput>,
    | "id"
    | "projectId"
    | "epicId"
    | "userStoryId"
    | "mode"
    | "provider"
    | "prompt"
    | "logsPath"
    | "cliSessionId"
    | "namedAgentId"
    | "compositeAgentId"
    | "namedAgentName"
    | "model"
    | "agentType"
    | "createdAt"
  >;
  /** Extra `processManager.start` options (allowedTools, …). */
  spawn?: Omit<
    Partial<ClaudeOptions>,
    "mode" | "prompt" | "cwd" | "model" | "cliSessionId"
  >;
  /** Tag for the `console.error` on a lifecycle write failure. */
  logPrefix: string;
  /**
   * Fired synchronously after the queued row exists and before the launch is
   * submitted. Where events and dependent rows (a QA report) are written, so
   * they are durable before anything can spawn.
   */
  onQueued?: (context: BackgroundSessionQueued) => void;
  /**
   * Derives the terminal verdict from the run. Defaults to the provider's
   * own answer. This runs BEFORE `markSessionTerminal`, so a run that
   * delivered nothing usable can be recorded as failed even though the CLI
   * exited zero — the row must not claim success over an unchanged document.
   */
  evaluate?: (run: BackgroundSessionRun) => BackgroundSessionVerdict;
  /**
   * Fired after the session row is terminal. Events, report publication,
   * document writes. A throw here rejects the launch closure (which the
   * scheduler handles) after the row is already final.
   */
  onTerminal?: (terminal: BackgroundSessionTerminal) => void | Promise<void>;
  /**
   * Fired when the spawn threw synchronously, or the wait/terminal work
   * rejected. The error is rethrown afterwards: the scheduler still owns the
   * session row and the slot, so this hook adds a write rather than
   * swallowing a failure.
   *
   * Takes the queued context because it can fire BEFORE
   * `dispatchBackgroundSession` returns: the scheduler runs an idle project's
   * launch closure in the submitting tick, so a spawn that throws reaches
   * this hook while the caller's own `sessionId` binding does not exist yet.
   */
  onLaunchFailure?: (error: unknown, context: BackgroundSessionQueued) => void;
}

export interface DispatchedBackgroundSession {
  sessionId: string;
  logsPath: string;
  /** The provider actually dispatched to, read from the resolved agent. */
  provider: string;
  cliSessionId: string | undefined;
  /**
   * Resolves when the run reached a terminal state, including when the
   * launch failed. Never rejects — callers that want the failure read
   * `launchError`.
   */
  settled: Promise<BackgroundSessionSettled>;
}

/**
 * Creates one queued background session, schedules it, and owns its whole
 * lifecycle through to the terminal row.
 *
 * Returns as soon as the row exists and the launch is submitted; the run
 * itself is observed through `settled`.
 */
export function dispatchBackgroundSession(
  input: DispatchBackgroundSessionInput,
): DispatchedBackgroundSession {
  const { resolvedAgent } = input;
  // Read once, from the resolved agent. No `?? FALLBACK_PROVIDER` here or
  // anywhere below: an unresolvable agent is the caller's error to raise
  // before dispatch, not a reason to quietly run someone else's CLI.
  const provider = resolvedAgent.provider;
  const model = resolvedAgent.model || undefined;

  const sessionId = createId();
  const createdAt = new Date().toISOString();
  const logsPath = createSessionLogsPath(sessionId);
  const cliSessionId = mintAssignedCliSessionId(provider);

  // The type already forbids the owned keys on `session`; the two anchors are
  // stripped at runtime as well, because every other owned key is overwritten
  // by the spread below while these are forwarded only when the caller passed
  // them — a cast must not be able to anchor a project-level run to a ticket.
  const extraColumns: Partial<CreateQueuedSessionInput> = {
    ...(input.session ?? {}),
  };
  delete extraColumns.epicId;
  delete extraColumns.userStoryId;

  createQueuedSession({
    ...extraColumns,
    id: sessionId,
    projectId: input.projectId,
    // Forwarded only when the caller said something. An omitted epicId stays
    // omitted — the column is NULL either way, but the payload shape is what
    // "deliberately project-level" is asserted on — and an explicit null is
    // kept as an explicit null.
    ...(input.epicId !== undefined ? { epicId: input.epicId } : {}),
    ...(input.userStoryId !== undefined
      ? { userStoryId: input.userStoryId }
      : {}),
    mode: input.mode,
    provider,
    prompt: input.prompt,
    logsPath,
    cliSessionId,
    namedAgentId: resolvedAgent.namedAgentId ?? null,
    // The COMPOSITE that unfolded to `namedAgentId`, when one did. Persisted
    // alongside the member so reliability statistics stay measured per real
    // agent while the list that chose it is still recoverable.
    compositeAgentId: resolvedAgent.compositeAgentId ?? null,
    namedAgentName: resolvedAgent.name || null,
    model: model ?? null,
    agentType: input.agentType,
    createdAt,
  });

  const queued: BackgroundSessionQueued = { sessionId, logsPath, createdAt };
  input.onQueued?.(queued);

  let settle!: (value: BackgroundSessionSettled) => void;
  const settled = new Promise<BackgroundSessionSettled>((resolve) => {
    settle = resolve;
  });

  const failureSettlement = (error: unknown): BackgroundSessionSettled => ({
    sessionId,
    result: undefined,
    status: undefined,
    outcome: "error",
    completedAt: new Date().toISOString(),
    success: false,
    error:
      error instanceof Error
        ? error.message
        : `The ${input.agentType} session did not run.`,
    launchError: error,
  });

  // See the module docblock: the prologue is synchronous on purpose.
  agentScheduler.submit(input.projectId, sessionId, () => {
    try {
      markSessionRunning(sessionId);
      processManager.start(
        sessionId,
        {
          ...(input.spawn ?? {}),
          // Must match the persisted session mode.
          mode: input.mode,
          prompt: input.prompt,
          cwd: input.cwd,
          model,
          cliSessionId,
        },
        provider,
      );
    } catch (error) {
      input.onLaunchFailure?.(error, queued);
      settle(failureSettlement(error));
      // Rethrown unchanged: the scheduler owns the session row and the slot;
      // this catch adds writes, it does not swallow a failure.
      throw error;
    }

    return awaitCompletion();
  });

  async function awaitCompletion(): Promise<void> {
    // Settled in `finally` rather than at the point of success, so a caller
    // whose `onTerminal` throws still releases everything waiting on the run
    // — with the terminal verdict when the row reached one, and with the
    // launch-failure shape when it did not.
    let settlement: BackgroundSessionSettled | null = null;

    try {
      const info = await waitForProcessCompletion(
        sessionId,
        input.pollIntervalMs,
      );
      const completedAt = new Date().toISOString();
      const result = info?.result;

      try {
        fs.writeFileSync(logsPath, JSON.stringify(result, null, 2));
      } catch {
        // Best-effort: the session row and its chunks stay authoritative.
      }

      const run: BackgroundSessionRun = {
        sessionId,
        result,
        status: info?.status,
        outcome: classifySessionOutcome(result, sessionId),
        completedAt,
      };

      // Before `markSessionTerminal` on purpose: a run that produced nothing
      // usable is a failure for its workflow even when the CLI exited zero,
      // and the row must not claim success over an unchanged document.
      const verdict: BackgroundSessionVerdict = input.evaluate
        ? input.evaluate(run)
        : { success: !!result?.success, error: result?.error ?? null };

      try {
        markSessionTerminal(
          sessionId,
          {
            success: verdict.success,
            error: verdict.error,
            outcome: run.outcome,
            usage: extractSessionUsage(result),
          },
          completedAt,
        );
      } catch (error) {
        if (!isSessionLifecycleConflictError(error)) {
          console.error(`${input.logPrefix} Failed to finalize session`, error);
        }
      }

      settlement = { ...run, ...verdict, launchError: null };
      await input.onTerminal?.({ ...run, ...verdict });
    } catch (error) {
      input.onLaunchFailure?.(error, queued);
      if (settlement) settlement.launchError = error;
      else settlement = failureSettlement(error);
      throw error;
    } finally {
      settle(settlement ?? failureSettlement(null));
    }
  }

  return { sessionId, logsPath, provider, cliSessionId, settled };
}
