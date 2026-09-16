/** Read-only evidence collection. Session launch and memory writes live in dreaming.ts. */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agentSessions,
  epics,
  reviewComments,
  ticketComments,
  userStories,
} from "@/lib/db/schema";
import { extractLastNonEmptyTextFromFile } from "@/lib/agent-sessions/last-text";
import {
  FORENSIC_COMMENT_HEADING,
  parseForensicDeadSessionId,
  readChunkTail,
} from "@/lib/pipeline/forensic";
import {
  DREAM_DIGEST_MAX_CHARS,
  DREAM_FINAL_TEXT_SOURCE_MAX_CHARS,
  DREAM_FORENSIC_ATTACH_SLACK_MS,
  DREAM_MAX_SESSIONS,
  DREAM_SOURCE_AGENT_TYPES,
  DREAM_WINDOW_DAYS,
} from "./dreaming-constants";
import {
  assembleDreamDigest,
  extractReviewVerdict,
  parseTimestampMs,
  resolveDreamWindow,
  type AssembledDreamDigest,
  type DreamSessionDigest,
} from "./dreaming-digest";
import { findLastDreamCutoff } from "./dreaming-settings";

/** Statuses a session must have reached to be dreamable evidence. */
const TERMINAL_SESSION_STATUSES: readonly string[] = ["completed", "failed"];

export interface CollectDreamDigestOptions {
  /** Clock injection point (tests, and only tests, pass this). */
  now?: Date;
  maxSessions?: number;
  windowDays?: number;
  maxChars?: number;
}

export interface DreamDigestResult extends AssembledDreamDigest {
  /** Inclusive lower bound of the collection window (terminal time). */
  sinceIso: string;
  /**
   * The moment this collection happened — what `recordDreamCutoff` persists
   * once the dream has actually rewritten the memory, and therefore where the
   * NEXT window opens. Deliberately the collection instant and not the dream's
   * end: a session that reaches a terminal state while the dream is still
   * running was not in this digest and must stay readable by the next one.
   */
  collectedAtIso: string;
  /** Cutoff this window follows, or null for a first dream. */
  lastCutoffAt: string | null;
  /** Candidates inside the window before the session-count cap. */
  candidateCount: number;
  /** Per-session records that were rendered (chronological order). */
  sessions: DreamSessionDigest[];
}

interface DreamCandidateRow {
  id: string;
  epicId: string | null;
  userStoryId: string | null;
  agentType: string | null;
  provider: string | null;
  model: string | null;
  status: string | null;
  outcome: string | null;
  error: string | null;
  lastNonEmptyText: string | null;
  logsPath: string | null;
  createdAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  completedAt: string | null;
  totalCostUsd: number | null;
}

/** When the run began: its start, else when it was queued. */
function sessionAt(row: DreamCandidateRow): string | null {
  return row.startedAt ?? row.createdAt;
}

/**
 * When the run BECAME EVIDENCE — the moment it reached a terminal state.
 *
 * This, not the start, is what places a session in a dream's window: a build
 * that started before the previous dream and ended after it was never in that
 * digest, and keying on `startedAt` would hide it from every dream that
 * follows. Falls back to the start only for legacy rows with no terminal
 * timestamp at all.
 */
function sessionTerminalMs(row: DreamCandidateRow): number | null {
  return (
    parseTimestampMs(row.endedAt) ??
    parseTimestampMs(row.completedAt) ??
    parseTimestampMs(sessionAt(row))
  );
}

/**
 * Terminal source sessions of the project inside the window, newest first,
 * capped at `maxSessions`.
 *
 * "Inside the window" means the session REACHED a terminal state at/after
 * `sinceIso` — see `sessionTerminalMs`.
 *
 * Timestamps are compared with Date.parse in JS rather than in SQL because
 * `created_at` mixes explicit ISO strings with SQLite CURRENT_TIMESTAMP
 * defaults — the same reason lib/pipeline/findings.ts filters in JS. The SQL
 * side still narrows on project, agent type and status, so the scan stays
 * small.
 */
