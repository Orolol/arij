import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";

export type AgentSessionLifecycleStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Delivery verdict for a terminal session — the persisted, first-class signal
 * of how the agent's run ended:
 *
 *   - answered:       the agent delivered textual output (default success)
 *   - asked_question: the agent ended by asking the user a question
 *   - silent:         the run succeeded but produced no textual deliverable
 *   - error:          the session failed
 *
 * NULL in the database means "not classified": legacy rows, non-terminal
 * sessions, and user-cancelled sessions (cancellation is a user decision,
 * not a delivery verdict).
 */
export const SESSION_OUTCOMES = [
  "answered",
  "asked_question",
  "silent",
  "error",
] as const;

export type SessionOutcome = (typeof SESSION_OUTCOMES)[number];

export function isSessionOutcome(value: unknown): value is SessionOutcome {
  return (
    typeof value === "string" &&
    (SESSION_OUTCOMES as readonly string[]).includes(value)
  );
}

export const SESSION_LIFECYCLE_CONFLICT_CODE = "INVALID_SESSION_TRANSITION";
export const SESSION_NOT_FOUND_CODE = "SESSION_NOT_FOUND";

type TerminalStatus = Extract<
  AgentSessionLifecycleStatus,
  "completed" | "failed" | "cancelled"
>;

const TERMINAL_STATUSES: Set<string> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

const ALLOWED_TRANSITIONS: Record<
  AgentSessionLifecycleStatus,
  AgentSessionLifecycleStatus[]
> = {
  queued: ["running", "cancelled", "failed"],
  running: ["completed", "failed", "cancelled"],
  completed: [], // terminal
  failed: [], // terminal
  cancelled: [], // terminal
};

export interface SessionLifecycleSnapshot {
  id: string;
  status: string | null;
  startedAt: string | null;
  endedAt: string | null;
  completedAt: string | null;
}

export interface SessionLifecycleConflictDetails {
  sessionId: string;
  fromStatus: string | null;
  toStatus: AgentSessionLifecycleStatus;
}

export class SessionLifecycleConflictError extends Error {
  readonly code = SESSION_LIFECYCLE_CONFLICT_CODE;
  readonly details: SessionLifecycleConflictDetails;

  constructor(details: SessionLifecycleConflictDetails) {
    super(
      `Invalid session transition from ${details.fromStatus ?? "unknown"} to ${details.toStatus}`
    );
    this.name = "SessionLifecycleConflictError";
    this.details = details;
  }
}

export class SessionNotFoundError extends Error {
  readonly code = SESSION_NOT_FOUND_CODE;
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
    this.sessionId = sessionId;
  }
}

export function isSessionLifecycleConflictError(
  error: unknown
): error is SessionLifecycleConflictError {
  return error instanceof SessionLifecycleConflictError;
}

export function isSessionNotFoundError(
  error: unknown
): error is SessionNotFoundError {
  return error instanceof SessionNotFoundError;
}

export function normalizeSessionLifecycleStatus(
  status: string | null | undefined
): AgentSessionLifecycleStatus | null {
  if (!status) return null;
  if (status === "pending") return "queued";
  if (
    status === "queued" ||
    status === "running" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  ) {
    return status;
  }
  return null;
}

export function getSessionStatusForApi(
  status: string | null | undefined
): string {
  return normalizeSessionLifecycleStatus(status) ?? (status ?? "queued");
}

export function isValidSessionTransition(
  fromStatus: AgentSessionLifecycleStatus,
  toStatus: AgentSessionLifecycleStatus
): boolean {
  return ALLOWED_TRANSITIONS[fromStatus].includes(toStatus);
}

/**
 * Asserts a valid transition; throws a SessionLifecycleConflictError if
 * invalid. Returns the target status for convenience.
 */
export function assertValidSessionTransition(
  sessionId: string,
  fromStatus: AgentSessionLifecycleStatus,
  toStatus: AgentSessionLifecycleStatus
): AgentSessionLifecycleStatus {
  if (!isValidSessionTransition(fromStatus, toStatus)) {
    throw new SessionLifecycleConflictError({
      sessionId,
      fromStatus,
      toStatus,
    });
  }
  return toStatus;
}