export function selectDreamCandidates(
  projectId: string,
  sinceIso: string,
  maxSessions: number = DREAM_MAX_SESSIONS
): { rows: DreamCandidateRow[]; candidateCount: number } {
  const sinceMs = parseTimestampMs(sinceIso);
  const rows = db
    .select({
      id: agentSessions.id,
      epicId: agentSessions.epicId,
      userStoryId: agentSessions.userStoryId,
      agentType: agentSessions.agentType,
      provider: agentSessions.provider,
      model: agentSessions.model,
      status: agentSessions.status,
      outcome: agentSessions.outcome,
      error: agentSessions.error,
      lastNonEmptyText: agentSessions.lastNonEmptyText,
      logsPath: agentSessions.logsPath,
      createdAt: agentSessions.createdAt,
      startedAt: agentSessions.startedAt,
      endedAt: agentSessions.endedAt,
      completedAt: agentSessions.completedAt,
      totalCostUsd: agentSessions.totalCostUsd,
    })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        inArray(agentSessions.agentType, [...DREAM_SOURCE_AGENT_TYPES]),
        inArray(agentSessions.status, [...TERMINAL_SESSION_STATUSES])
      )
    )
    .all();

  const inWindow = rows.filter((row) => {
    const ms = sessionTerminalMs(row);
    // A session we cannot date cannot be placed in the window — leaving it out
    // is the choice that keeps consecutive dreams from re-reading it forever.
    if (ms === null) return false;
    return sinceMs === null || ms >= sinceMs;
  });

  // Newest-terminal first, so the count cap keeps the freshest evidence.
  inWindow.sort(
    (a, b) => (sessionTerminalMs(b) ?? 0) - (sessionTerminalMs(a) ?? 0)
  );

  return {
    rows: inWindow.slice(0, Math.max(0, maxSessions)),
    candidateCount: inWindow.length,
  };
}

/** "E-proj-003: Login flow — Story title" for the digest heading. */
function loadTicketLabels(
  epicIds: string[],
  storyIds: string[]
): { epics: Map<string, string>; stories: Map<string, string> } {
  const epicLabels = new Map<string, string>();
  const storyLabels = new Map<string, string>();

  if (epicIds.length > 0) {
    for (const row of db
      .select({
        id: epics.id,
        title: epics.title,
        readableId: epics.readableId,
      })
      .from(epics)
      .where(inArray(epics.id, epicIds))
      .all()) {
      epicLabels.set(
        row.id,
        row.readableId ? `${row.readableId}: ${row.title}` : row.title
      );
    }
  }

  if (storyIds.length > 0) {
    for (const row of db
      .select({ id: userStories.id, title: userStories.title })
      .from(userStories)
      .where(inArray(userStories.id, storyIds))
      .all()) {
      storyLabels.set(row.id, row.title);
    }
  }

  return { epics: epicLabels, stories: storyLabels };
}

interface DatedRow {
  id: string;
  body: string;
  createdMs: number | null;
  /** Story the row was filed against; null for epic-scoped rows. */
  userStoryId?: string | null;
  /** Session the row explicitly names as its subject (forensic comments). */
  deadSessionId?: string | null;
  /** Session that FILED the row (review findings, since migration 0032). */
  agentSessionId?: string | null;
}

/**
 * Agent-authored `[critical]`/`[major]` findings per epic.
 *
 * Two differences from the pipeline's blocking assessment
 * (lib/pipeline/findings.ts):
 *   - RESOLVED rows are kept: a finding that was fixed still records a mistake
 *     the agents made, which is exactly what a dream is looking for;
 *   - `agentSessionId` comes along. Since migration 0032 the MCP
 *     submit_findings route records which review session filed each row, so a
 *     finding can be attributed EXACTLY. Two reviewers running on the same epic
 *     at once used to be indistinguishable by timestamp, and each would be
 *     handed the other's findings.
 */
function loadBlockingFindingsByEpic(epicIds: string[]): Map<string, DatedRow[]> {
  const byEpic = new Map<string, DatedRow[]>();
  if (epicIds.length === 0) return byEpic;

  for (const row of db
    .select({
      id: reviewComments.id,
      epicId: reviewComments.epicId,
      body: reviewComments.body,
      createdAt: reviewComments.createdAt,
      agentSessionId: reviewComments.agentSessionId,
    })
    .from(reviewComments)
    .where(
      and(
        inArray(reviewComments.epicId, epicIds),
        eq(reviewComments.author, "agent")
      )
    )
    .all()) {
    const body = row.body.trim();
    if (!/^\[(critical|major)\]/i.test(body)) continue;
    const list = byEpic.get(row.epicId) ?? [];
    list.push({
      id: row.id,
      body,
      createdMs: parseTimestampMs(row.createdAt),
      agentSessionId: row.agentSessionId ?? null,
    });
    byEpic.set(row.epicId, list);
  }
  return byEpic;
}

/**
 * Forensic diagnostic comments per epic (lib/pipeline/forensic.ts files them).
 *
 * `userStoryId` comes along because an epic can carry several story-scoped
 * runs at once: the post-mortem of story A must not be pinned onto the session
 * that built story B just because their run windows overlap.
 */
function loadForensicCommentsByEpic(epicIds: string[]): Map<string, DatedRow[]> {
  const byEpic = new Map<string, DatedRow[]>();
  if (epicIds.length === 0) return byEpic;

  for (const row of db
    .select({
      id: ticketComments.id,
      epicId: ticketComments.epicId,
      userStoryId: ticketComments.userStoryId,
      content: ticketComments.content,
      createdAt: ticketComments.createdAt,
    })
    .from(ticketComments)
    .where(
      and(
        inArray(ticketComments.epicId, epicIds),
        eq(ticketComments.author, "agent")
      )
    )
    .all()) {
    if (!row.epicId) continue;
    if (!row.content.startsWith(FORENSIC_COMMENT_HEADING)) continue;
    const deadSessionId = parseForensicDeadSessionId(row.content);
    const list = byEpic.get(row.epicId) ?? [];
    list.push({
      id: row.id,
      body: row.content
        .slice(FORENSIC_COMMENT_HEADING.length)
        // The marker is metadata, not prose — never feed it to the dream.
        .replace(/<!--\s*arij:dead-session=[^>]*-->/, "")
        .trim(),
      createdMs: parseTimestampMs(row.createdAt),
      userStoryId: row.userStoryId ?? null,
      deadSessionId,
    });
    byEpic.set(row.epicId, list);
  }
  return byEpic;
}

/**
 * Assigns each forensic diagnostic to the session it actually diagnoses.
 *
 * Two paths, in order.
 *
 * EXACT: the pipeline stamps the diagnosed session's id into the comment
 * (`forensicDeadSessionMarker`), so a marked comment is matched by id — which
 * is the only attribution that survives a forensic agent sitting in a queue
 * for an hour before it writes. A marker naming a session outside this window
 * attaches to nothing rather than falling back.
 *
 * HEURISTIC, for comments written before that marker existed: same scope,
 * comment inside the run's window (start → terminal + slack), and — the part
 * that matters — the CLOSEST such session, preferring one that had already
 * ended.
 *
 * "Closest" is what makes reruns come out right. A first attempt ending at
 * 10:00 and its retry ending at 10:20 both have windows covering a diagnostic
 * filed at 10:21; taking the first session in chronological order would hand
 * the retry's post-mortem to the attempt before it, and the dream would then
 * reason about a failure that belongs to different code.
 *
 * Returns sessionId → diagnostic body, at most one each way: a session gets
 * one post-mortem, and a post-mortem is never repeated across a ticket's runs
 * (which would also burn the digest budget).
 */