/**
 * Returns true if the given status is terminal (no further transitions
 * allowed).
 */
export function isTerminalSessionStatus(
  status: AgentSessionLifecycleStatus
): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

export interface SessionTransitionPatch {
  status: AgentSessionLifecycleStatus;
  startedAt?: string;
  endedAt?: string;
  completedAt?: string;
  error?: string | null;
  outcome?: SessionOutcome;
}

export function buildSessionTransitionPatch(
  session: SessionLifecycleSnapshot,
  toStatus: AgentSessionLifecycleStatus,
  at: string,
  error?: string | null,
  outcome?: SessionOutcome
): SessionTransitionPatch {
  const fromStatus = normalizeSessionLifecycleStatus(session.status);
  if (!fromStatus || !isValidSessionTransition(fromStatus, toStatus)) {
    throw new SessionLifecycleConflictError({
      sessionId: session.id,
      fromStatus: session.status,
      toStatus,
    });
  }

  const patch: SessionTransitionPatch = {
    status: toStatus,
  };

  if (toStatus === "running" && !session.startedAt) {
    patch.startedAt = at;
  }

  if (TERMINAL_STATUSES.has(toStatus)) {
    if (!session.endedAt) {
      patch.endedAt = at;
    }
    if (!session.completedAt) {
      patch.completedAt = at;
    }
    if (error !== undefined) {
      patch.error = error;
    } else if (toStatus === "completed") {
      patch.error = null;
    }
    if (outcome !== undefined) {
      patch.outcome = outcome;
    }
  }

  return patch;
}

export interface TransitionSessionStatusInput {
  sessionId: string;
  toStatus: AgentSessionLifecycleStatus;
  at?: string;
  error?: string | null;
  outcome?: SessionOutcome;
}

export function transitionSessionStatus({
  sessionId,
  toStatus,
  at = new Date().toISOString(),
  error,
  outcome,
}: TransitionSessionStatusInput): SessionTransitionPatch {
  const session = db
    .select({
      id: agentSessions.id,
      status: agentSessions.status,
      startedAt: agentSessions.startedAt,
      endedAt: agentSessions.endedAt,
      completedAt: agentSessions.completedAt,
    })
    .from(agentSessions)
    .where(eq(agentSessions.id, sessionId))
    .get();

  if (!session) {
    throw new SessionNotFoundError(sessionId);
  }

  const patch = buildSessionTransitionPatch(session, toStatus, at, error, outcome);

  db.update(agentSessions)
    .set(patch)
    .where(eq(agentSessions.id, sessionId))
    .run();

  return patch;
}

export interface CreateQueuedSessionInput
  extends Omit<
    typeof agentSessions.$inferInsert,
    "status" | "startedAt" | "endedAt" | "completedAt"
  > {}

export function createQueuedSession(values: CreateQueuedSessionInput): void {
  db.insert(agentSessions)
    .values({
      ...values,
      status: "queued",
    })
    .run();
}

export function markSessionRunning(
  sessionId: string,
  at?: string
): SessionTransitionPatch {
  return transitionSessionStatus({
    sessionId,
    toStatus: "running",
    at,
  });
}

export function markSessionTerminal(
  sessionId: string,
  result: {
    success: boolean;
    error?: string | null;
    /**
     * Delivery verdict for this run (see `classifySessionOutcome` in
     * lib/claude/resolve-session-output.ts). When omitted, failed sessions
     * still get 'error' so the verdict column never lies about failures;
     * successful sessions stay unclassified (NULL).
     */
    outcome?: SessionOutcome;
  },
  at?: string
): SessionTransitionPatch {
  return transitionSessionStatus({
    sessionId,
    toStatus: result.success ? "completed" : "failed",
    at,
    error: result.error ?? null,
    outcome: result.outcome ?? (result.success ? undefined : "error"),
  });
}

export function markSessionCancelled(
  sessionId: string,
  error = "Cancelled by user",
  at?: string
): SessionTransitionPatch {
  return transitionSessionStatus({
    sessionId,
    toStatus: "cancelled",
    at,
    error,
  });
}