function assignForensicComments(
  rows: DreamCandidateRow[],
  forensicByEpic: Map<string, DatedRow[]>
): Map<string, string> {
  const assigned = new Map<string, string>();
  const takenSessions = new Set<string>();

  const comments = [...forensicByEpic.values()]
    .flat()
    // A comment with an explicit marker needs no timestamp; only the legacy
    // heuristic below does.
    .filter((comment) => comment.deadSessionId || comment.createdMs !== null)
    // Reserve exact subjects first. An older legacy diagnostic must not guess
    // its way onto a session that a later marked report explicitly diagnoses.
    .sort((a, b) =>
      Number(Boolean(b.deadSessionId)) - Number(Boolean(a.deadSessionId)) ||
      (a.createdMs ?? 0) - (b.createdMs ?? 0)
    );

  for (const comment of comments) {
    const matchesScope = (row: DreamCandidateRow) =>
      row.epicId !== null &&
      (comment.userStoryId ?? null) === (row.userStoryId ?? null) &&
      (forensicByEpic.get(row.epicId) ?? []).includes(comment);
    // Exact link when the pipeline recorded one: no timestamps, no guessing,
    // and immune to a forensic agent that was queued for an hour.
    if (comment.deadSessionId) {
      const named = rows.find(
        (row) => row.id === comment.deadSessionId &&
          !takenSessions.has(row.id) && matchesScope(row)
      );
      if (named) {
        takenSessions.add(named.id);
        assigned.set(named.id, comment.body);
      }
      // A marker pointing outside this digest's window means the diagnosed
      // session is not here — it must NOT fall through to the heuristic and
      // land on some other run.
      continue;
    }

    const at = comment.createdMs!;
    const candidates = rows
      .filter((row) => {
        if (takenSessions.has(row.id) || !matchesScope(row)) return false;
        const startMs = parseTimestampMs(sessionAt(row));
        const terminalMs = sessionTerminalMs(row);
        if (startMs !== null && at < startMs) return false;
        if (terminalMs !== null && at > terminalMs + DREAM_FORENSIC_ATTACH_SLACK_MS) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aEnd = sessionTerminalMs(a) ?? 0;
        const bEnd = sessionTerminalMs(b) ?? 0;
        // A session that had already ended when the diagnostic landed beats one
        // that was still running: the pipeline files post-mortems for the dead.
        const aBefore = aEnd <= at ? 0 : 1;
        const bBefore = bEnd <= at ? 0 : 1;
        if (aBefore !== bBefore) return aBefore - bBefore;
        return Math.abs(at - aEnd) - Math.abs(at - bEnd);
      });

    const best = candidates[0];
    if (best) {
      takenSessions.add(best.id);
      assigned.set(best.id, comment.body);
    }
  }

  return assigned;
}

/**
 * The tail of a session's final response.
 *
 * Resolution order matters, and the obvious first choice is the wrong one:
 * `agent_sessions.last_non_empty_text` holds only the last non-empty LINE of
 * the newest chunk (see `extractLastNonEmptyText`). Preferring it collapsed a
 * whole review report to one line — and a report's mandated
 * `**Overall Verdict: …**` only survived when it happened to BE that line, so
 * the digest silently lost most verdicts and every closing paragraph.
 *
 * So the persisted chunk streams come first:
 *   - `response` — the final assistant text for streaming providers;
 *   - `output` — where Claude Code's result envelope is persisted
 *     (`result-<sessionId>`) and where other providers put their final output;
 *   - the logs file, then the one-line column, only as last resorts.
 *
 * A TAIL rather than the whole stream: a conclusion (and the verdict line)
 * lives at the end, and the renderer trims it again to its own per-field cap.
 */
function resolveFinalText(row: DreamCandidateRow): string | null {
  for (const streamType of ["response", "output"] as const) {
    const tail = readChunkTail(
      row.id,
      streamType,
      DREAM_FINAL_TEXT_SOURCE_MAX_CHARS
    );
    if (tail && tail.trim()) return tail;
  }
  try {
    const fromLogs = extractLastNonEmptyTextFromFile(row.logsPath);
    if (fromLogs && fromLogs.trim()) return fromLogs;
  } catch {
    // Best-effort: an unreadable log file must not break the digest.
  }
  return row.lastNonEmptyText && row.lastNonEmptyText.trim()
    ? row.lastNonEmptyText
    : null;
}

/**
 * Builds the cross-session digest for a project: window resolution, candidate
 * selection, per-session enrichment, then the size-budgeted assembly.
 *
 * Pure-ish by construction — it reads the database but takes its clock and
 * every cap as arguments, so the window/cap/truncation rules are testable
 * end-to-end without touching a real project.
 */
export function collectDreamDigest(
  projectId: string,
  options: CollectDreamDigestOptions = {}
): DreamDigestResult {
  const now = options.now ?? new Date();
  const lastCutoffAt = findLastDreamCutoff(projectId);
  const window = resolveDreamWindow({
    lastCutoffAt,
    now,
    windowDays: options.windowDays ?? DREAM_WINDOW_DAYS,
  });

  const { rows, candidateCount } = selectDreamCandidates(
    projectId,
    window.sinceIso,
    options.maxSessions ?? DREAM_MAX_SESSIONS
  );

  // Oldest → newest: the dream reads the period as a story, not a stack.
  const ordered = [...rows].reverse();

  const epicIds = [
    ...new Set(ordered.map((row) => row.epicId).filter((id): id is string => !!id)),
  ];
  const storyIds = [
    ...new Set(
      ordered.map((row) => row.userStoryId).filter((id): id is string => !!id)
    ),
  ];
  const labels = loadTicketLabels(epicIds, storyIds);
  const findingsByEpic = loadBlockingFindingsByEpic(epicIds);
  const forensicByEpic = loadForensicCommentsByEpic(epicIds);

  // Resolved for the whole batch at once: attributing a post-mortem needs to
  // compare candidate sessions against each other, which a per-session pass
  // cannot do (see assignForensicComments).
  const forensicBySession = assignForensicComments(ordered, forensicByEpic);

  const sessions: DreamSessionDigest[] = ordered.map((row) => {
    const startMs = parseTimestampMs(sessionAt(row));
    const endMs = sessionTerminalMs(row);
    const finalText = resolveFinalText(row);

    // Exact attribution when the filing session was recorded; the time window
    // only for rows written before migration 0032. Mixing the two would be
    // wrong in the case that matters: with two reviewers on one epic, a
    // LINKED row belongs to its session and to no other, so an unlinked
    // fallback must never claim it.
    const findings = row.epicId
      ? (findingsByEpic.get(row.epicId) ?? [])
          .filter((finding) =>
            finding.agentSessionId
              ? finding.agentSessionId === row.id
              : finding.createdMs !== null &&
                (startMs === null || finding.createdMs >= startMs) &&
                (endMs === null || finding.createdMs <= endMs)
          )
          .map((finding) => finding.body)
      : [];

    const forensic = forensicBySession.get(row.id) ?? null;

    const ticketLabel = row.userStoryId
      ? [labels.epics.get(row.epicId ?? ""), labels.stories.get(row.userStoryId)]
          .filter(Boolean)
          .join(" — ") || null
      : (labels.epics.get(row.epicId ?? "") ?? null);

    return {
      sessionId: row.id,
      at: sessionAt(row),
      ticketLabel,
      agentType: row.agentType,
      provider: row.provider,
      model: row.model,
      status: row.status,
      outcome: row.outcome,
      durationMs:
        startMs !== null && endMs !== null && endMs >= startMs
          ? endMs - startMs
          : null,
      costUsd: row.totalCostUsd ?? null,
      error: row.error,
      reviewVerdict: extractReviewVerdict(finalText),
      findings,
      forensic,
      finalText,
    };
  });

  const assembled = assembleDreamDigest(
    sessions,
    options.maxChars ?? DREAM_DIGEST_MAX_CHARS
  );

  return {
    ...assembled,
    sinceIso: window.sinceIso,
    collectedAtIso: now.toISOString(),
    lastCutoffAt,
    candidateCount,
    sessions,
  };
}
